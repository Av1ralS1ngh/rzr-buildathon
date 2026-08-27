import db from "../db";
import crypto from "crypto";
import { newId } from "../commitment";
import {
  ensureDefaultCommerceData,
  getActiveSellerPolicy,
  getProducts,
} from "./catalog";
import {
  buyerCanAccept,
  buyerProposalLines,
  openingLines,
  sellerDecision,
  totalFor,
  type PricedLine,
  type RequirementBounds,
} from "./negotiation-policy";
import type {
  CounterOfferInput,
  CreateNegotiationInput,
  NegotiationDecision,
  NegotiationOffer,
  SellerPolicy,
} from "./types";
import { createClosedMandates, createOpenMandates } from "./mandates";

type SessionRow = {
  id: string;
  merchant_id: string;
  buyer_agent_id: string;
  status: "open" | "agreed" | "rejected" | "expired" | "cancelled";
  currency: "INR";
  seller_policy_id: string;
  current_round: number;
  accepted_offer_id: string | null;
  delivery_date: string | null;
  expires_at: number;
  created_at: number;
  updated_at: number;
};

type RequirementRow = {
  product_id: string;
  min_quantity: number;
  target_quantity: number;
  max_quantity: number;
  required: number;
  substitutions_allowed: number;
  priority: number;
};

type OfferRow = {
  id: string;
  session_id: string;
  sequence: number;
  round: number;
  actor: "buyer" | "seller";
  parent_offer_id: string | null;
  status: "active" | "countered" | "accepted" | "rejected" | "expired";
  total_paise: number;
  delivery_date: string | null;
  deposit_bps: number;
  explanation: string;
  terms_json: string;
  expires_at: number;
  created_at: number;
};

type OfferItemRow = {
  product_id: string;
  sku: string;
  name: string;
  quantity: number;
  unit_price_paise: number;
  cost_snapshot_paise: number;
  list_snapshot_paise: number;
  target_snapshot_paise: number;
  floor_snapshot_paise: number;
  source: "requested" | "cross_sell" | "substitute";
};

export function createNegotiation(input: CreateNegotiationInput) {
  ensureDefaultCommerceData();
  const requestHash = fingerprint(input);
  if (input.idempotencyKey) {
    const existing = getIdempotentResource(
      "negotiation.create",
      input.idempotencyKey,
      requestHash
    );
    if (existing) return getNegotiation(existing);
  }
  if (new Set(input.requirements.map((item) => item.productId)).size !== input.requirements.length) {
    throw new Error("Each requested product may appear only once");
  }

  const policy = getActiveSellerPolicy(input.merchantId);
  if (!policy) throw new Error("Merchant has no active seller policy");
  const products = getProducts(
    input.requirements.map((item) => item.productId),
    input.merchantId
  );
  if (products.length !== input.requirements.length) {
    throw new Error("One or more products are unavailable from this merchant");
  }
  const requirements: RequirementBounds[] = input.requirements;
  const lines = openingLines(products, requirements);
  const sessionId = newId("neg");
  const offerId = newId("offer");
  const now = Date.now();
  const sessionExpiresAt = now + 24 * 60 * 60 * 1000;

  try {
    db.transaction(() => {
      db.prepare(
        `INSERT INTO negotiation_sessions (
          id, merchant_id, buyer_agent_id, status, currency, seller_policy_id,
          current_round, delivery_date, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'open', 'INR', ?, 0, ?, ?, ?, ?)`
      ).run(
        sessionId,
        input.merchantId,
        input.buyerAgentId,
        policy.id,
        input.deliveryDate ?? null,
        sessionExpiresAt,
        now,
        now
      );
      db.prepare(
        `INSERT INTO negotiation_private_terms (
          session_id, buyer_max_total_paise, buyer_max_deposit_paise,
          allow_cross_sell, cross_sell_budget_paise, allowed_cross_sell_json,
          metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        sessionId,
        input.maxBudgetPaise,
        input.maxDepositPaise ?? null,
        input.crossSellPolicy.allowed ? 1 : 0,
        input.crossSellPolicy.maxAdditionalSpendPaise ?? null,
        JSON.stringify(input.crossSellPolicy.allowedProductIds ?? []),
        JSON.stringify(input.metadata ?? {}),
        now
      );
      for (const requirement of requirements) {
        db.prepare(
          `INSERT INTO negotiation_requirements (
            id, session_id, product_id, min_quantity, target_quantity,
            max_quantity, required, substitutions_allowed, priority, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          newId("req"),
          sessionId,
          requirement.productId,
          requirement.minQuantity,
          requirement.targetQuantity,
          requirement.maxQuantity,
          requirement.required ? 1 : 0,
          requirement.substitutionsAllowed ? 1 : 0,
          requirement.priority,
          now
        );
      }
      insertOffer({
        id: offerId,
        sessionId,
        sequence: 1,
        round: 0,
        actor: "seller",
        lines,
        deliveryDate: input.deliveryDate,
        depositBps: policy.depositBps,
        explanation:
          "Opening offer based on the merchant's list price and requested quantities.",
        terms: { priceBasis: "list", policyVersion: policy.version },
        expiresAt: now + policy.offerTtlSeconds * 1000,
        now,
      });
      insertEvent(sessionId, "negotiation.opened", {
        openingOfferId: offerId,
        requestedProducts: requirements.map((item) => item.productId),
      });
      createOpenMandates(sessionId);
      if (input.idempotencyKey) {
        insertIdempotency(
          "negotiation.create",
          input.idempotencyKey,
          sessionId,
          {},
          requestHash
        );
      }
    })();
  } catch (error) {
    if (input.idempotencyKey) {
      const existing = getIdempotentResource(
        "negotiation.create",
        input.idempotencyKey,
        requestHash
      );
      if (existing) return getNegotiation(existing);
    }
    throw error;
  }

  return getNegotiation(sessionId);
}

