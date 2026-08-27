import crypto, { type JsonWebKey } from "crypto";
import db from "../db";
import { newId } from "../commitment";

export type MandateAudience = "buyer" | "seller" | "processor" | "shared";

type MandateRow = {
  id: string;
  session_id: string;
  mandate_type: string;
  vct: string;
  state: "open" | "closed" | "receipt" | "revoked";
  visibility: MandateAudience;
  issuer: string;
  audience: string;
  parent_mandate_id: string | null;
  payload_json: string;
  payload_hash: string;
  compact_jws: string;
  algorithm: "ES256";
  key_id: string;
  issued_at: number;
  expires_at: number;
  verified_at: number | null;
};

export function createOpenMandates(sessionId: string): void {
  if (getMandateRow(sessionId, "checkout", "open")) return;
  const context = getMandateContext(sessionId);
  const checkout = createMandate({
    sessionId,
    mandateType: "checkout",
    vct: "mandate.checkout.open.1",
    state: "open",
    visibility: "shared",
    issuer: context.buyerAgentId,
    audience: context.merchantId,
    expiresAt: context.expiresAt,
    claims: {
      intent: {
        currency: "INR",
        deliveryDate: context.deliveryDate,
        requirements: context.requirements,
        crossSell: {
          allowed: context.allowCrossSell,
          allowedProductIds: context.allowedCrossSellProductIds,
        },
      },
    },
  });
  createMandate({
    sessionId,
    mandateType: "payment",
    vct: "mandate.payment.open.1",
    state: "open",
    visibility: "processor",
    issuer: context.buyerAgentId,
    audience: "payment-processor",
    expiresAt: context.expiresAt,
    parentMandateId: checkout.id,
    claims: {
      constraints: {
        currency: "INR",
        amountRange: { min: 0, max: context.buyerMaxTotalPaise },
        maximumDeposit: context.buyerMaxDepositPaise,
        allowedPayees: [context.merchantId],
        allowedPaymentHandlers: ["razorpay"],
        reference: checkout.payloadHash,
      },
    },
  });
  createMandate({
    sessionId,
    mandateType: "seller_authority",
    vct: "speclock.seller-authority.1",
    state: "open",
    visibility: "seller",
    issuer: context.merchantId,
    audience: "seller-agent",
    expiresAt: context.expiresAt,
    claims: {
      policy: {
        policyId: context.sellerPolicy.id,
        version: context.sellerPolicy.version,
        maxRounds: context.sellerPolicy.maxRounds,
        depositBps: context.sellerPolicy.depositBps,
        concessionBpsPerRound: context.sellerPolicy.concessionBpsPerRound,
        maxDiscountBps: context.sellerPolicy.maxDiscountBps,
        minimumBundleMarginBps: context.sellerPolicy.minBundleMarginBps,
      },
      productAuthority: context.products.map((product) => ({
        productId: product.id,
        costPaise: product.costPaise,
        floorPricePaise: product.floorPricePaise,
        targetPricePaise: product.targetPricePaise,
        listPricePaise: product.listPricePaise,
      })),
    },
  });
}

export function createClosedMandates(sessionId: string, acceptedOfferId: string): void {
  if (getMandateRow(sessionId, "checkout", "closed")) return;
  const session = db
    .prepare(
      `SELECT merchant_id, buyer_agent_id, expires_at
       FROM negotiation_sessions WHERE id = ? AND status = 'agreed'`
    )
    .get(sessionId) as
    | { merchant_id: string; buyer_agent_id: string; expires_at: number }
    | undefined;
  if (!session) throw new Error("Agreed negotiation not found for mandate closure");
  const offer = getOfferForMandate(sessionId, acceptedOfferId);
  const openCheckout = requireMandate(sessionId, "checkout", "open");
  const openPayment = requireMandate(sessionId, "payment", "open");

  const checkout = createMandate({
    sessionId,
    mandateType: "checkout",
    vct: "mandate.checkout.1",
    state: "closed",
    visibility: "shared",
    issuer: session.buyer_agent_id,
    audience: session.merchant_id,
    expiresAt: Math.min(session.expires_at, offer.expiresAt),
    parentMandateId: openCheckout.id,
    claims: {
      checkout: {
        offerId: acceptedOfferId,
        currency: "INR",
        items: offer.items,
        totalPaise: offer.totalPaise,
        depositBps: offer.depositBps,
        depositPaise: offer.depositPaise,
        deliveryDate: offer.deliveryDate,
        openMandateHash: openCheckout.payload_hash,
      },
    },
  });
  createMandate({
    sessionId,
    mandateType: "payment",
    vct: "mandate.payment.1",
    state: "closed",
    visibility: "processor",
    issuer: session.buyer_agent_id,
    audience: "razorpay",
    expiresAt: Math.min(session.expires_at, offer.expiresAt),
    parentMandateId: openPayment.id,
    claims: {
      transactionId: sha256(checkout.compactJws!),
      payee: { id: session.merchant_id },
      paymentAmount: { currency: "INR", amount: offer.depositPaise },
      paymentInstrument: { handler: "razorpay", mode: "delegated_checkout" },
      checkoutMandateHash: checkout.payloadHash,
      openPaymentMandateHash: openPayment.payload_hash,
    },
  });
}

