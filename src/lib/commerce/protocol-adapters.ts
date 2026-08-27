import db from "../db";
import {
  createNegotiation,
  getNegotiation,
} from "./negotiation-service";
import { getProduct } from "./catalog";
import { ensureDefaultCommerceData } from "./catalog";
import type { NegotiationOffer } from "./types";

export const ACP_VERSION = "2026-04-17";
export const UCP_VERSION = "2026-04-08";
export const A2A_VERSION = "1.0";

export function createProtocolNegotiation(input: {
  protocol: "ucp" | "acp";
  buyerAgentId: string;
  idempotencyKey: string;
  currency: string;
  items: Array<{ productId: string; quantity: number }>;
  metadata?: Record<string, unknown>;
}) {
  ensureDefaultCommerceData();
  if (input.currency.toUpperCase() !== "INR") {
    throw new Error("SpecLock currently settles physical orders in INR");
  }
  const products = input.items.map((item) => {
    const product = getProduct(item.productId);
    if (!product) throw new Error(`Unknown product '${item.productId}'`);
    return { item, product };
  });
  const listTotal = products.reduce(
    (sum, entry) => sum + entry.item.quantity * entry.product.listPricePaise,
    0
  );
  const requestedBudget = input.metadata?.speclock_max_budget_paise;
  const maxBudgetPaise =
    typeof requestedBudget === "number" &&
    Number.isSafeInteger(requestedBudget) &&
    requestedBudget > 0
      ? requestedBudget
      : listTotal;
  const flexibility =
    (input.metadata?.speclock_quantity_flexibility as
      | Record<string, { min?: number; max?: number }>
      | undefined) ?? {};
  const crossSellAllowed = input.metadata?.speclock_cross_sell === true;

  return createNegotiation({
    merchantId: products[0]?.product.merchantId ?? "merchant_abc_labels",
    buyerAgentId: input.buyerAgentId,
    maxBudgetPaise,
    deliveryDate:
      typeof input.metadata?.delivery_date === "string"
        ? input.metadata.delivery_date
        : undefined,
    requirements: products.map(({ item, product }) => ({
      productId: product.id,
      minQuantity: flexibility[product.id]?.min ?? item.quantity,
      targetQuantity: item.quantity,
      maxQuantity: flexibility[product.id]?.max ?? item.quantity,
      required: true,
      substitutionsAllowed:
        input.metadata?.speclock_substitutions_allowed === true,
      priority: 100,
    })),
    crossSellPolicy: {
      allowed: crossSellAllowed,
      maxAdditionalSpendPaise:
        typeof input.metadata?.speclock_cross_sell_budget_paise === "number"
          ? input.metadata.speclock_cross_sell_budget_paise
          : undefined,
      allowedProductIds: Array.isArray(
        input.metadata?.speclock_allowed_cross_sell_product_ids
      )
        ? (input.metadata
            .speclock_allowed_cross_sell_product_ids as string[])
        : undefined,
    },
    idempotencyKey: `${input.protocol}:${input.idempotencyKey}`,
    metadata: {
      sourceProtocol: input.protocol,
      protocolMetadata: input.metadata ?? {},
    },
  });
}