export function counterNegotiation(
  sessionId: string,
  input: CounterOfferInput
): NegotiationDecision {
  const requestHash = fingerprint(input);
  if (input.idempotencyKey) {
    const existing = getIdempotentResponse(
      `negotiation.counter:${sessionId}`,
      input.idempotencyKey,
      requestHash
    );
    if (existing) return existing as NegotiationDecision;
  }

  let result: NegotiationDecision | undefined;
  db.transaction(() => {
    const session = getOpenSession(sessionId);
    const policy = getPolicyById(session.seller_policy_id);
    const requirements = getRequirementBounds(sessionId);
    const parent = getOfferRow(input.parentOfferId);
    if (
      !parent ||
      parent.session_id !== sessionId ||
      parent.actor !== "seller" ||
      parent.status !== "active"
    ) {
      throw new Error("Counteroffer must reference the active seller offer");
    }
    if (parent.expires_at <= Date.now()) {
      db.prepare(`UPDATE negotiation_offers SET status = 'expired' WHERE id = ?`).run(
        parent.id
      );
      throw new Error("The seller offer has expired");
    }

    const nextRound = session.current_round + 1;
    const previousSellerLines = getPricedLines(parent.id, session.merchant_id);
    const buyerLines = buyerProposalLines(
      previousSellerLines,
      input,
      requirements
    );
    const privateTerms = getPrivateTerms(sessionId);
    if (
      !buyerCanAccept(
        buyerLines,
        privateTerms.buyer_max_total_paise,
        privateTerms.buyer_max_deposit_paise,
        input.depositBps ?? parent.deposit_bps,
        requirements
      )
    ) {
      throw new Error("Buyer counteroffer exceeds its delegated mandate");
    }

    db.prepare(`UPDATE negotiation_offers SET status = 'countered' WHERE id = ?`).run(
      parent.id
    );
    const buyerOfferId = newId("offer");
    const now = Date.now();
    insertOffer({
      id: buyerOfferId,
      sessionId,
      sequence: parent.sequence + 1,
      round: nextRound,
      actor: "buyer",
      parentOfferId: parent.id,
      lines: buyerLines,
      deliveryDate: input.deliveryDate ?? parent.delivery_date ?? undefined,
      depositBps: input.depositBps ?? parent.deposit_bps,
      explanation: "Buyer agent submitted a counteroffer within its private mandate.",
      terms: { giveBacks: input.giveBacks },
      expiresAt: now + policy.offerTtlSeconds * 1000,
      now,
    });

    const decision = sellerDecision({
      buyerLines,
      previousSellerLines,
      requirements,
      policy,
      round: nextRound,
      giveBacks: input.giveBacks,
    });

    if (decision.action === "accept") {
      db.prepare(`UPDATE negotiation_offers SET status = 'accepted' WHERE id = ?`).run(
        buyerOfferId
      );
      db.prepare(
        `UPDATE negotiation_sessions
         SET status = 'agreed', current_round = ?, accepted_offer_id = ?, updated_at = ?
         WHERE id = ? AND status = 'open'`
      ).run(nextRound, buyerOfferId, now, sessionId);
      insertEvent(sessionId, "negotiation.agreed", {
        acceptedOfferId: buyerOfferId,
        round: nextRound,
      });
      createClosedMandates(sessionId, buyerOfferId);
      result = {
        outcome: "accepted",
        acceptedOfferId: buyerOfferId,
        reason: decision.reason,
      };
    } else if (decision.action === "reject") {
      db.prepare(`UPDATE negotiation_offers SET status = 'rejected' WHERE id = ?`).run(
        buyerOfferId
      );
      db.prepare(
        `UPDATE negotiation_sessions
         SET status = 'rejected', current_round = ?, updated_at = ?
         WHERE id = ? AND status = 'open'`
      ).run(nextRound, now, sessionId);
      insertEvent(sessionId, "negotiation.rejected", { round: nextRound });
      result = { outcome: "rejected", reason: decision.reason };
    } else {
      db.prepare(`UPDATE negotiation_offers SET status = 'countered' WHERE id = ?`).run(
        buyerOfferId
      );
      const sellerOfferId = newId("offer");
      insertOffer({
        id: sellerOfferId,
        sessionId,
        sequence: parent.sequence + 2,
        round: nextRound,
        actor: "seller",
        parentOfferId: buyerOfferId,
        lines: decision.lines,
        deliveryDate: input.deliveryDate ?? parent.delivery_date ?? undefined,
        depositBps: input.depositBps ?? parent.deposit_bps,
        explanation: decision.reason,
        terms: {
          concessionRound: nextRound,
          reciprocalGiveBacks: input.giveBacks,
        },
        expiresAt: now + policy.offerTtlSeconds * 1000,
        now,
      });
      db.prepare(
        `UPDATE negotiation_sessions
         SET current_round = ?, updated_at = ?
         WHERE id = ? AND status = 'open'`
      ).run(nextRound, now, sessionId);
      insertEvent(sessionId, "offer.countered", {
        buyerOfferId,
        sellerOfferId,
        round: nextRound,
      });
      result = {
        outcome: "countered",
        offer: getOffer(sellerOfferId),
        reason: decision.reason,
      };
    }

    if (input.idempotencyKey && result) {
      insertIdempotency(
        `negotiation.counter:${sessionId}`,
        input.idempotencyKey,
        result.outcome === "countered" ? result.offer.id : sessionId,
        result,
        requestHash
      );
    }
  })();
  if (!result) throw new Error("Negotiation decision was not produced");
  return result;
}

