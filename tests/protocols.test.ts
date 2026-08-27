import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import db from "@/lib/db";
import { GET as getUcpProfile } from "@/app/.well-known/ucp/route";
import { GET as getAgentCard } from "@/app/.well-known/agent-card.json/route";
import { POST as sendA2aMessage } from "@/app/a2a/v1/message:send/route";
import { POST as createUcpCheckout } from "@/app/ucp/v1/checkout-sessions/route";
import { POST as createAcpCheckout } from "@/app/checkout_sessions/route";
import {
  ACP_VERSION,
  A2A_VERSION,
  UCP_VERSION,
} from "@/lib/commerce/protocol-adapters";
import {
  DEFAULT_LABEL_PRODUCT_ID,
  ensureDefaultCommerceData,
} from "@/lib/commerce/catalog";

beforeEach(() => {
  db.exec(`
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
  ensureDefaultCommerceData();
});

describe("agentic commerce protocol adapters", () => {
  it("publishes UCP and A2A discovery documents", async () => {
    const ucp = await (await getUcpProfile()).json();
    expect(ucp.ucp.version).toBe(UCP_VERSION);
    expect(ucp.ucp.services["dev.ucp.shopping"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ transport: "rest" }),
        expect.objectContaining({ transport: "a2a" }),
      ])
    );
    expect(ucp.ucp.payment_handlers["in.speclock.razorpay"]).toBeDefined();
    expect(ucp.keys[0]).toMatchObject({ kty: "EC", crv: "P-256" });

    const card = await (await getAgentCard()).json();
    expect(card.supportedInterfaces[0]).toMatchObject({
      protocolBinding: "HTTP+JSON",
      protocolVersion: A2A_VERSION,
    });
    expect(card.skills.map((skill: { id: string }) => skill.id)).toContain(
      "negotiate-custom-manufacturing"
    );
  });

  it("creates the same negotiation domain through UCP", async () => {
    const response = await createUcpCheckout(
      new NextRequest("http://localhost:43123/ucp/v1/checkout-sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "UCP-Agent": 'profile="https://buyer.example/.well-known/ucp"',
          "UCP-Version": UCP_VERSION,
          "Idempotency-Key": "ucp-create-fixed-1",
        },
        body: JSON.stringify({
          currency: "USD",
          line_items: [
            {
              item: { id: DEFAULT_LABEL_PRODUCT_ID },
              quantity: 1_000,
            },
          ],
          metadata: { speclock_max_budget_paise: 5_000_000 },
        }),
      })
    );
    // Unsupported settlement currencies fail before creating domain state.
    expect(response.status).toBe(422);

    const valid = await createUcpCheckout(
      new NextRequest("http://localhost:43123/ucp/v1/checkout-sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "UCP-Agent": 'profile="https://buyer.example/.well-known/ucp"',
          "UCP-Version": UCP_VERSION,
          "Idempotency-Key": "ucp-create-fixed-2",
        },
        body: JSON.stringify({
          currency: "INR",
          line_items: [
            { item: { id: DEFAULT_LABEL_PRODUCT_ID }, quantity: 1_000 },
          ],
          metadata: { speclock_max_budget_paise: 5_000_000 },
        }),
      })
    );
    expect(valid.status).toBe(201);
    const checkout = await valid.json();
    expect(checkout.ucp.version).toBe(UCP_VERSION);
    expect(checkout.extensions["in.speclock.negotiation"].status).toBe("open");
    expect(JSON.stringify(checkout)).not.toContain("floorPrice");
    expect(JSON.stringify(checkout)).not.toContain("costPaise");
  });

  it("accepts structured A2A negotiation messages", async () => {
    const response = await sendA2aMessage(
      new NextRequest("http://localhost:43123/a2a/v1/message:send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "A2A-Version": A2A_VERSION,
        },
        body: JSON.stringify({
          message: {
            messageId: "msg-client-fixed-1",
            role: "ROLE_USER",
            parts: [
              {
                data: {
                  action: "negotiation.create",
                  payload: {
                    merchantId: "merchant_abc_labels",
                    buyerAgentId: "a2a-buyer",
                    maxBudgetPaise: 5_000_000,
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
                  },
                },
              },
            ],
          },
        }),
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message.role).toBe("ROLE_AGENT");
    expect(body.message.parts[0].data.status).toBe("open");
  });

  it("maps ACP checkout onto the same immutable offer model", async () => {
    const response = await createAcpCheckout(
      new NextRequest("http://localhost:43123/checkout_sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "API-Version": ACP_VERSION,
          "Idempotency-Key": "acp-create-fixed-1",
          "User-Agent": "OpenAI-Agent-Test",
        },
        body: JSON.stringify({
          currency: "INR",
          line_items: [
            { item: { id: DEFAULT_LABEL_PRODUCT_ID }, quantity: 1_000 },
          ],
          capabilities: { extensions: ["in.speclock.negotiation"] },
          metadata: { speclock_max_budget_paise: 5_000_000 },
        }),
      })
    );
    expect(response.status).toBe(201);
    const checkout = await response.json();
    expect(checkout.protocol.version).toBe(ACP_VERSION);
    expect(checkout.status).toBe("in_progress");
    expect(checkout.line_items[0].item.id).toBe(DEFAULT_LABEL_PRODUCT_ID);
    expect(checkout.capabilities.extensions[0].name).toContain(
      "in.speclock.negotiation"
    );
  });
});