export function createPaymentReceipt(input: {
  sessionId: string;
  commerceOrderId: string;
  paymentId: string;
  amountPaise: number;
}) {
  const existing = getMandateRow(input.sessionId, "payment_receipt", "receipt");
  if (existing) return toMandate(existing, true);
  const payment = requireMandate(input.sessionId, "payment", "closed");
  return createMandate({
    sessionId: input.sessionId,
    mandateType: "payment_receipt",
    vct: "speclock.payment-receipt.1",
    state: "receipt",
    visibility: "shared",
    issuer: "razorpay-adapter",
    audience: "buyer-and-merchant",
    expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
    parentMandateId: payment.id,
    claims: {
      receipt: {
        commerceOrderId: input.commerceOrderId,
        paymentId: input.paymentId,
        amount: { currency: "INR", value: input.amountPaise },
        paymentMandateHash: payment.payload_hash,
        capturedAt: new Date().toISOString(),
      },
    },
  });
}

export function listMandates(
  sessionId: string,
  audience: MandateAudience = "shared"
) {
  const allowed =
    audience === "shared" ? ["shared"] : ["shared", audience];
  const placeholders = allowed.map(() => "?").join(", ");
  return (
    db
      .prepare(
        `SELECT * FROM mandate_artifacts
         WHERE session_id = ? AND visibility IN (${placeholders})
         ORDER BY issued_at ASC`
      )
      .all(sessionId, ...allowed) as MandateRow[]
  ).map((row) => toMandate(row, true));
}

export function getMandate(
  sessionId: string,
  mandateType: string,
  state: MandateRow["state"]
) {
  const row = requireMandate(sessionId, mandateType, state);
  return toMandate(row, true);
}

export function verifyMandate(compactJws: string) {
  const [encodedHeader, encodedPayload, encodedSignature] = compactJws.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    return { valid: false, reason: "Malformed compact JWS" };
  }
  try {
    const header = JSON.parse(fromBase64Url(encodedHeader).toString("utf8")) as {
      alg?: string;
      kid?: string;
    };
    const payload = JSON.parse(fromBase64Url(encodedPayload).toString("utf8")) as {
      iss?: string;
      exp?: number;
    };
    if (header.alg !== "ES256" || !header.kid || !payload.iss) {
      return { valid: false, reason: "Unsupported mandate header" };
    }
    if (payload.exp && payload.exp <= Math.floor(Date.now() / 1000)) {
      return { valid: false, reason: "Mandate expired" };
    }
    const keys = keysForIssuer(payload.iss);
    if (keys.keyId !== header.kid) {
      return { valid: false, reason: "Signing key mismatch" };
    }
    const valid = crypto.verify(
      "sha256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      { key: keys.publicKey, dsaEncoding: "ieee-p1363" },
      fromBase64Url(encodedSignature)
    );
    return valid
      ? { valid: true, payload, protectedHeader: header }
      : { valid: false, reason: "Invalid signature" };
  } catch {
    return { valid: false, reason: "Invalid mandate encoding" };
  }
}

export function publicJwkForIssuer(issuer: string) {
  const keys = keysForIssuer(issuer);
  return { ...keys.publicJwk, kid: keys.keyId, use: "sig", alg: "ES256" };
}

