import db from "../db";
import { newId } from "../commitment";
import { ensureDefaultPricebook } from "./pricebook-store";
import type { CatalogProduct, SellerPolicy } from "./types";
import { matchCatalogProduct } from "./match-product";

export { matchCatalogProduct };

export const DEFAULT_MERCHANT_ID = "merchant_abc_labels";
export const DEFAULT_LABEL_PRODUCT_ID = "prod_pickle_label";
export const DEFAULT_FOIL_PRODUCT_ID = "prod_roti_foil";
export const DEFAULT_MEAL_BOX_PRODUCT_ID = "prod_meal_box";

type ProductRow = {
  id: string;
  merchant_id: string;
  sku: string;
  name: string;
  category: string;
  description: string;
  unit: string;
  currency: "INR";
  cost_paise: number;
  list_price_paise: number;
  target_price_paise: number;
  floor_price_paise: number;
  min_quantity: number;
  max_quantity: number;
  quantity_step: number;
  active: number;
  metadata_json: string;
};

type PolicyRow = {
  id: string;
  merchant_id: string;
  version: number;
  max_rounds: number;
  offer_ttl_seconds: number;
  concession_bps_per_round: number;
  max_discount_bps: number;
  min_bundle_margin_bps: number;
  deposit_bps: number;
};

export async function ensureDefaultCommerceData(): Promise<void> {
  const now = Date.now();
  await db.transaction(async () => {
    await db
      .prepare(
        `INSERT INTO merchants (id, name, currency, created_at, updated_at)
         VALUES (?, ?, 'INR', ?, ?)
         ON CONFLICT (id) DO NOTHING`
      )
      .run(DEFAULT_MERCHANT_ID, "ABC Labels & Packaging", now, now);

    await db
      .prepare(
        `INSERT INTO merchant_products (
        id, merchant_id, sku, name, category, description, unit, currency,
        cost_paise, list_price_paise, target_price_paise, floor_price_paise,
        min_quantity, max_quantity, quantity_step, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO NOTHING`
      )
      .run(
        DEFAULT_LABEL_PRODUCT_ID,
        DEFAULT_MERCHANT_ID,
        "LBL-PICKLE-STD",
        "Custom waterproof pickle labels",
        "labels",
        "Oil- and refrigeration-resistant custom labels with matte lamination.",
        "label",
        2_000,
        6_000,
        5_000,
        3_500,
        500,
        250_000,
        100,
        JSON.stringify({
          substrate: "pp_white",
          finish: "matte_lamination",
          dimensionsMm: { width: 50, height: 30 },
        }),
        now,
        now
      );

    await db
      .prepare(
        `INSERT INTO merchant_products (
        id, merchant_id, sku, name, category, description, unit, currency,
        cost_paise, list_price_paise, target_price_paise, floor_price_paise,
        min_quantity, max_quantity, quantity_step, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO NOTHING`
      )
      .run(
        DEFAULT_FOIL_PRODUCT_ID,
        DEFAULT_MERCHANT_ID,
        "FOIL-ROTI-STD",
        "Branded roti and paratha foil wraps",
        "food_wraps",
        "Food-safe printed foil sheets for rotis and parathas.",
        "wrap",
        120,
        300,
        250,
        180,
        1_000,
        1_000_000,
        500,
        JSON.stringify({ foodSafe: true, printable: true }),
        now,
        now
      );

    await db
      .prepare(
        `INSERT INTO merchant_products (
        id, merchant_id, sku, name, category, description, unit, currency,
        cost_paise, list_price_paise, target_price_paise, floor_price_paise,
        min_quantity, max_quantity, quantity_step, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO NOTHING`
      )
      .run(
        DEFAULT_MEAL_BOX_PRODUCT_ID,
        DEFAULT_MERCHANT_ID,
        "PKG-MEAL-STD",
        "Printed takeaway meal boxes",
        "packaging",
        "Food-grade printed boxes for restaurant and retail orders.",
        "box",
        450,
        900,
        750,
        600,
        500,
        250_000,
        500,
        JSON.stringify({ foodGrade: true, recyclable: true }),
        now,
        now
      );

    for (const relationship of [
      {
        id: "rel_label_foil",
        target: DEFAULT_FOIL_PRODUCT_ID,
        relevance: 95,
        discountBps: 1_667,
        attachQuantity: 3_000,
        reason: "Add branded foil wraps while reducing label volume within approved flexibility.",
      },
      {
        id: "rel_label_box",
        target: DEFAULT_MEAL_BOX_PRODUCT_ID,
        relevance: 75,
        discountBps: 1_111,
        attachQuantity: 1_000,
        reason: "Add coordinated takeaway packaging to the same print production run.",
      },
    ]) {
      await db
        .prepare(
          `INSERT INTO product_relationships (
          id, merchant_id, source_product_id, target_product_id,
          relationship_type, relevance_score, bundle_discount_bps,
          attach_quantity, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, 'complement', ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO NOTHING`
        )
        .run(
          relationship.id,
          DEFAULT_MERCHANT_ID,
          DEFAULT_LABEL_PRODUCT_ID,
          relationship.target,
          relationship.relevance,
          relationship.discountBps,
          relationship.attachQuantity,
          JSON.stringify({ reason: relationship.reason }),
          now
        );
    }

    await db
      .prepare(
        `INSERT INTO seller_policies (
        id, merchant_id, version, status, max_rounds, offer_ttl_seconds,
        concession_bps_per_round, max_discount_bps, min_bundle_margin_bps,
        deposit_bps, created_at
      ) VALUES (?, ?, 1, 'active', 5, 1800, 750, 4500, 2500, 3000, ?)
      ON CONFLICT (id) DO NOTHING`
      )
      .run("policy_abc_v1", DEFAULT_MERCHANT_ID, now);
    await ensureDefaultPricebook(DEFAULT_MERCHANT_ID);
  });
}