export function acceptSellerOffer(
  sessionId: string,
  offerId: string,
  idempotencyKey?: string
) {
  const scope = `negotiation.accept:${sessionId}`;
  const requestHash = fingerprint({ offerId, idempotencyKey });
  if (idempotencyKey) {
    const existing = getIdempotentResource(scope, idempotencyKey, requestHash);
    if (existing) return getNegotiation(existing);
  }
  try {
    db.transaction(() => {
    const session = getOpenSession(sessionId);
    const offer = getOfferRow(offerId);
    if (
      !offer ||
      offer.session_id !== sessionId ||
      offer.actor !== "seller" ||
      offer.status !== "active"
    ) {
      throw new Error("Only the active seller offer can be accepted");
    }
    if (offer.expires_at <= Date.now()) throw new Error("The offer has expired");
    const lines = getPricedLines(offerId, session.merchant_id);
    const requirements = getRequirementBounds(sessionId);
    const privateTerms = getPrivateTerms(sessionId);
    if (
      !buyerCanAccept(
        lines,
        privateTerms.buyer_max_total_paise,
        privateTerms.buyer_max_deposit_paise,
        offer.deposit_bps,
        requirements
      )
    ) {
      throw new Error("Offer is outside the buyer's delegated mandate");
    }
    const now = Date.now();
    db.prepare(`UPDATE negotiation_offers SET status = 'accepted' WHERE id = ?`).run(
      offerId
    );
    const update = db.prepare(
      `UPDATE negotiation_sessions
       SET status = 'agreed', accepted_offer_id = ?, updated_at = ?
       WHERE id = ? AND status = 'open'`
    ).run(offerId, now, sessionId);
    if (update.changes !== 1) throw new Error("Negotiation changed concurrently");
    insertEvent(sessionId, "negotiation.agreed", {
      acceptedOfferId: offerId,
      round: offer.round,
    });
      createClosedMandates(sessionId, offerId);
      if (idempotencyKey) {
        insertIdempotency(scope, idempotencyKey, sessionId, {}, requestHash);
      }
    })();
  } catch (error) {
    if (idempotencyKey) {
      const existing = getIdempotentResource(scope, idempotencyKey, requestHash);
      if (existing) return getNegotiation(existing);
    }
    throw error;
  }
  return getNegotiation(sessionId);
}

