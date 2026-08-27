import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import {
  acceptSellerOffer,
  counterNegotiation,
  createNegotiation,
  runAutonomousNegotiation,
} from "@/lib/commerce/negotiation-service";
import {
  DEFAULT_LABEL_PRODUCT_ID,
  DEFAULT_MERCHANT_ID,
  ensureDefaultCommerceData,
} from "@/lib/commerce/catalog";
import {
  generateBundleOptions,
  selectBundleOption,
} from "@/lib/commerce/bundle-optimizer";
import {
  getMandate,
  listMandates,
  verifyMandate,
} from "@/lib/commerce/mandates";
import { createCommerceOrder } from "@/lib/commerce/commerce-order";
import { PUT as confirmPayment } from "@/app/api/razorpay/webhook/route";
import { NextRequest } from "next/server";

beforeEach(async () => {
  await db.exec(`
    DELETE FROM idempotency_keys;
    DELETE FROM commerce_orders;
    DELETE FROM mandate_artifacts;
    DELETE FROM bundle_option_items;
    DELETE FROM bundle_options;
    DELETE FROM negotiation_events;
    DELETE FROM negotiation_offer_items;
    DELETE FROM negotiation_offers;
    DELETE FROM negotiation_requirements;
    DELETE FROM negotiation_private_terms;
    DELETE FROM negotiation_sessions;
    DELETE FROM product_relationships;
    DELETE FROM seller_policies;
    DELETE FROM merchant_products;
    DELETE FROM merchants;
  `);
  await ensureDefaultCommerceData();
});