export function toAcpCheckout(sessionId: string) {
  const session = getNegotiation(sessionId);
  const offer = selectedOffer(session.offers, session.acceptedOfferId);
  const order = getOrderForSession(sessionId);
  const status =
    order?.status === "paid"
      ? "completed"
      : session.status === "agreed"
        ? "ready_for_payment"
        : session.status === "open"
          ? "in_progress"
          : session.status === "expired"
            ? "expired"
            : session.status === "cancelled"
              ? "canceled"
              : "requires_escalation";
  return {
    id: session.id,
    protocol: { version: ACP_VERSION },
    status,
    currency: "inr",
    line_items: offer.items.map((item) => ({
      id: `${offer.id}:${item.productId}`,
      item: {
        id: item.productId,
        name: item.name,
        unit_amount: item.unitPricePaise,
      },
      quantity: item.quantity,
      product_id: item.productId,
      sku: item.sku,
      unit_amount: item.unitPricePaise,
      totals: [
        {
          type: "total",
          display_text: "Line total",
          amount: item.lineTotalPaise,
        },
      ],
    })),
    totals: [
      { type: "subtotal", display_text: "Subtotal", amount: offer.totalPaise },
      { type: "total", display_text: "Total", amount: offer.totalPaise },
    ],
    fulfillment_options: [],
    messages:
      session.status === "open"
        ? [
            {
              type: "info",
              code: "negotiation_active",
              message: "Seller and buyer agents are negotiating bounded terms.",
            },
          ]
        : [],
    links: [
      {
        type: "terms_of_use",
        url: `${appUrl()}/api/negotiations/${session.id}`,
      },
    ],
    capabilities: {
      extensions: [
        {
          name: "in.speclock.negotiation@2026-08-27",
          extends: ["$.CheckoutSession.metadata"],
          schema: `${appUrl()}/api/protocols/schemas/negotiation`,
          spec: `${appUrl()}/docs/negotiation`,
        },
      ],
    },
    quote_id: offer.id,
    quote_expires_at: new Date(offer.expiresAt).toISOString(),
    created_at: new Date(session.createdAt).toISOString(),
    updated_at: new Date(session.updatedAt).toISOString(),
    expires_at: new Date(session.expiresAt).toISOString(),
    metadata: {
      speclock_negotiation_status: session.status,
      speclock_round: session.currentRound,
      speclock_accepted_offer_id: session.acceptedOfferId,
      speclock_order_id: order?.id,
    },
    ...(order?.status === "paid"
      ? {
          order: {
            id: order.id,
            checkout_session_id: session.id,
            order_number: order.id,
            permalink_url: `${appUrl()}/api/negotiations/${session.id}`,
            status: "confirmed",
            line_items: offer.items.map((item) => ({
              id: `${offer.id}:${item.productId}`,
              title: item.name,
              product_id: item.productId,
              quantity: { ordered: item.quantity },
            })),
            totals: [
              {
                type: "total",
                display_text: "Total",
                amount: offer.totalPaise,
              },
            ],
          },
        }
      : {}),
  };
}

export function toUcpCheckout(sessionId: string) {
  const session = getNegotiation(sessionId);
  const offer = selectedOffer(session.offers, session.acceptedOfferId);
  const order = getOrderForSession(sessionId);
  return {
    ucp: {
      version: UCP_VERSION,
      capabilities: {
        "dev.ucp.shopping.checkout": [{ version: UCP_VERSION }],
        "dev.ucp.shopping.ap2_mandates": [{ version: UCP_VERSION }],
        "in.speclock.negotiation": [{ version: "2026-08-27" }],
      },
    },
    id: session.id,
    status: order?.status === "paid" ? "completed" : "open",
    currency: "INR",
    line_items: offer.items.map((item) => ({
      id: `${offer.id}:${item.productId}`,
      item: {
        id: item.productId,
        title: item.name,
        price: item.unitPricePaise,
      },
      quantity: item.quantity,
      totals: [
        { type: "subtotal", amount: item.lineTotalPaise },
        { type: "total", amount: item.lineTotalPaise },
      ],
    })),
    totals: [
      { type: "subtotal", amount: offer.totalPaise },
      { type: "total", amount: offer.totalPaise },
    ],
    links: [
      { rel: "self", href: `${appUrl()}/ucp/v1/checkout-sessions/${sessionId}` },
      {
        rel: "mandates",
        href: `${appUrl()}/api/negotiations/${sessionId}/mandates`,
      },
    ],
    messages:
      session.status === "open"
        ? [
            {
              type: "info",
              code: "negotiation_active",
              content: "A bounded commercial negotiation is active.",
            },
          ]
        : [],
    extensions: {
      "in.speclock.negotiation": {
        status: session.status,
        round: session.currentRound,
        activeOfferId: offer.id,
        bundleDiscoveryUrl: `${appUrl()}/api/negotiations/${sessionId}/bundles`,
      },
    },
  };
}

function selectedOffer(
  offers: NegotiationOffer[],
  acceptedOfferId: string | null
) {
  const offer = acceptedOfferId
    ? offers.find((item) => item.id === acceptedOfferId)
    : [...offers]
        .reverse()
        .find((item) => item.status === "active") ?? offers[offers.length - 1];
  if (!offer) throw new Error("Negotiation has no current offer");
  return offer;
}

function getOrderForSession(sessionId: string) {
  return db
    .prepare(
      `SELECT id, status, amount_paise, razorpay_order_id
       FROM commerce_orders WHERE session_id = ?`
    )
    .get(sessionId) as
    | {
        id: string;
        status: string;
        amount_paise: number;
        razorpay_order_id: string | null;
      }
    | undefined;
}

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:43123";
}