export function runAutonomousNegotiation(sessionId: string) {
  for (let step = 0; step < 20; step += 1) {
    const session = getNegotiation(sessionId);
    if (session.status !== "open") return session;
    const activeSellerOffer = [...session.offers]
      .reverse()
      .find((offer) => offer.actor === "seller" && offer.status === "active");
    if (!activeSellerOffer) throw new Error("No active seller offer found");
    const privateTerms = getPrivateTerms(sessionId);
    const pricedLines = getPricedLines(
      activeSellerOffer.id,
      session.merchantId
    );
    const requirements = getRequirementBounds(sessionId);
    if (
      buyerCanAccept(
        pricedLines,
        privateTerms.buyer_max_total_paise,
        privateTerms.buyer_max_deposit_paise,
        activeSellerOffer.depositBps,
        requirements
      )
    ) {
      return acceptSellerOffer(sessionId, activeSellerOffer.id);
    }

    const decision = counterNegotiation(sessionId, {
      parentOfferId: activeSellerOffer.id,
      targetTotalPaise: privateTerms.buyer_max_total_paise,
      itemQuantities: Object.fromEntries(
        activeSellerOffer.items.map((item) => [item.productId, item.quantity])
      ),
      deliveryDate: activeSellerOffer.deliveryDate,
      depositBps: activeSellerOffer.depositBps,
      giveBacks:
        step === 0 && activeSellerOffer.deliveryDate
          ? ["flexible_delivery"]
          : [],
    });
    if (decision.outcome !== "countered") return getNegotiation(sessionId);
  }
  throw new Error("Negotiation exceeded the safety iteration limit");
}

export function replaceWithSellerBundle(input: {
  sessionId: string;
  parentOfferId: string;
  bundleId: string;
  lines: PricedLine[];
  strategy: string;
  explanation: string;
}) {
  let offerId = "";
  db.transaction(() => {
    const session = getOpenSession(input.sessionId);
    const option = db
      .prepare(
        `SELECT id FROM bundle_options
         WHERE id = ? AND session_id = ? AND parent_offer_id = ? AND status = 'active'`
      )
      .get(input.bundleId, input.sessionId, input.parentOfferId);
    if (!option) throw new Error("Bundle option is no longer active");
    const parent = getOfferRow(input.parentOfferId);
    if (
      !parent ||
      parent.session_id !== input.sessionId ||
      parent.actor !== "seller" ||
      parent.status !== "active"
    ) {
      throw new Error("Bundle must replace the active seller offer");
    }
    const policy = getPolicyById(session.seller_policy_id);
    const now = Date.now();
    const requirementIds = new Set(
      getRequirementBounds(input.sessionId).map((requirement) => requirement.productId)
    );
    for (const line of input.lines) {
      if (requirementIds.has(line.product.id)) continue;
      db.prepare(
        `INSERT INTO negotiation_requirements (
          id, session_id, product_id, min_quantity, target_quantity,
          max_quantity, required, substitutions_allowed, priority, created_at
        ) VALUES (?, ?, ?, 0, ?, ?, 0, 0, 25, ?)`
      ).run(
        newId("req"),
        input.sessionId,
        line.product.id,
        line.quantity,
        line.product.maxQuantity,
        now
      );
    }
    db.prepare(`UPDATE negotiation_offers SET status = 'countered' WHERE id = ?`).run(
      parent.id
    );
    offerId = newId("offer");
    insertOffer({
      id: offerId,
      sessionId: input.sessionId,
      sequence: parent.sequence + 1,
      round: session.current_round,
      actor: "seller",
      parentOfferId: parent.id,
      lines: input.lines,
      deliveryDate: parent.delivery_date ?? undefined,
      depositBps: parent.deposit_bps,
      explanation: input.explanation,
      terms: { bundleId: input.bundleId, strategy: input.strategy },
      expiresAt: now + policy.offerTtlSeconds * 1000,
      now,
    });
    db.prepare(`UPDATE bundle_options SET status = 'dismissed' WHERE session_id = ? AND status = 'active'`)
      .run(input.sessionId);
    db.prepare(`UPDATE bundle_options SET status = 'selected' WHERE id = ?`).run(
      input.bundleId
    );
    db.prepare(`UPDATE negotiation_sessions SET updated_at = ? WHERE id = ?`).run(
      now,
      input.sessionId
    );
    insertEvent(input.sessionId, "bundle.selected", {
      bundleId: input.bundleId,
      sellerOfferId: offerId,
      strategy: input.strategy,
    });
  })();
  return getOffer(offerId);
}