function createMandate(input: {
  sessionId: string;
  mandateType: string;
  vct: string;
  state: "open" | "closed" | "receipt";
  visibility: MandateAudience;
  issuer: string;
  audience: string;
  expiresAt: number;
  parentMandateId?: string;
  claims: Record<string, unknown>;
}) {
  const existing = getMandateRow(input.sessionId, input.mandateType, input.state);
  if (existing) return toMandate(existing, true);
  const id = newId("mandate");
  const now = Date.now();
  const keys = keysForIssuer(input.issuer);
  const payload = {
    iss: input.issuer,
    sub: input.sessionId,
    aud: input.audience,
    iat: Math.floor(now / 1000),
    exp: Math.floor(input.expiresAt / 1000),
    jti: id,
    vct: input.vct,
    _sd_alg: "sha-256",
    ...input.claims,
  };
  const payloadJson = canonicalJson(payload);
  const payloadHash = sha256(payloadJson);
  const compactJws = signPayload(payload, keys);
  const verification = verifyMandate(compactJws);
  if (!verification.valid) {
    throw new Error(
      `Generated mandate failed verification: ${verification.reason ?? "unknown reason"}`
    );
  }
  db.prepare(
    `INSERT INTO mandate_artifacts (
      id, session_id, mandate_type, vct, state, visibility, issuer, audience,
      parent_mandate_id, payload_json, payload_hash, compact_jws, algorithm,
      key_id, issued_at, expires_at, verified_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ES256', ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.sessionId,
    input.mandateType,
    input.vct,
    input.state,
    input.visibility,
    input.issuer,
    input.audience,
    input.parentMandateId ?? null,
    payloadJson,
    payloadHash,
    compactJws,
    keys.keyId,
    now,
    input.expiresAt,
    now,
    now
  );
  return {
    id,
    sessionId: input.sessionId,
    mandateType: input.mandateType,
    vct: input.vct,
    state: input.state,
    visibility: input.visibility,
    issuer: input.issuer,
    audience: input.audience,
    parentMandateId: input.parentMandateId,
    payload,
    payloadHash,
    compactJws,
    algorithm: "ES256" as const,
    keyId: keys.keyId,
    issuedAt: now,
    expiresAt: input.expiresAt,
    verifiedAt: now,
  };
}

function signPayload(
  payload: Record<string, unknown>,
  keys: ReturnType<typeof keysForIssuer>
) {
  const header = {
    alg: "ES256",
    typ: "dc+sd-jwt",
    kid: keys.keyId,
  };
  const signingInput = `${toBase64Url(
    Buffer.from(canonicalJson(header))
  )}.${toBase64Url(Buffer.from(canonicalJson(payload)))}`;
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key: keys.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${toBase64Url(signature)}`;
}

function keysForIssuer(issuer: string) {
  const root = mandateSigningSecret();
  let privateBytes = crypto
    .createHash("sha256")
    .update(`${root}:${issuer}`)
    .digest();
  const ecdh = crypto.createECDH("prime256v1");
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      ecdh.setPrivateKey(privateBytes);
      break;
    } catch {
      privateBytes = crypto.createHash("sha256").update(privateBytes).digest();
    }
  }
  const publicBytes = ecdh.getPublicKey(undefined, "uncompressed");
  const privateJwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    d: toBase64Url(privateBytes),
    x: toBase64Url(publicBytes.subarray(1, 33)),
    y: toBase64Url(publicBytes.subarray(33, 65)),
  };
  const publicJwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: privateJwk.x,
    y: privateJwk.y,
  };
  const publicKey = crypto.createPublicKey({ key: publicJwk, format: "jwk" });
  const privateKey = crypto.createPrivateKey({ key: privateJwk, format: "jwk" });
  const keyId = `speclock-${sha256(canonicalJson(publicJwk)).slice(0, 16)}`;
  return { publicJwk, publicKey, privateKey, keyId };
}

function mandateSigningSecret() {
  const secret = process.env.MANDATE_SIGNING_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("MANDATE_SIGNING_SECRET is required in production");
  }
  return "speclock-local-development-mandate-key";
}

