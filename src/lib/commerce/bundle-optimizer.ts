import db from "../db";
import { newId } from "../commitment";
import { getProduct } from "./catalog";
import { replaceWithSellerBundle } from "./negotiation-service";
import { costFor, totalFor, type PricedLine } from "./negotiation-policy";

type RelationshipRow = {
  id: string;
  source_product_id: string;
  target_product_id: string;
  relationship_type: "complement" | "substitute";
  relevance_score: number;
  bundle_discount_bps: number;
  attach_quantity: number;
  metadata_json: string;
};

type BundleRow = {
  id: string;
  session_id: string;
  parent_offer_id: string;
  status: "active" | "selected" | "expired" | "dismissed";
  strategy: "add_on" | "mix_shift" | "substitute";
  total_paise: number;
  explanation: string;
  expires_at: number;
  created_at: number;
};

type BundleItemRow = {
  product_id: string;
  sku: string;
  name: string;
  quantity: number;
  unit_price_paise: number;
  source: "requested" | "cross_sell" | "substitute";
};

export function generateBundleOptions(sessionId: string) {
  const context = getBundleContext(sessionId);
  if (!context.allowCrossSell) return [];
  const existing = getActiveBundleRows(sessionId).filter(
    (option) => option.parent_offer_id === context.parentOfferId
  );
  if (existing.length > 0) return existing.map(mapBundle);

  const relationships = getRelationships(
    context.merchantId,
    context.baseLines.map((line) => line.product.id)
  );
  const options: Array<{
    id: string;
    strategy: "add_on" | "mix_shift";
    lines: PricedLine[];
    explanation: string;
  }> = [];

  for (const relationship of relationships) {
    if (
      context.allowedProductIds.length > 0 &&
      !context.allowedProductIds.includes(relationship.target_product_id)
    ) {
      continue;
    }
    const sourceLine = context.baseLines.find(
      (line) => line.product.id === relationship.source_product_id
    );
    const target = getProduct(relationship.target_product_id);
    if (!sourceLine || !target) continue;
    const targetUnitPrice = Math.max(
      target.floorPricePaise,
      Math.round(
        target.listPricePaise * (1 - relationship.bundle_discount_bps / 10_000)
      )
    );

    const addOnQuantity = fitOptionalQuantity({
      requested: relationship.attach_quantity,
      productMin: target.minQuantity,
      productMax: target.maxQuantity,
      step: target.quantityStep,
      unitPricePaise: targetUnitPrice,
      baseTotalPaise: totalFor(context.baseLines),
      buyerMaxTotalPaise: context.buyerMaxTotalPaise,
      crossSellBudgetPaise: context.crossSellBudgetPaise,
    });
    if (addOnQuantity !== null) {
      const lines: PricedLine[] = [
        ...context.baseLines,
        {
          product: target,
          quantity: addOnQuantity,
          unitPricePaise: targetUnitPrice,
          source: "cross_sell",
        },
      ];
      if (isEconomicallyValid(lines, context.minBundleMarginBps)) {
        options.push({
          id: newId("bundle"),
          strategy: "add_on",
          lines,
          explanation: relationshipExplanation(
            relationship,
            `Add ${addOnQuantity} ${target.name} without changing the requested quantity.`
          ),
        });
      }
    }

    const requirement = context.requirements.find(
      (item) => item.productId === sourceLine.product.id
    );
    if (requirement && requirement.minQuantity < sourceLine.quantity) {
      const reducedSource: PricedLine = {
        ...sourceLine,
        quantity: requirement.minQuantity,
        unitPricePaise: Math.max(
          sourceLine.product.floorPricePaise,
          sourceLine.product.targetPricePaise
        ),
      };
      const otherLines = context.baseLines
        .filter((line) => line.product.id !== sourceLine.product.id)
        .map((line) => ({
          ...line,
          unitPricePaise: Math.max(
            line.product.floorPricePaise,
            line.product.targetPricePaise
          ),
        }));
      const baseLines = [reducedSource, ...otherLines];
      const shiftedQuantity = fitOptionalQuantity({
        requested: relationship.attach_quantity,
        productMin: target.minQuantity,
        productMax: target.maxQuantity,
        step: target.quantityStep,
        unitPricePaise: targetUnitPrice,
        baseTotalPaise: totalFor(baseLines),
        buyerMaxTotalPaise: context.buyerMaxTotalPaise,
        crossSellBudgetPaise: context.crossSellBudgetPaise,
      });
      if (shiftedQuantity !== null) {
        const lines: PricedLine[] = [
          ...baseLines,
          {
            product: target,
            quantity: shiftedQuantity,
            unitPricePaise: targetUnitPrice,
            source: "cross_sell",
          },
        ];
        if (isEconomicallyValid(lines, context.minBundleMarginBps)) {
          options.push({
            id: newId("bundle"),
            strategy: "mix_shift",
            lines,
            explanation: relationshipExplanation(
              relationship,
              `Use the buyer-authorized quantity flexibility and add ${shiftedQuantity} ${target.name}.`
            ),
          });
        }
      }
    }
  }

  const unique = deduplicateOptions(options)
    .sort((a, b) => scoreOption(b.lines, context.buyerMaxTotalPaise) - scoreOption(a.lines, context.buyerMaxTotalPaise))
    .slice(0, 5);
  const now = Date.now();
  db.transaction(() => {
    db.prepare(
      `UPDATE bundle_options SET status = 'dismissed'
       WHERE session_id = ? AND status = 'active'`
    ).run(sessionId);
    for (const option of unique) {
      const totalPaise = totalFor(option.lines);
      db.prepare(
        `INSERT INTO bundle_options (
          id, session_id, parent_offer_id, status, strategy, total_paise,
          explanation, expires_at, created_at
        ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`
      ).run(
        option.id,
        sessionId,
        context.parentOfferId,
        option.strategy,
        totalPaise,
        option.explanation,
        context.offerExpiresAt,
        now
      );
      for (const line of option.lines) {
        db.prepare(
          `INSERT INTO bundle_option_items (
            id, bundle_id, product_id, quantity, unit_price_paise, source, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          newId("bundle_item"),
          option.id,
          line.product.id,
          line.quantity,
          line.unitPricePaise,
          line.source,
          now
        );
      }
    }
  })();
  return getActiveBundleRows(sessionId).map(mapBundle);
}

export function selectBundleOption(sessionId: string, bundleId: string) {
  const option = db
    .prepare(
      `SELECT * FROM bundle_options
       WHERE id = ? AND session_id = ? AND status = 'active'`
    )
    .get(bundleId, sessionId) as BundleRow | undefined;
  if (!option) throw new Error("Bundle option not found or no longer active");
  if (option.expires_at <= Date.now()) throw new Error("Bundle option has expired");
  const session = db
    .prepare(`SELECT merchant_id FROM negotiation_sessions WHERE id = ?`)
    .get(sessionId) as { merchant_id: string } | undefined;
  if (!session) throw new Error("Negotiation not found");
  const itemRows = db
    .prepare(
      `SELECT product_id, quantity, unit_price_paise, source
       FROM bundle_option_items WHERE bundle_id = ?`
    )
    .all(bundleId) as Array<{
    product_id: string;
    quantity: number;
    unit_price_paise: number;
    source: PricedLine["source"];
  }>;
  const lines = itemRows.map((item) => {
    const product = getProduct(item.product_id);
    if (!product || product.merchantId !== session.merchant_id) {
      throw new Error("Bundle contains an unavailable product");
    }
    return {
      product,
      quantity: item.quantity,
      unitPricePaise: item.unit_price_paise,
      source: item.source,
    };
  });
  return replaceWithSellerBundle({
    sessionId,
    parentOfferId: option.parent_offer_id,
    bundleId,
    lines,
    strategy: option.strategy,
    explanation: option.explanation,
  });
}

function getBundleContext(sessionId: string) {
  const session = db
    .prepare(
      `SELECT s.merchant_id, s.status, s.seller_policy_id,
              t.buyer_max_total_paise, t.allow_cross_sell,
              t.cross_sell_budget_paise, t.allowed_cross_sell_json
       FROM negotiation_sessions s
       JOIN negotiation_private_terms t ON t.session_id = s.id
       WHERE s.id = ?`
    )
    .get(sessionId) as
    | {
        merchant_id: string;
        status: string;
        seller_policy_id: string;
        buyer_max_total_paise: number;
        allow_cross_sell: number;
        cross_sell_budget_paise: number | null;
        allowed_cross_sell_json: string;
      }
    | undefined;
  if (!session) throw new Error("Negotiation not found");
  if (session.status !== "open") throw new Error(`Negotiation is already '${session.status}'`);
  const offer = db
    .prepare(
      `SELECT id, expires_at FROM negotiation_offers
       WHERE session_id = ? AND actor = 'seller' AND status = 'active'
       ORDER BY sequence DESC LIMIT 1`
    )
    .get(sessionId) as { id: string; expires_at: number } | undefined;
  if (!offer) throw new Error("No active seller offer found");
  const itemRows = db
    .prepare(
      `SELECT product_id, quantity, unit_price_paise, source
       FROM negotiation_offer_items WHERE offer_id = ?`
    )
    .all(offer.id) as Array<{
    product_id: string;
    quantity: number;
    unit_price_paise: number;
    source: PricedLine["source"];
  }>;
  const baseLines = itemRows.map((item) => {
    const product = getProduct(item.product_id);
    if (!product) throw new Error("Offer contains an unavailable product");
    return {
      product,
      quantity: item.quantity,
      unitPricePaise: item.unit_price_paise,
      source: item.source,
    };
  });
  const requirements = (
    db
      .prepare(
        `SELECT product_id, min_quantity, target_quantity, max_quantity,
                required, substitutions_allowed, priority
         FROM negotiation_requirements WHERE session_id = ?`
      )
      .all(sessionId) as Array<{
      product_id: string;
      min_quantity: number;
      target_quantity: number;
      max_quantity: number;
      required: number;
      substitutions_allowed: number;
      priority: number;
    }>
  ).map((item) => ({
    productId: item.product_id,
    minQuantity: item.min_quantity,
    targetQuantity: item.target_quantity,
    maxQuantity: item.max_quantity,
    required: Boolean(item.required),
    substitutionsAllowed: Boolean(item.substitutions_allowed),
    priority: item.priority,
  }));
  const policy = db
    .prepare(`SELECT min_bundle_margin_bps FROM seller_policies WHERE id = ?`)
    .get(session.seller_policy_id) as { min_bundle_margin_bps: number } | undefined;
  if (!policy) throw new Error("Seller policy not found");
  return {
    merchantId: session.merchant_id,
    parentOfferId: offer.id,
    offerExpiresAt: offer.expires_at,
    buyerMaxTotalPaise: session.buyer_max_total_paise,
    allowCrossSell: Boolean(session.allow_cross_sell),
    crossSellBudgetPaise: session.cross_sell_budget_paise,
    allowedProductIds: JSON.parse(session.allowed_cross_sell_json) as string[],
    minBundleMarginBps: policy.min_bundle_margin_bps,
    baseLines,
    requirements,
  };
}

function getRelationships(merchantId: string, sourceIds: string[]) {
  if (sourceIds.length === 0) return [];
  const placeholders = sourceIds.map(() => "?").join(", ");
  return db
    .prepare(
      `SELECT * FROM product_relationships
       WHERE merchant_id = ? AND active = 1
         AND relationship_type = 'complement'
         AND source_product_id IN (${placeholders})
       ORDER BY relevance_score DESC`
    )
    .all(merchantId, ...sourceIds) as RelationshipRow[];
}

function getActiveBundleRows(sessionId: string): BundleRow[] {
  return db
    .prepare(
      `SELECT * FROM bundle_options
       WHERE session_id = ? AND status = 'active' AND expires_at > ?
       ORDER BY total_paise ASC, created_at ASC`
    )
    .all(sessionId, Date.now()) as BundleRow[];
}

function mapBundle(row: BundleRow) {
  const items = (
    db
      .prepare(
        `SELECT i.product_id, p.sku, p.name, i.quantity, i.unit_price_paise, i.source
         FROM bundle_option_items i
         JOIN merchant_products p ON p.id = i.product_id
         WHERE i.bundle_id = ? ORDER BY i.created_at, i.id`
      )
      .all(row.id) as BundleItemRow[]
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
    parentOfferId: row.parent_offer_id,
    status: row.status,
    strategy: row.strategy,
    totalPaise: row.total_paise,
    explanation: row.explanation,
    expiresAt: row.expires_at,
    items,
  };
}

function fitOptionalQuantity(input: {
  requested: number;
  productMin: number;
  productMax: number;
  step: number;
  unitPricePaise: number;
  baseTotalPaise: number;
  buyerMaxTotalPaise: number;
  crossSellBudgetPaise: number | null;
}): number | null {
  const totalBudget = Math.max(0, input.buyerMaxTotalPaise - input.baseTotalPaise);
  const available = Math.min(
    totalBudget,
    input.crossSellBudgetPaise ?? Number.MAX_SAFE_INTEGER
  );
  const affordable = Math.floor(available / input.unitPricePaise / input.step) * input.step;
  const quantity = Math.min(input.requested, input.productMax, affordable);
  return quantity >= input.productMin ? quantity : null;
}

function isEconomicallyValid(lines: PricedLine[], minimumMarginBps: number) {
  const total = totalFor(lines);
  const cost = costFor(lines);
  return total > 0 && ((total - cost) * 10_000) / total >= minimumMarginBps;
}

function relationshipExplanation(
  relationship: RelationshipRow,
  fallback: string
): string {
  const metadata = JSON.parse(relationship.metadata_json) as { reason?: string };
  return metadata.reason ? `${metadata.reason} ${fallback}` : fallback;
}

function scoreOption(lines: PricedLine[], buyerMax: number) {
  const total = totalFor(lines);
  const crossSellCount = lines.filter((line) => line.source === "cross_sell").length;
  return crossSellCount * 100_000 + Math.min(total, buyerMax);
}

function deduplicateOptions<T extends { lines: PricedLine[] }>(options: T[]): T[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = option.lines
      .map((line) => `${line.product.id}:${line.quantity}:${line.unitPricePaise}`)
      .sort()
      .join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