export function getNegotiation(sessionId: string) {
  const session = db
    .prepare(`SELECT * FROM negotiation_sessions WHERE id = ?`)
    .get(sessionId) as SessionRow | undefined;
  if (!session) throw new Error("Negotiation not found");
  const requirements = getRequirementBounds(sessionId);
  const offers = (
    db
      .prepare(
        `SELECT * FROM negotiation_offers
         WHERE session_id = ? ORDER BY sequence ASC`
      )
      .all(sessionId) as OfferRow[]
  ).map((offer) => mapOffer(offer));
  const events = (
    db
      .prepare(
        `SELECT id, event_type, payload_json, created_at
         FROM negotiation_events WHERE session_id = ? ORDER BY created_at ASC`
      )
      .all(sessionId) as Array<{
      id: string;
      event_type: string;
      payload_json: string;
      created_at: number;
    }>
  ).map((event) => ({
    id: event.id,
    type: event.event_type,
    payload: JSON.parse(event.payload_json) as Record<string, unknown>,
    createdAt: event.created_at,
  }));
  return {
    id: session.id,
    merchantId: session.merchant_id,
    buyerAgentId: session.buyer_agent_id,
    status: session.status,
    currency: session.currency,
    currentRound: session.current_round,
    acceptedOfferId: session.accepted_offer_id,
    deliveryDate: session.delivery_date,
    expiresAt: session.expires_at,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    requirements,
    offers,
    events,
  };
}

export function getOffer(offerId: string): NegotiationOffer {
  const row = getOfferRow(offerId);
  if (!row) throw new Error("Offer not found");
  return mapOffer(row);
}

export function cancelNegotiation(sessionId: string) {
  db.transaction(() => {
    const session = db
      .prepare(`SELECT status FROM negotiation_sessions WHERE id = ?`)
      .get(sessionId) as { status: string } | undefined;
    if (!session) throw new Error("Negotiation not found");
    if (session.status === "cancelled") return;
    if (session.status !== "open") {
      throw new Error(`Negotiation cannot be cancelled while '${session.status}'`);
    }
    const now = Date.now();
    db.prepare(
      `UPDATE negotiation_sessions
       SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'open'`
    ).run(now, sessionId);
    db.prepare(
      `UPDATE negotiation_offers
       SET status = 'rejected' WHERE session_id = ? AND status = 'active'`
    ).run(sessionId);
    db.prepare(
      `UPDATE bundle_options
       SET status = 'dismissed' WHERE session_id = ? AND status = 'active'`
    ).run(sessionId);
    insertEvent(sessionId, "negotiation.cancelled", {});
  })();
  return getNegotiation(sessionId);
}

function mapOffer(row: OfferRow): NegotiationOffer {
  const items = (
    db
      .prepare(
        `SELECT i.product_id, p.sku, p.name, i.quantity, i.unit_price_paise,
                i.cost_snapshot_paise, i.list_snapshot_paise,
                i.target_snapshot_paise, i.floor_snapshot_paise, i.source
         FROM negotiation_offer_items i
         JOIN merchant_products p ON p.id = i.product_id
         WHERE i.offer_id = ? ORDER BY i.created_at, i.id`
      )
      .all(row.id) as OfferItemRow[]
  ).map((item) => ({
    productId: item.product_id,
    sku: item.sku,
    name: item.name,
    quantity: item.quantity,
    unitPricePaise: item.unit_price_paise,
    lineTotalPaise: item.quantity * item.unit_price_paise,
    source: item.source,
  }));
  return {
    id: row.id,
    sessionId: row.session_id,
    sequence: row.sequence,
    round: row.round,
    actor: row.actor,
    parentOfferId: row.parent_offer_id ?? undefined,
    status: row.status,
    totalPaise: row.total_paise,
    deliveryDate: row.delivery_date ?? undefined,
    depositBps: row.deposit_bps,
    depositPaise: Math.round((row.total_paise * row.deposit_bps) / 10_000),
    explanation: row.explanation,
    terms: JSON.parse(row.terms_json) as Record<string, unknown>,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    items,
  };
}

