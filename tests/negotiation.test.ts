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

beforeEach(() => {
  db.exec(`
    DELETE FROM idempotency_keys;
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
  ensureDefaultCommerceData();
});

describe("deterministic negotiation engine", () => {
  it("anchors at list price then finds an agreement above the private floor", () => {
    const session = createExampleNegotiation();
    const opening = session.offers[0];
    expect(opening.totalPaise).toBe(6_000_000);
    expect(opening.totalPaise).toBeGreaterThan(5_000_000);

    const agreed = runAutonomousNegotiation(session.id);
    expect(agreed.status).toBe("agreed");
    const accepted = agreed.offers.find(
      (offer) => offer.id === agreed.acceptedOfferId
    );
    expect(accepted?.totalPaise).toBe(5_000_000);
    expect(accepted?.totalPaise).toBeGreaterThanOrEqual(3_500_000);
    expect(agreed.currentRound).toBeLessThanOrEqual(5);
  });

  it("never allows the buyer to accept an offer above its private mandate", () => {
    const session = createExampleNegotiation();
    expect(() => acceptSellerOffer(session.id, session.offers[0].id)).toThrow(
      "outside the buyer's delegated mandate"
    );
  });

  it("creates bounded seller counters without exposing reservation prices", () => {
    const session = createExampleNegotiation();
    const decision = counterNegotiation(session.id, {
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

  it("deduplicates session creation by idempotency key", () => {
    const first = createExampleNegotiation("request-fixed-123");
    const second = createExampleNegotiation("request-fixed-123");
    expect(second.id).toBe(first.id);
    expect(second.offers).toHaveLength(1);
  });

  it("creates a permissioned cross-sell mix that improves buyer utility and seller revenue", () => {
    const session = createNegotiation({
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

    const bundles = generateBundleOptions(session.id);
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

    const offer = selectBundleOption(session.id, mix!.id);
    expect(offer.totalPaise).toBe(4_750_000);
    const agreed = runAutonomousNegotiation(session.id);
    expect(agreed.status).toBe("agreed");
    expect(agreed.acceptedOfferId).toBe(offer.id);
  });

  it("does not generate cross-sells without explicit buyer permission", () => {
    const session = createExampleNegotiation();
    expect(generateBundleOptions(session.id)).toEqual([]);
  });
});

function createExampleNegotiation(idempotencyKey?: string) {
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