export async function getProduct(
  productId: string,
  includeInactive = false
): Promise<CatalogProduct | null> {
  const row = await db
    .prepare(
      includeInactive
        ? `SELECT * FROM merchant_products WHERE id = ?`
        : `SELECT * FROM merchant_products WHERE id = ? AND active = 1`
    )
    .get<ProductRow>(productId);
  return row ? mapProduct(row) : null;
}

export async function getProducts(
  productIds: string[],
  merchantId: string
): Promise<CatalogProduct[]> {
  if (productIds.length === 0) return [];
  const placeholders = productIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT * FROM merchant_products
       WHERE merchant_id = ? AND active = 1 AND id IN (${placeholders})`
    )
    .all<ProductRow>(merchantId, ...productIds);
  return rows.map(mapProduct);
}

export async function listProducts(
  merchantId: string
): Promise<CatalogProduct[]> {
  const rows = await db
    .prepare(
      `SELECT * FROM merchant_products
         WHERE merchant_id = ? AND active = 1 ORDER BY category, name`
    )
    .all<ProductRow>(merchantId);
  return rows.map(mapProduct);
}

export async function listAllProducts(
  merchantId: string
): Promise<CatalogProduct[]> {
  const rows = await db
    .prepare(
      `SELECT * FROM merchant_products
         WHERE merchant_id = ? ORDER BY category, name`
    )
    .all<ProductRow>(merchantId);
  return rows.map(mapProduct);
}

export type ProductWriteInput = {
  merchantId?: string;
  sku: string;
  name: string;
  category: string;
  description: string;
  unit: string;
  costPaise: number;
  listPricePaise: number;
  targetPricePaise: number;
  floorPricePaise: number;
  minQuantity: number;
  maxQuantity: number;
  quantityStep?: number;
  metadata?: Record<string, unknown>;
  active?: boolean;
};

export async function createProduct(
  input: ProductWriteInput
): Promise<CatalogProduct> {
  await ensureDefaultCommerceData();
  assertPriceLadder(input);
  const now = Date.now();
  const merchantId = input.merchantId ?? DEFAULT_MERCHANT_ID;
  const id = newId("prod");
  try {
    await db
      .prepare(
        `INSERT INTO merchant_products (
        id, merchant_id, sku, name, category, description, unit, currency,
        cost_paise, list_price_paise, target_price_paise, floor_price_paise,
        min_quantity, max_quantity, quantity_step, active, metadata_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        merchantId,
        input.sku.trim(),
        input.name.trim(),
        input.category.trim(),
        input.description.trim(),
        input.unit.trim(),
        input.costPaise,
        input.listPricePaise,
        input.targetPricePaise,
        input.floorPricePaise,
        input.minQuantity,
        input.maxQuantity,
        input.quantityStep ?? 1,
        input.active === false ? 0 : 1,
        JSON.stringify(input.metadata ?? {}),
        now,
        now
      );
  } catch (error) {
    throw uniqueSkuError(error);
  }
  const created = await getProduct(id, true);
  if (!created) throw new Error("Product was not stored");
  return created;
}

