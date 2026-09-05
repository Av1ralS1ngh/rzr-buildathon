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

export async function createNegotiation(input: CreateNegotiationInput) {
  await ensureDefaultCommerceData();
  const requestHash = fingerprint(input);
  if (input.idempotencyKey) {
    const existing = await getIdempotentResource(
      "negotiation.create",
      input.idempotencyKey,
      requestHash
    );
    if (existing) return await getNegotiation(existing);
  }
  if (new Set(input.requirements.map((item) => item.productId)).size !== input.requirements.length) {
    throw new Error("Each requested product may appear only once");
  }

  const policy = await getActiveSellerPolicy(input.merchantId);
  if (!policy) throw new Error("Merchant has no active seller policy");
  const products = await getProducts(
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
    await db.transaction(async () => {
      await db
        .prepare(
          `INSERT INTO negotiation_sessions (
          id, merchant_id, buyer_agent_id, status, currency, seller_policy_id,
          current_round, delivery_date, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'open', 'INR', ?, 0, ?, ?, ?, ?)`
        )
        .run(
          sessionId,
          input.merchantId,
          input.buyerAgentId,
          policy.id,
          input.deliveryDate ?? null,
          sessionExpiresAt,
          now,
          now
        );
      await db
        .prepare(
          `INSERT INTO negotiation_private_terms (
          session_id, buyer_max_total_paise, buyer_max_deposit_paise,
          allow_cross_sell, cross_sell_budget_paise, allowed_cross_sell_json,
          metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
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
        await db
          .prepare(
            `INSERT INTO negotiation_requirements (
            id, session_id, product_id, min_quantity, target_quantity,
            max_quantity, required, substitutions_allowed, priority, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
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
      await insertOffer({
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
      await insertEvent(sessionId, "negotiation.opened", {
        openingOfferId: offerId,
        requestedProducts: requirements.map((item) => item.productId),
      });
      await createOpenMandates(sessionId);
      if (input.idempotencyKey) {
        await insertIdempotency(
          "negotiation.create",
          input.idempotencyKey,
          sessionId,
          {},
          requestHash
        );
      }
    });
  } catch (error) {
    if (input.idempotencyKey) {
      const existing = await getIdempotentResource(
        "negotiation.create",
        input.idempotencyKey,
        requestHash
      );
      if (existing) return await getNegotiation(existing);
    }
    throw error;
  }

  return await getNegotiation(sessionId);
}

export async function counterNegotiation(
  sessionId: string,
  input: CounterOfferInput
): Promise<NegotiationDecision> {
  const requestHash = fingerprint(input);
  if (input.idempotencyKey) {
    const existing = await getIdempotentResponse(
      `negotiation.counter:${sessionId}`,
      input.idempotencyKey,
      requestHash
    );
    if (existing) return existing as NegotiationDecision;
  }

  let result: NegotiationDecision | undefined;
  await db.transaction(async () => {
    const session = await getOpenSession(sessionId);
    const policy = await getPolicyById(session.seller_policy_id);
    const requirements = await getRequirementBounds(sessionId);
    const parent = await getOfferRow(input.parentOfferId);
    if (
      !parent ||
      parent.session_id !== sessionId ||
      parent.actor !== "seller" ||
      parent.status !== "active"
    ) {
      throw new Error("Counteroffer must reference the active seller offer");
    }
    if (parent.expires_at <= Date.now()) {
      await db
        .prepare(`UPDATE negotiation_offers SET status = 'expired' WHERE id = ?`)
        .run(parent.id);
      throw new Error("The seller offer has expired");
    }

    const nextRound = session.current_round + 1;
    const previousSellerLines = await getPricedLines(parent.id, session.merchant_id);
    const buyerLines = buyerProposalLines(
      previousSellerLines,
      input,
      requirements
    );
    const privateTerms = await getPrivateTerms(sessionId);
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

    await db
      .prepare(`UPDATE negotiation_offers SET status = 'countered' WHERE id = ?`)
      .run(parent.id);
    const buyerOfferId = newId("offer");
    const now = Date.now();
    await insertOffer({
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
    if (input.note) {
      await insertMessage(sessionId, "buyer", "chat", input.note, buyerOfferId);
    }

    if (input.awaitSeller) {
      await db
        .prepare(
          `UPDATE negotiation_sessions
         SET current_round = ?, updated_at = ?
         WHERE id = ? AND status = 'open'`
        )
        .run(nextRound, now, sessionId);
      await insertEvent(sessionId, "offer.buyer_submitted", {
        buyerOfferId,
        round: nextRound,
      });
      result = {
        outcome: "buyer_submitted",
        offer: await getOffer(buyerOfferId),
        reason: "Buyer offer is waiting for the seller agent.",
      };
    } else {
    const decision = sellerDecision({
      buyerLines,
      previousSellerLines,
      requirements,
      policy,
      round: nextRound,
      giveBacks: input.giveBacks,
    });

    if (decision.action === "accept") {
      await db
        .prepare(`UPDATE negotiation_offers SET status = 'accepted' WHERE id = ?`)
        .run(buyerOfferId);
      await db
        .prepare(
          `UPDATE negotiation_sessions
         SET status = 'agreed', current_round = ?, accepted_offer_id = ?, updated_at = ?
         WHERE id = ? AND status = 'open'`
        )
        .run(nextRound, buyerOfferId, now, sessionId);
      await insertEvent(sessionId, "negotiation.agreed", {
        acceptedOfferId: buyerOfferId,
        round: nextRound,
      });
      await createClosedMandates(sessionId, buyerOfferId);
      result = {
        outcome: "accepted",
        acceptedOfferId: buyerOfferId,
        reason: decision.reason,
      };
    } else if (decision.action === "reject") {
      await db
        .prepare(`UPDATE negotiation_offers SET status = 'rejected' WHERE id = ?`)
        .run(buyerOfferId);
      await db
        .prepare(
          `UPDATE negotiation_sessions
         SET status = 'rejected', current_round = ?, updated_at = ?
         WHERE id = ? AND status = 'open'`
        )
        .run(nextRound, now, sessionId);
      await insertEvent(sessionId, "negotiation.rejected", { round: nextRound });
      result = { outcome: "rejected", reason: decision.reason };
    } else {
      await db
        .prepare(`UPDATE negotiation_offers SET status = 'countered' WHERE id = ?`)
        .run(buyerOfferId);
      const sellerOfferId = newId("offer");
      await insertOffer({
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
      await db
        .prepare(
          `UPDATE negotiation_sessions
         SET current_round = ?, updated_at = ?
         WHERE id = ? AND status = 'open'`
        )
        .run(nextRound, now, sessionId);
      await insertEvent(sessionId, "offer.countered", {
        buyerOfferId,
        sellerOfferId,
        round: nextRound,
      });
      result = {
        outcome: "countered",
        offer: await getOffer(sellerOfferId),
        reason: decision.reason,
      };
    }
    }

    if (input.idempotencyKey && result) {
      await insertIdempotency(
        `negotiation.counter:${sessionId}`,
        input.idempotencyKey,
        result.outcome === "countered" ? result.offer.id : sessionId,
        result,
        requestHash
      );
    }
  });
  if (!result) throw new Error("Negotiation decision was not produced");
  return result;
}

export async function respondAsSeller(
  sessionId: string,
  input: { note?: string; idempotencyKey?: string } = {}
): Promise<NegotiationDecision> {
  const requestHash = fingerprint(input);
  if (input.idempotencyKey) {
    const existing = await getIdempotentResponse(
      `negotiation.respond:${sessionId}`,
      input.idempotencyKey,
      requestHash
    );
    if (existing) return existing as NegotiationDecision;
  }

  let result: NegotiationDecision | undefined;
  await db.transaction(async () => {
    const session = await getOpenSession(sessionId);
    const policy = await getPolicyById(session.seller_policy_id);
    const requirements = await getRequirementBounds(sessionId);
    const buyerOffer = await db
      .prepare(
        `SELECT * FROM negotiation_offers
         WHERE session_id = ? AND actor = 'buyer' AND status = 'active'
         ORDER BY sequence DESC LIMIT 1`
      )
      .get<OfferRow>(sessionId);
    if (!buyerOffer) {
      throw new Error("No buyer offer is waiting for a seller response");
    }
    if (!buyerOffer.parent_offer_id) {
      throw new Error("Buyer offer is missing its parent seller offer");
    }
    const parent = await getOfferRow(buyerOffer.parent_offer_id);
    if (!parent) throw new Error("Previous seller offer was not found");
    const buyerLines = await getPricedLines(buyerOffer.id, session.merchant_id);
    const previousSellerLines = await getPricedLines(parent.id, session.merchant_id);
    const giveBacks = (
      JSON.parse(buyerOffer.terms_json) as { giveBacks?: CounterOfferInput["giveBacks"] }
    ).giveBacks ?? [];
    const now = Date.now();
    const round = buyerOffer.round;
    const decision = sellerDecision({
      buyerLines,
      previousSellerLines,
      requirements,
      policy,
      round,
      giveBacks,
    });
    if (input.note) {
      await insertMessage(sessionId, "seller", "chat", input.note, buyerOffer.id);
    }

    if (decision.action === "accept") {
      await db
        .prepare(`UPDATE negotiation_offers SET status = 'accepted' WHERE id = ?`)
        .run(buyerOffer.id);
      await db
        .prepare(
          `UPDATE negotiation_sessions
         SET status = 'agreed', current_round = ?, accepted_offer_id = ?, updated_at = ?
         WHERE id = ? AND status = 'open'`
        )
        .run(round, buyerOffer.id, now, sessionId);
      await insertEvent(sessionId, "negotiation.agreed", {
        acceptedOfferId: buyerOffer.id,
        round,
      });
      await createClosedMandates(sessionId, buyerOffer.id);
      result = {
        outcome: "accepted",
        acceptedOfferId: buyerOffer.id,
        reason: decision.reason,
      };
    } else if (decision.action === "reject") {
      await db
        .prepare(`UPDATE negotiation_offers SET status = 'rejected' WHERE id = ?`)
        .run(buyerOffer.id);
      await db
        .prepare(
          `UPDATE negotiation_sessions
         SET status = 'rejected', current_round = ?, updated_at = ?
         WHERE id = ? AND status = 'open'`
        )
        .run(round, now, sessionId);
      await insertEvent(sessionId, "negotiation.rejected", { round });
      result = { outcome: "rejected", reason: decision.reason };
    } else {
      await db
        .prepare(`UPDATE negotiation_offers SET status = 'countered' WHERE id = ?`)
        .run(buyerOffer.id);
      const sellerOfferId = newId("offer");
      await insertOffer({
        id: sellerOfferId,
        sessionId,
        sequence: buyerOffer.sequence + 1,
        round,
        actor: "seller",
        parentOfferId: buyerOffer.id,
        lines: decision.lines,
        deliveryDate: buyerOffer.delivery_date ?? undefined,
        depositBps: buyerOffer.deposit_bps,
        explanation: decision.reason,
        terms: {
          concessionRound: round,
          reciprocalGiveBacks: giveBacks,
        },
        expiresAt: now + policy.offerTtlSeconds * 1000,
        now,
      });
      await db
        .prepare(
          `UPDATE negotiation_sessions SET updated_at = ? WHERE id = ? AND status = 'open'`
        )
        .run(now, sessionId);
      await insertEvent(sessionId, "offer.countered", {
        buyerOfferId: buyerOffer.id,
        sellerOfferId,
        round,
      });
      result = {
        outcome: "countered",
        offer: await getOffer(sellerOfferId),
        reason: decision.reason,
      };
    }

    if (input.idempotencyKey && result) {
      await insertIdempotency(
        `negotiation.respond:${sessionId}`,
        input.idempotencyKey,
        result.outcome === "countered" ? result.offer.id : sessionId,
        result,
        requestHash
      );
    }
  });
  if (!result) throw new Error("Seller response was not produced");
  return result;
}

export async function postNegotiationMessage(
  sessionId: string,
  actor: "buyer" | "seller",
  body: string
) {
  const session = await db
    .prepare(`SELECT id FROM negotiation_sessions WHERE id = ?`)
    .get(sessionId);
  if (!session) throw new Error("Negotiation not found");
  return insertMessage(sessionId, actor, "chat", body);
}

export async function listNegotiationMessages(sessionId: string) {
  const rows = await db
    .prepare(
      `SELECT id, session_id, actor, kind, body, offer_id, created_at
       FROM negotiation_messages WHERE session_id = ? ORDER BY created_at ASC, id ASC`
    )
    .all<{
      id: string;
      session_id: string;
      actor: "buyer" | "seller" | "system";
      kind: "chat" | "offer" | "system";
      body: string;
      offer_id: string | null;
      created_at: number;
    }>(sessionId);
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    actor: row.actor,
    kind: row.kind,
    body: row.body,
    offerId: row.offer_id ?? undefined,
    createdAt: row.created_at,
  }));
}

export async function acceptSellerOffer(
  sessionId: string,
  offerId: string,
  idempotencyKey?: string
) {
  const scope = `negotiation.accept:${sessionId}`;
  const requestHash = fingerprint({ offerId, idempotencyKey });
  if (idempotencyKey) {
    const existing = await getIdempotentResource(scope, idempotencyKey, requestHash);
    if (existing) return await getNegotiation(existing);
  }
  try {
    await db.transaction(async () => {
      const session = await getOpenSession(sessionId);
      const offer = await getOfferRow(offerId);
      if (
        !offer ||
        offer.session_id !== sessionId ||
        offer.actor !== "seller" ||
        offer.status !== "active"
      ) {
        throw new Error("Only the active seller offer can be accepted");
      }
      if (offer.expires_at <= Date.now()) throw new Error("The offer has expired");
      const lines = await getPricedLines(offerId, session.merchant_id);
      const requirements = await getRequirementBounds(sessionId);
      const privateTerms = await getPrivateTerms(sessionId);
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
      await db
        .prepare(`UPDATE negotiation_offers SET status = 'accepted' WHERE id = ?`)
        .run(offerId);
      const update = await db
        .prepare(
          `UPDATE negotiation_sessions
       SET status = 'agreed', accepted_offer_id = ?, updated_at = ?
       WHERE id = ? AND status = 'open'`
        )
        .run(offerId, now, sessionId);
      if (update.changes !== 1) throw new Error("Negotiation changed concurrently");
      await insertEvent(sessionId, "negotiation.agreed", {
        acceptedOfferId: offerId,
        round: offer.round,
      });
      await createClosedMandates(sessionId, offerId);
      if (idempotencyKey) {
        await insertIdempotency(scope, idempotencyKey, sessionId, {}, requestHash);
      }
    });
  } catch (error) {
    if (idempotencyKey) {
      const existing = await getIdempotentResource(scope, idempotencyKey, requestHash);
      if (existing) return await getNegotiation(existing);
    }
    throw error;
  }
  return await getNegotiation(sessionId);
}

export async function runAutonomousNegotiation(sessionId: string) {
  for (let step = 0; step < 20; step += 1) {
    const session = await getNegotiation(sessionId);
    if (session.status !== "open") return session;
    const activeSellerOffer = [...session.offers]
      .reverse()
      .find((offer) => offer.actor === "seller" && offer.status === "active");
    if (!activeSellerOffer) throw new Error("No active seller offer found");
    const privateTerms = await getPrivateTerms(sessionId);
    const pricedLines = await getPricedLines(
      activeSellerOffer.id,
      session.merchantId
    );
    const requirements = await getRequirementBounds(sessionId);
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

    const decision = await counterNegotiation(sessionId, {
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
    if (decision.outcome !== "countered") return await getNegotiation(sessionId);
  }
  throw new Error("Negotiation exceeded the safety iteration limit");
}

export async function replaceWithSellerBundle(input: {
  sessionId: string;
  parentOfferId: string;
  bundleId: string;
  lines: PricedLine[];
  strategy: string;
  explanation: string;
}) {
  let offerId = "";
  await db.transaction(async () => {
    const session = await getOpenSession(input.sessionId);
    const option = await db
      .prepare(
        `SELECT id FROM bundle_options
         WHERE id = ? AND session_id = ? AND parent_offer_id = ? AND status = 'active'`
      )
      .get(input.bundleId, input.sessionId, input.parentOfferId);
    if (!option) throw new Error("Bundle option is no longer active");
    const parent = await getOfferRow(input.parentOfferId);
    if (
      !parent ||
      parent.session_id !== input.sessionId ||
      parent.actor !== "seller" ||
      parent.status !== "active"
    ) {
      throw new Error("Bundle must replace the active seller offer");
    }
    const policy = await getPolicyById(session.seller_policy_id);
    const now = Date.now();
    const requirementIds = new Set(
      (await getRequirementBounds(input.sessionId)).map(
        (requirement) => requirement.productId
      )
    );
    for (const line of input.lines) {
      if (requirementIds.has(line.product.id)) continue;
      await db
        .prepare(
          `INSERT INTO negotiation_requirements (
          id, session_id, product_id, min_quantity, target_quantity,
          max_quantity, required, substitutions_allowed, priority, created_at
        ) VALUES (?, ?, ?, 0, ?, ?, 0, 0, 25, ?)`
        )
        .run(
          newId("req"),
          input.sessionId,
          line.product.id,
          line.quantity,
          line.product.maxQuantity,
          now
        );
    }
    await db
      .prepare(`UPDATE negotiation_offers SET status = 'countered' WHERE id = ?`)
      .run(parent.id);
    offerId = newId("offer");
    await insertOffer({
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
    await db
      .prepare(
        `UPDATE bundle_options SET status = 'dismissed' WHERE session_id = ? AND status = 'active'`
      )
      .run(input.sessionId);
    await db
      .prepare(`UPDATE bundle_options SET status = 'selected' WHERE id = ?`)
      .run(input.bundleId);
    await db
      .prepare(`UPDATE negotiation_sessions SET updated_at = ? WHERE id = ?`)
      .run(now, input.sessionId);
    await insertEvent(input.sessionId, "bundle.selected", {
      bundleId: input.bundleId,
      sellerOfferId: offerId,
      strategy: input.strategy,
    });
  });
  return getOffer(offerId);
}

export async function getNegotiation(
  sessionId: string,
  options?: { role?: "buyer" | "seller" }
) {
  const session = await db
    .prepare(`SELECT * FROM negotiation_sessions WHERE id = ?`)
    .get<SessionRow>(sessionId);
  if (!session) throw new Error("Negotiation not found");
  const requirements = await getRequirementBounds(sessionId);
  const offerRows = await db
    .prepare(
      `SELECT * FROM negotiation_offers
         WHERE session_id = ? ORDER BY sequence ASC`
    )
    .all<OfferRow>(sessionId);
  const includeAuthority = options?.role === "seller";
  const offers = await Promise.all(
    offerRows.map((row) => mapOffer(row, includeAuthority))
  );
  const eventRows = await db
    .prepare(
      `SELECT id, event_type, payload_json, created_at
         FROM negotiation_events WHERE session_id = ? ORDER BY created_at ASC`
    )
    .all<{
      id: string;
      event_type: string;
      payload_json: string;
      created_at: number;
    }>(sessionId);
  const events = eventRows.map((event) => ({
    id: event.id,
    type: event.event_type,
    payload: JSON.parse(event.payload_json) as Record<string, unknown>,
    createdAt: event.created_at,
  }));
  const messages = await listNegotiationMessages(sessionId);
  const lastActive = [...offers].reverse().find((offer) => offer.status === "active");
  const waitingFor =
    session.status !== "open"
      ? null
      : lastActive?.actor === "seller"
        ? "buyer"
        : lastActive?.actor === "buyer"
          ? "seller"
          : "buyer";
  const policy = await getPolicyById(session.seller_policy_id);
  const base = {
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
    waitingFor,
    policy: {
      id: policy.id,
      version: policy.version,
      maxRounds: policy.maxRounds,
      concessionBpsPerRound: policy.concessionBpsPerRound,
      maxDiscountBps: policy.maxDiscountBps,
      minBundleMarginBps: policy.minBundleMarginBps,
      depositBps: policy.depositBps,
      offerTtlSeconds: policy.offerTtlSeconds,
    },
    requirements,
    offers,
    events,
    messages,
  };
  if (options?.role === "buyer") {
    const terms = await getPrivateTerms(sessionId);
    return {
      ...base,
      mandate: {
        maxTotalPaise: terms.buyer_max_total_paise,
        maxDepositPaise: terms.buyer_max_deposit_paise,
      },
    };
  }
  if (includeAuthority) {
    const products = await getProducts(
      [...new Set(requirements.map((item) => item.productId))],
      session.merchant_id
    );
    return {
      ...base,
      authority: {
        products: products.map((product) => ({
          id: product.id,
          sku: product.sku,
          name: product.name,
          unit: product.unit,
          costPaise: product.costPaise,
          listPricePaise: product.listPricePaise,
          targetPricePaise: product.targetPricePaise,
          floorPricePaise: product.floorPricePaise,
          minQuantity: product.minQuantity,
          maxQuantity: product.maxQuantity,
        })),
      },
    };
  }
  return base;
}

export async function getOffer(offerId: string): Promise<NegotiationOffer> {
  const row = await getOfferRow(offerId);
  if (!row) throw new Error("Offer not found");
  return mapOffer(row);
}

export async function cancelNegotiation(sessionId: string) {
  await db.transaction(async () => {
    const session = await db
      .prepare(`SELECT status FROM negotiation_sessions WHERE id = ?`)
      .get<{ status: string }>(sessionId);
    if (!session) throw new Error("Negotiation not found");
    if (session.status === "cancelled") return;
    if (session.status !== "open") {
      throw new Error(`Negotiation cannot be cancelled while '${session.status}'`);
    }
    const now = Date.now();
    await db
      .prepare(
        `UPDATE negotiation_sessions
       SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'open'`
      )
      .run(now, sessionId);
    await db
      .prepare(
        `UPDATE negotiation_offers
       SET status = 'rejected' WHERE session_id = ? AND status = 'active'`
      )
      .run(sessionId);
    await db
      .prepare(
        `UPDATE bundle_options
       SET status = 'dismissed' WHERE session_id = ? AND status = 'active'`
      )
      .run(sessionId);
    await insertEvent(sessionId, "negotiation.cancelled", {});
  });
  return await getNegotiation(sessionId);
}

async function mapOffer(
  row: OfferRow,
  includeAuthority = false
): Promise<NegotiationOffer> {
  const items = (
    await db
      .prepare(
        `SELECT i.product_id, p.sku, p.name, i.quantity, i.unit_price_paise,
                i.cost_snapshot_paise, i.list_snapshot_paise,
                i.target_snapshot_paise, i.floor_snapshot_paise, i.source
         FROM negotiation_offer_items i
         JOIN merchant_products p ON p.id = i.product_id
         WHERE i.offer_id = ? ORDER BY i.created_at, i.id`
      )
      .all<OfferItemRow>(row.id)
  ).map((item) => ({
    productId: item.product_id,
    sku: item.sku,
    name: item.name,
    quantity: item.quantity,
    unitPricePaise: item.unit_price_paise,
    lineTotalPaise: item.quantity * item.unit_price_paise,
    source: item.source,
    ...(includeAuthority
      ? {
          costPaise: item.cost_snapshot_paise,
          listPaise: item.list_snapshot_paise,
          targetPaise: item.target_snapshot_paise,
          floorPaise: item.floor_snapshot_paise,
        }
      : {}),
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

async function insertOffer(input: {
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
  await db
    .prepare(
      `INSERT INTO negotiation_offers (
      id, session_id, sequence, round, actor, parent_offer_id, status,
      total_paise, delivery_date, deposit_bps, explanation, terms_json,
      expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
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
    await db
      .prepare(
        `INSERT INTO negotiation_offer_items (
        id, offer_id, product_id, quantity, unit_price_paise,
        cost_snapshot_paise, list_snapshot_paise, target_snapshot_paise,
        floor_snapshot_paise, source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
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

async function getPricedLines(offerId: string, merchantId: string): Promise<PricedLine[]> {
  const rows = await db
    .prepare(
      `SELECT i.product_id, p.sku, p.name, p.merchant_id, p.category,
              p.description, p.unit, p.currency, p.min_quantity, p.max_quantity,
              p.quantity_step, p.metadata_json, p.active, i.quantity, i.unit_price_paise,
              i.cost_snapshot_paise, i.list_snapshot_paise,
              i.target_snapshot_paise, i.floor_snapshot_paise, i.source
       FROM negotiation_offer_items i
       JOIN merchant_products p ON p.id = i.product_id
       WHERE i.offer_id = ? AND p.merchant_id = ?`
    )
    .all<Record<string, unknown>>(offerId, merchantId);
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
      active: (row.active as number) !== 0,
      metadata: JSON.parse(row.metadata_json as string) as Record<string, unknown>,
    },
    quantity: row.quantity as number,
    unitPricePaise: row.unit_price_paise as number,
    source: row.source as PricedLine["source"],
  }));
}

async function getOpenSession(sessionId: string): Promise<SessionRow> {
  const session = await db
    .prepare(`SELECT * FROM negotiation_sessions WHERE id = ?`)
    .get<SessionRow>(sessionId);
  if (!session) throw new Error("Negotiation not found");
  if (session.status !== "open") {
    throw new Error(`Negotiation is already '${session.status}'`);
  }
  if (session.expires_at <= Date.now()) {
    await db
      .prepare(
        `UPDATE negotiation_sessions SET status = 'expired', updated_at = ? WHERE id = ?`
      )
      .run(Date.now(), sessionId);
    throw new Error("Negotiation has expired");
  }
  return session;
}

async function getOfferRow(offerId: string): Promise<OfferRow | undefined> {
  return db
    .prepare(`SELECT * FROM negotiation_offers WHERE id = ?`)
    .get<OfferRow>(offerId);
}

async function getRequirementBounds(sessionId: string): Promise<RequirementBounds[]> {
  const rows = await db
    .prepare(
      `SELECT product_id, min_quantity, target_quantity, max_quantity,
                required, substitutions_allowed, priority
         FROM negotiation_requirements WHERE session_id = ? ORDER BY priority DESC`
    )
    .all<RequirementRow>(sessionId);
  return rows.map((row) => ({
    productId: row.product_id,
    minQuantity: row.min_quantity,
    targetQuantity: row.target_quantity,
    maxQuantity: row.max_quantity,
    required: Boolean(row.required),
    substitutionsAllowed: Boolean(row.substitutions_allowed),
    priority: row.priority,
  }));
}

async function getPolicyById(policyId: string): Promise<SellerPolicy> {
  const row = await db
    .prepare(`SELECT * FROM seller_policies WHERE id = ?`)
    .get<{
      id: string;
      merchant_id: string;
      version: number;
      max_rounds: number;
      offer_ttl_seconds: number;
      concession_bps_per_round: number;
      max_discount_bps: number;
      min_bundle_margin_bps: number;
      deposit_bps: number;
    }>(policyId);
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

async function getPrivateTerms(sessionId: string) {
  const row = await db
    .prepare(
      `SELECT buyer_max_total_paise, buyer_max_deposit_paise
       FROM negotiation_private_terms WHERE session_id = ?`
    )
    .get<{
      buyer_max_total_paise: number;
      buyer_max_deposit_paise: number | null;
    }>(sessionId);
  if (!row) throw new Error("Buyer mandate terms not found");
  return row;
}

async function insertMessage(
  sessionId: string,
  actor: "buyer" | "seller" | "system",
  kind: "chat" | "offer" | "system",
  body: string,
  offerId?: string
) {
  const id = newId("msg");
  const createdAt = Date.now();
  await db
    .prepare(
      `INSERT INTO negotiation_messages (
        id, session_id, actor, kind, body, offer_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, sessionId, actor, kind, body, offerId ?? null, createdAt);
  return {
    id,
    sessionId,
    actor,
    kind,
    body,
    offerId,
    createdAt,
  };
}

async function insertEvent(
  sessionId: string,
  eventType: string,
  payload: Record<string, unknown>
) {
  await db
    .prepare(
      `INSERT INTO negotiation_events (id, session_id, event_type, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?)`
    )
    .run(newId("evt"), sessionId, eventType, JSON.stringify(payload), Date.now());
}

async function insertIdempotency(
  scope: string,
  key: string,
  resourceId: string,
  response: unknown = {},
  requestHash?: string
) {
  await db
    .prepare(
      `INSERT INTO idempotency_keys (
      scope, key, resource_id, request_hash, response_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      scope,
      key,
      resourceId,
      requestHash ?? null,
      JSON.stringify(response),
      Date.now()
    );
}

async function getIdempotentResource(
  scope: string,
  key: string,
  requestHash?: string
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT resource_id, request_hash
       FROM idempotency_keys WHERE scope = ? AND key = ?`
    )
    .get<{ resource_id: string; request_hash: string | null }>(scope, key);
  assertIdempotencyPayload(row?.request_hash, requestHash);
  return row?.resource_id ?? null;
}

async function getIdempotentResponse(
  scope: string,
  key: string,
  requestHash?: string
): Promise<unknown | null> {
  const row = await db
    .prepare(
      `SELECT response_json, request_hash
       FROM idempotency_keys WHERE scope = ? AND key = ?`
    )
    .get<{ response_json: string; request_hash: string | null }>(scope, key);
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