function insertOffer(input: {
  id: string;
  sessionId: string;
  sequence: number;
  round: number;
  actor: "buyer" | "seller";
  parentOfferId?: string;
  lines: PricedLine[];
  deliveryDate?: string;
  depositBps: number;
  explanation: string;
  terms: Record<string, unknown>;
  expiresAt: number;
  now: number;
}) {
  const totalPaise = totalFor(input.lines);
  db.prepare(
    `INSERT INTO negotiation_offers (
      id, session_id, sequence, round, actor, parent_offer_id, status,
      total_paise, delivery_date, deposit_bps, explanation, terms_json,
      expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    input.sessionId,
    input.sequence,
    input.round,
    input.actor,
    input.parentOfferId ?? null,
    totalPaise,
    input.deliveryDate ?? null,
    input.depositBps,
    input.explanation,
    JSON.stringify(input.terms),
    input.expiresAt,
    input.now
  );
  for (const line of input.lines) {
    db.prepare(
      `INSERT INTO negotiation_offer_items (
        id, offer_id, product_id, quantity, unit_price_paise,
        cost_snapshot_paise, list_snapshot_paise, target_snapshot_paise,
        floor_snapshot_paise, source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newId("item"),
      input.id,
      line.product.id,
      line.quantity,
      line.unitPricePaise,
      line.product.costPaise,
      line.product.listPricePaise,
      line.product.targetPricePaise,
      line.product.floorPricePaise,
      line.source,
      input.now
    );
  }
}

function getPricedLines(offerId: string, merchantId: string): PricedLine[] {
  const rows = db
    .prepare(
      `SELECT i.product_id, p.sku, p.name, p.merchant_id, p.category,
              p.description, p.unit, p.currency, p.min_quantity, p.max_quantity,
              p.quantity_step, p.metadata_json, i.quantity, i.unit_price_paise,
              i.cost_snapshot_paise, i.list_snapshot_paise,
              i.target_snapshot_paise, i.floor_snapshot_paise, i.source
       FROM negotiation_offer_items i
       JOIN merchant_products p ON p.id = i.product_id
       WHERE i.offer_id = ? AND p.merchant_id = ?`
    )
    .all(offerId, merchantId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    product: {
      id: row.product_id as string,
      merchantId: row.merchant_id as string,
      sku: row.sku as string,
      name: row.name as string,
      category: row.category as string,
      description: row.description as string,
      unit: row.unit as string,
      currency: row.currency as "INR",
      costPaise: row.cost_snapshot_paise as number,
      listPricePaise: row.list_snapshot_paise as number,
      targetPricePaise: row.target_snapshot_paise as number,
      floorPricePaise: row.floor_snapshot_paise as number,
      minQuantity: row.min_quantity as number,
      maxQuantity: row.max_quantity as number,
      quantityStep: row.quantity_step as number,
      metadata: JSON.parse(row.metadata_json as string) as Record<string, unknown>,
    },
    quantity: row.quantity as number,
    unitPricePaise: row.unit_price_paise as number,
    source: row.source as PricedLine["source"],
  }));
}

function getOpenSession(sessionId: string): SessionRow {
  const session = db
    .prepare(`SELECT * FROM negotiation_sessions WHERE id = ?`)
    .get(sessionId) as SessionRow | undefined;
  if (!session) throw new Error("Negotiation not found");
  if (session.status !== "open") {
    throw new Error(`Negotiation is already '${session.status}'`);
  }
  if (session.expires_at <= Date.now()) {
    db.prepare(
      `UPDATE negotiation_sessions SET status = 'expired', updated_at = ? WHERE id = ?`
    ).run(Date.now(), sessionId);
    throw new Error("Negotiation has expired");
  }
  return session;
}