describe("deterministic negotiation engine", () => {
  it("anchors at list price then finds an agreement above the private floor", async () => {
    const session = await createExampleNegotiation();
    const opening = session.offers[0];
    expect(opening.totalPaise).toBe(6_000_000);
    expect(opening.totalPaise).toBeGreaterThan(5_000_000);

    const agreed = await runAutonomousNegotiation(session.id);
    expect(agreed.status).toBe("agreed");
    const accepted = agreed.offers.find(
      (offer) => offer.id === agreed.acceptedOfferId
    );
    expect(accepted?.totalPaise).toBe(5_000_000);
    expect(accepted?.totalPaise).toBeGreaterThanOrEqual(3_500_000);
    expect(agreed.currentRound).toBeLessThanOrEqual(5);
  });

  it("never allows the buyer to accept an offer above its private mandate", async () => {
    const session = await createExampleNegotiation();
    await expect(
      acceptSellerOffer(session.id, session.offers[0].id)
    ).rejects.toThrow("outside the buyer's delegated mandate");
  });

  it("creates bounded seller counters without exposing reservation prices", async () => {
    const session = await createExampleNegotiation();
    const decision = await counterNegotiation(session.id, {
      parentOfferId: session.offers[0].id,
      targetTotalPaise: 4_500_000,
      itemQuantities: { [DEFAULT_LABEL_PRODUCT_ID]: 1_000 },
      giveBacks: ["flexible_delivery"],
    });
    expect(decision.outcome).toBe("countered");
    if (decision.outcome !== "countered") return;
    expect(decision.offer.totalPaise).toBeGreaterThan(4_500_000);
    expect(decision.offer.totalPaise).toBeGreaterThanOrEqual(3_500_000);
    expect(JSON.stringify(decision)).not.toContain("floor");
    expect(JSON.stringify(decision)).not.toContain("cost");
  });

  it("deduplicates session creation by idempotency key", async () => {
    const first = await createExampleNegotiation("request-fixed-123");
    const second = await createExampleNegotiation("request-fixed-123");
    expect(second.id).toBe(first.id);
    expect(second.offers).toHaveLength(1);
  });

  it("rejects idempotency key reuse with a different payload", async () => {
    await createExampleNegotiation("request-conflict-123");
    await expect(
      createNegotiation({
        merchantId: DEFAULT_MERCHANT_ID,
        buyerAgentId: "different-buyer",
        maxBudgetPaise: 4_900_000,
        requirements: [
          {
            productId: DEFAULT_LABEL_PRODUCT_ID,
            minQuantity: 1_000,
            targetQuantity: 1_000,
            maxQuantity: 1_000,
            required: true,
            substitutionsAllowed: false,
            priority: 100,
          },
        ],
        crossSellPolicy: { allowed: false },
        idempotencyKey: "request-conflict-123",
        metadata: {},
      })
    ).rejects.toThrow("different request payload");
  });

  it("creates a permissioned cross-sell mix that improves buyer utility and seller revenue", async () => {
    const session = await createNegotiation({
      merchantId: DEFAULT_MERCHANT_ID,
      buyerAgentId: "bundle-buyer-agent",
      maxBudgetPaise: 5_000_000,
      maxDepositPaise: 1_500_000,
      deliveryDate: futureDate(14),
      requirements: [
        {
          productId: DEFAULT_LABEL_PRODUCT_ID,
          minQuantity: 800,
          targetQuantity: 1_000,
          maxQuantity: 2_000,
          required: true,
          substitutionsAllowed: false,
          priority: 100,
        },
      ],
      crossSellPolicy: {
        allowed: true,
        maxAdditionalSpendPaise: 1_000_000,
      },
      metadata: {},
    });

    const bundles = await generateBundleOptions(session.id);
    const mix = bundles.find((bundle) => bundle.strategy === "mix_shift");
    expect(mix).toBeDefined();
    expect(mix?.totalPaise).toBeLessThanOrEqual(5_000_000);
    expect(mix?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: DEFAULT_LABEL_PRODUCT_ID,
          quantity: 800,
        }),
        expect.objectContaining({
          productId: "prod_roti_foil",
          quantity: 3_000,
          source: "cross_sell",
        }),
      ])
    );

    const offer = await selectBundleOption(session.id, mix!.id);
    expect(offer.totalPaise).toBe(4_750_000);
    const agreed = await runAutonomousNegotiation(session.id);
    expect(agreed.status).toBe("agreed");
    expect(agreed.acceptedOfferId).toBe(offer.id);
  });

  it("does not generate cross-sells without explicit buyer permission", async () => {
    const session = await createExampleNegotiation();
    expect(await generateBundleOptions(session.id)).toEqual([]);
  });

  it("creates and verifies an open-to-closed mandate chain", async () => {
    const session = await createExampleNegotiation();
    const openCheckout = await getMandate(session.id, "checkout", "open");
    expect(openCheckout.vct).toBe("mandate.checkout.open.1");
    expect(verifyMandate(openCheckout.compactJws!).valid).toBe(true);
    expect(JSON.stringify(await listMandates(session.id))).not.toContain(
      "buyerMaxTotalPaise"
    );

    const agreed = await runAutonomousNegotiation(session.id);
    const closedCheckout = await getMandate(agreed.id, "checkout", "closed");
    const closedPayment = await getMandate(agreed.id, "payment", "closed");
    expect(closedCheckout.parentMandateId).toBe(openCheckout.id);
    expect(closedPayment.payload).toMatchObject({
      payment_amount: { currency: "INR", amount: 1_500_000 },
      transaction_id: expect.any(String),
    });
    expect(closedCheckout.payload).toMatchObject({
      checkout_jwt: expect.any(String),
      checkout_hash: closedPayment.payload.transaction_id,
    });
    expect(verifyMandate(closedPayment.compactJws!).valid).toBe(true);
  });

  it("binds the accepted deal and mandates to an idempotent payment order", async () => {
    const session = await createExampleNegotiation();
    const agreed = await runAutonomousNegotiation(session.id);
    const first = await createCommerceOrder(agreed.id);
    const repeated = await createCommerceOrder(agreed.id);
    expect(first.razorpayOrderId).toMatch(/^order_mock_/);
    expect(repeated.razorpayOrderId).toBe(first.razorpayOrderId);
    expect(repeated.reused).toBe(true);

    const confirmation = await confirmPayment(
      new NextRequest("http://localhost:43123/api/razorpay/webhook", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: first.razorpayOrderId }),
      })
    );
    expect(confirmation.status).toBe(200);
    const receipt = await getMandate(agreed.id, "payment_receipt", "receipt");
    expect(receipt.vct).toBe("speclock.payment-receipt.1");
    expect(verifyMandate(receipt.compactJws!).valid).toBe(true);
  });
});

async function createExampleNegotiation(idempotencyKey?: string) {
  return createNegotiation({
    merchantId: DEFAULT_MERCHANT_ID,
    buyerAgentId: "buyer-agent-test",
    maxBudgetPaise: 5_000_000,
    maxDepositPaise: 1_500_000,
    deliveryDate: futureDate(14),
    requirements: [
      {
        productId: DEFAULT_LABEL_PRODUCT_ID,
        minQuantity: 1_000,
        targetQuantity: 1_000,
        maxQuantity: 2_000,
        required: true,
        substitutionsAllowed: false,
        priority: 100,
      },
    ],
    crossSellPolicy: { allowed: false },
    idempotencyKey,
    metadata: {},
  });
}

function futureDate(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