function getMandateContext(sessionId: string) {
  const session = db
    .prepare(
      `SELECT s.merchant_id, s.buyer_agent_id, s.seller_policy_id,
              s.delivery_date, s.expires_at, t.buyer_max_total_paise,
              t.buyer_max_deposit_paise, t.allow_cross_sell,
              t.allowed_cross_sell_json
       FROM negotiation_sessions s
       JOIN negotiation_private_terms t ON t.session_id = s.id
       WHERE s.id = ?`
    )
    .get(sessionId) as
    | {
        merchant_id: string;
        buyer_agent_id: string;
        seller_policy_id: string;
        delivery_date: string | null;
        expires_at: number;
        buyer_max_total_paise: number;
        buyer_max_deposit_paise: number | null;
        allow_cross_sell: number;
        allowed_cross_sell_json: string;
      }
    | undefined;
  if (!session) throw new Error("Negotiation not found");
  const requirements = db
    .prepare(
      `SELECT product_id, min_quantity, target_quantity, max_quantity,
              required, substitutions_allowed, priority
       FROM negotiation_requirements WHERE session_id = ? ORDER BY priority DESC`
    )
    .all(sessionId) as Array<Record<string, unknown>>;
  const policy = db
    .prepare(`SELECT * FROM seller_policies WHERE id = ?`)
    .get(session.seller_policy_id) as Record<string, unknown> | undefined;
  if (!policy) throw new Error("Seller policy not found");
  const products = db
    .prepare(
      `SELECT DISTINCT p.id, p.cost_paise, p.floor_price_paise,
              p.target_price_paise, p.list_price_paise
       FROM merchant_products p
       JOIN negotiation_requirements r ON r.product_id = p.id
       WHERE r.session_id = ?`
    )
    .all(sessionId) as Array<Record<string, unknown>>;
  return {
    merchantId: session.merchant_id,
    buyerAgentId: session.buyer_agent_id,
    deliveryDate: session.delivery_date,
    expiresAt: session.expires_at,
    buyerMaxTotalPaise: session.buyer_max_total_paise,
    buyerMaxDepositPaise: session.buyer_max_deposit_paise,
    allowCrossSell: Boolean(session.allow_cross_sell),
    allowedCrossSellProductIds: JSON.parse(session.allowed_cross_sell_json) as string[],
    requirements: requirements.map((item) => ({
      productId: item.product_id,
      minQuantity: item.min_quantity,
      targetQuantity: item.target_quantity,
      maxQuantity: item.max_quantity,
      required: Boolean(item.required),
      substitutionsAllowed: Boolean(item.substitutions_allowed),
      priority: item.priority,
    })),
    sellerPolicy: {
      id: policy.id,
      version: policy.version,
      maxRounds: policy.max_rounds,
      depositBps: policy.deposit_bps,
      concessionBpsPerRound: policy.concession_bps_per_round,
      maxDiscountBps: policy.max_discount_bps,
      minBundleMarginBps: policy.min_bundle_margin_bps,
    },
    products: products.map((product) => ({
      id: product.id,
      costPaise: product.cost_paise,
      floorPricePaise: product.floor_price_paise,
      targetPricePaise: product.target_price_paise,
      listPricePaise: product.list_price_paise,
    })),
  };
}

function getOfferForMandate(sessionId: string, offerId: string) {
  const offer = db
    .prepare(
      `SELECT total_paise, deposit_bps, delivery_date, expires_at
       FROM negotiation_offers
       WHERE id = ? AND session_id = ? AND status = 'accepted'`
    )
    .get(offerId, sessionId) as
    | {
        total_paise: number;
        deposit_bps: number;
        delivery_date: string | null;
        expires_at: number;
      }
    | undefined;
  if (!offer) throw new Error("Accepted offer not found");
  const items = db
    .prepare(
      `SELECT i.product_id, p.sku, p.name, i.quantity, i.unit_price_paise, i.source
       FROM negotiation_offer_items i
       JOIN merchant_products p ON p.id = i.product_id
       WHERE i.offer_id = ? ORDER BY i.created_at, i.id`
    )
    .all(offerId) as Array<Record<string, unknown>>;
  return {
    totalPaise: offer.total_paise,
    depositBps: offer.deposit_bps,
    depositPaise: Math.round((offer.total_paise * offer.deposit_bps) / 10_000),
    deliveryDate: offer.delivery_date,
    expiresAt: offer.expires_at,
    items: items.map((item) => ({
      productId: item.product_id,
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      unitPricePaise: item.unit_price_paise,
      source: item.source,
    })),
  };
}

function getMandateRow(
  sessionId: string,
  mandateType: string,
  state: MandateRow["state"]
) {
  return db
    .prepare(
      `SELECT * FROM mandate_artifacts
       WHERE session_id = ? AND mandate_type = ? AND state = ?`
    )
    .get(sessionId, mandateType, state) as MandateRow | undefined;
}

function requireMandate(
  sessionId: string,
  mandateType: string,
  state: MandateRow["state"]
) {
  const row = getMandateRow(sessionId, mandateType, state);
  if (!row) throw new Error(`${state} ${mandateType} mandate not found`);
  return row;
}

function toMandate(row: MandateRow, includeToken: boolean) {
  return {
    id: row.id,
    sessionId: row.session_id,
    mandateType: row.mandate_type,
    vct: row.vct,
    state: row.state,
    visibility: row.visibility,
    issuer: row.issuer,
    audience: row.audience,
    parentMandateId: row.parent_mandate_id ?? undefined,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    payloadHash: row.payload_hash,
    compactJws: includeToken ? row.compact_jws : undefined,
    algorithm: row.algorithm,
    keyId: row.key_id,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    verifiedAt: row.verified_at,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

function toBase64Url(value: Buffer) {
  return value.toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url");
}