function getOfferRow(offerId: string): OfferRow | undefined {
  return db
    .prepare(`SELECT * FROM negotiation_offers WHERE id = ?`)
    .get(offerId) as OfferRow | undefined;
}

function getRequirementBounds(sessionId: string): RequirementBounds[] {
  return (
    db
      .prepare(
        `SELECT product_id, min_quantity, target_quantity, max_quantity,
                required, substitutions_allowed, priority
         FROM negotiation_requirements WHERE session_id = ? ORDER BY priority DESC`
      )
      .all(sessionId) as RequirementRow[]
  ).map((row) => ({
    productId: row.product_id,
    minQuantity: row.min_quantity,
    targetQuantity: row.target_quantity,
    maxQuantity: row.max_quantity,
    required: Boolean(row.required),
    substitutionsAllowed: Boolean(row.substitutions_allowed),
    priority: row.priority,
  }));
}

function getPolicyById(policyId: string): SellerPolicy {
  const row = db
    .prepare(`SELECT * FROM seller_policies WHERE id = ?`)
    .get(policyId) as
    | {
        id: string;
        merchant_id: string;
        version: number;
        max_rounds: number;
        offer_ttl_seconds: number;
        concession_bps_per_round: number;
        max_discount_bps: number;
        min_bundle_margin_bps: number;
        deposit_bps: number;
      }
    | undefined;
  if (!row) throw new Error("Seller policy not found");
  return {
    id: row.id,
    merchantId: row.merchant_id,
    version: row.version,
    maxRounds: row.max_rounds,
    offerTtlSeconds: row.offer_ttl_seconds,
    concessionBpsPerRound: row.concession_bps_per_round,
    maxDiscountBps: row.max_discount_bps,
    minBundleMarginBps: row.min_bundle_margin_bps,
    depositBps: row.deposit_bps,
  };
}

function getPrivateTerms(sessionId: string) {
  const row = db
    .prepare(
      `SELECT buyer_max_total_paise, buyer_max_deposit_paise
       FROM negotiation_private_terms WHERE session_id = ?`
    )
    .get(sessionId) as
    | {
        buyer_max_total_paise: number;
        buyer_max_deposit_paise: number | null;
      }
    | undefined;
  if (!row) throw new Error("Buyer mandate terms not found");
  return row;
}

function insertEvent(
  sessionId: string,
  eventType: string,
  payload: Record<string, unknown>
) {
  db.prepare(
    `INSERT INTO negotiation_events (id, session_id, event_type, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(newId("evt"), sessionId, eventType, JSON.stringify(payload), Date.now());
}

function insertIdempotency(
  scope: string,
  key: string,
  resourceId: string,
  response: unknown = {},
  requestHash?: string
) {
  db.prepare(
    `INSERT INTO idempotency_keys (
      scope, key, resource_id, request_hash, response_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    scope,
    key,
    resourceId,
    requestHash ?? null,
    JSON.stringify(response),
    Date.now()
  );
}

function getIdempotentResource(
  scope: string,
  key: string,
  requestHash?: string
): string | null {
  const row = db
    .prepare(
      `SELECT resource_id, request_hash
       FROM idempotency_keys WHERE scope = ? AND key = ?`
    )
    .get(scope, key) as
    | { resource_id: string; request_hash: string | null }
    | undefined;
  assertIdempotencyPayload(row?.request_hash, requestHash);
  return row?.resource_id ?? null;
}

function getIdempotentResponse(
  scope: string,
  key: string,
  requestHash?: string
): unknown | null {
  const row = db
    .prepare(
      `SELECT response_json, request_hash
       FROM idempotency_keys WHERE scope = ? AND key = ?`
    )
    .get(scope, key) as
    | { response_json: string; request_hash: string | null }
    | undefined;
  assertIdempotencyPayload(row?.request_hash, requestHash);
  return row ? (JSON.parse(row.response_json) as unknown) : null;
}

function assertIdempotencyPayload(
  storedHash: string | null | undefined,
  requestHash: string | undefined
) {
  if (storedHash && requestHash && storedHash !== requestHash) {
    throw new Error(
      "Idempotency-Key has already been used with a different request payload"
    );
  }
}

function fingerprint(value: unknown) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(value, (key, item) =>
        key === "idempotencyKey" ? undefined : item
      )
    )
    .digest("hex");
}