export async function updateProduct(
  productId: string,
  patch: Partial<ProductWriteInput>
): Promise<CatalogProduct> {
  const existing = await getProduct(productId, true);
  if (!existing) throw new Error("Product not found");
  const next = {
    sku: patch.sku?.trim() ?? existing.sku,
    name: patch.name?.trim() ?? existing.name,
    category: patch.category?.trim() ?? existing.category,
    description: patch.description?.trim() ?? existing.description,
    unit: patch.unit?.trim() ?? existing.unit,
    costPaise: patch.costPaise ?? existing.costPaise,
    listPricePaise: patch.listPricePaise ?? existing.listPricePaise,
    targetPricePaise: patch.targetPricePaise ?? existing.targetPricePaise,
    floorPricePaise: patch.floorPricePaise ?? existing.floorPricePaise,
    minQuantity: patch.minQuantity ?? existing.minQuantity,
    maxQuantity: patch.maxQuantity ?? existing.maxQuantity,
    quantityStep: patch.quantityStep ?? existing.quantityStep,
    metadata: patch.metadata ?? existing.metadata,
    active: patch.active ?? existing.active,
  };
  assertPriceLadder(next);
  try {
    await db
      .prepare(
        `UPDATE merchant_products SET
          sku = ?, name = ?, category = ?, description = ?, unit = ?,
          cost_paise = ?, list_price_paise = ?, target_price_paise = ?,
          floor_price_paise = ?, min_quantity = ?, max_quantity = ?,
          quantity_step = ?, active = ?, metadata_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        next.sku,
        next.name,
        next.category,
        next.description,
        next.unit,
        next.costPaise,
        next.listPricePaise,
        next.targetPricePaise,
        next.floorPricePaise,
        next.minQuantity,
        next.maxQuantity,
        next.quantityStep,
        next.active ? 1 : 0,
        JSON.stringify(next.metadata),
        Date.now(),
        productId
      );
  } catch (error) {
    throw uniqueSkuError(error);
  }
  const updated = await getProduct(productId, true);
  if (!updated) throw new Error("Product not found");
  return updated;
}

export async function saveSellerPolicy(input: {
  merchantId?: string;
  maxRounds: number;
  offerTtlSeconds: number;
  concessionBpsPerRound: number;
  maxDiscountBps: number;
  minBundleMarginBps: number;
  depositBps: number;
}): Promise<SellerPolicy> {
  await ensureDefaultCommerceData();
  const merchantId = input.merchantId ?? DEFAULT_MERCHANT_ID;
  const current = await getActiveSellerPolicy(merchantId);
  const version = (current?.version ?? 0) + 1;
  const id = newId("policy");
  const now = Date.now();
  await db.transaction(async () => {
    await db
      .prepare(
        `UPDATE seller_policies SET status = 'superseded'
         WHERE merchant_id = ? AND status = 'active'`
      )
      .run(merchantId);
    await db
      .prepare(
        `INSERT INTO seller_policies (
        id, merchant_id, version, status, max_rounds, offer_ttl_seconds,
        concession_bps_per_round, max_discount_bps, min_bundle_margin_bps,
        deposit_bps, created_at
      ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        merchantId,
        version,
        input.maxRounds,
        input.offerTtlSeconds,
        input.concessionBpsPerRound,
        input.maxDiscountBps,
        input.minBundleMarginBps,
        input.depositBps,
        now
      );
  });
  const saved = await getActiveSellerPolicy(merchantId);
  if (!saved) throw new Error("Seller policy was not stored");
  return saved;
}

export async function getActiveSellerPolicy(
  merchantId: string
): Promise<SellerPolicy | null> {
  const row = await db
    .prepare(
      `SELECT * FROM seller_policies
       WHERE merchant_id = ? AND status = 'active'
       ORDER BY version DESC LIMIT 1`
    )
    .get<PolicyRow>(merchantId);
  return row
    ? {
        id: row.id,
        merchantId: row.merchant_id,
        version: row.version,
        maxRounds: row.max_rounds,
        offerTtlSeconds: row.offer_ttl_seconds,
        concessionBpsPerRound: row.concession_bps_per_round,
        maxDiscountBps: row.max_discount_bps,
        minBundleMarginBps: row.min_bundle_margin_bps,
        depositBps: row.deposit_bps,
      }
    : null;
}

export function toPublicProduct(product: CatalogProduct) {
  return {
    id: product.id,
    merchantId: product.merchantId,
    sku: product.sku,
    name: product.name,
    category: product.category,
    description: product.description,
    unit: product.unit,
    currency: product.currency,
    listPricePaise: product.listPricePaise,
    minQuantity: product.minQuantity,
    maxQuantity: product.maxQuantity,
    quantityStep: product.quantityStep,
    metadata: product.metadata,
  };
}

export function toMerchantProduct(product: CatalogProduct) {
  return {
    ...product,
  };
}

function assertPriceLadder(input: {
  costPaise: number;
  listPricePaise: number;
  targetPricePaise: number;
  floorPricePaise: number;
  minQuantity: number;
  maxQuantity: number;
}) {
  if (
    !(
      input.listPricePaise >= input.targetPricePaise &&
      input.targetPricePaise >= input.floorPricePaise &&
      input.floorPricePaise >= input.costPaise
    )
  ) {
    throw new Error("Prices must satisfy list ≥ target ≥ floor ≥ cost");
  }
  if (input.minQuantity < 1 || input.maxQuantity < input.minQuantity) {
    throw new Error("Quantities must satisfy 1 ≤ min ≤ max");
  }
}

function uniqueSkuError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/unique|duplicate/i.test(message)) {
    return new Error("A product with this SKU already exists for the merchant");
  }
  return error instanceof Error ? error : new Error(message);
}

function mapProduct(row: ProductRow): CatalogProduct {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    description: row.description,
    unit: row.unit,
    currency: row.currency,
    costPaise: row.cost_paise,
    listPricePaise: row.list_price_paise,
    targetPricePaise: row.target_price_paise,
    floorPricePaise: row.floor_price_paise,
    minQuantity: row.min_quantity,
    maxQuantity: row.max_quantity,
    quantityStep: row.quantity_step,
    active: row.active !== 0,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
  };
}
