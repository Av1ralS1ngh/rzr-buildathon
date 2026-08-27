import db from "../db";
import type { CatalogProduct, SellerPolicy } from "./types";

export const DEFAULT_MERCHANT_ID = "merchant_abc_labels";
export const DEFAULT_LABEL_PRODUCT_ID = "prod_pickle_label";

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

export function ensureDefaultCommerceData(): void {
  const now = Date.now();
  db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO merchants (id, name, currency, created_at, updated_at)
       VALUES (?, ?, 'INR', ?, ?)`
    ).run(DEFAULT_MERCHANT_ID, "ABC Labels & Packaging", now, now);

    db.prepare(
      `INSERT OR IGNORE INTO merchant_products (
        id, merchant_id, sku, name, category, description, unit, currency,
        cost_paise, list_price_paise, target_price_paise, floor_price_paise,
        min_quantity, max_quantity, quantity_step, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
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
      1_000,
      250_000,
      500,
      JSON.stringify({
        substrate: "pp_white",
        finish: "matte_lamination",
        dimensionsMm: { width: 50, height: 30 },
      }),
      now,
      now
    );

    db.prepare(
      `INSERT OR IGNORE INTO seller_policies (
        id, merchant_id, version, status, max_rounds, offer_ttl_seconds,
        concession_bps_per_round, max_discount_bps, min_bundle_margin_bps,
        deposit_bps, created_at
      ) VALUES (?, ?, 1, 'active', 5, 1800, 750, 4500, 2500, 3000, ?)`
    ).run("policy_abc_v1", DEFAULT_MERCHANT_ID, now);
  })();
}

export function getProduct(productId: string): CatalogProduct | null {
  const row = db
    .prepare(`SELECT * FROM merchant_products WHERE id = ? AND active = 1`)
    .get(productId) as ProductRow | undefined;
  return row ? mapProduct(row) : null;
}

export function getProducts(
  productIds: string[],
  merchantId: string
): CatalogProduct[] {
  if (productIds.length === 0) return [];
  const placeholders = productIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT * FROM merchant_products
       WHERE merchant_id = ? AND active = 1 AND id IN (${placeholders})`
    )
    .all(merchantId, ...productIds) as ProductRow[];
  return rows.map(mapProduct);
}

export function listProducts(merchantId: string): CatalogProduct[] {
  return (
    db
      .prepare(
        `SELECT * FROM merchant_products
         WHERE merchant_id = ? AND active = 1 ORDER BY category, name`
      )
      .all(merchantId) as ProductRow[]
  ).map(mapProduct);
}

export function getActiveSellerPolicy(merchantId: string): SellerPolicy | null {
  const row = db
    .prepare(
      `SELECT * FROM seller_policies
       WHERE merchant_id = ? AND status = 'active'
       ORDER BY version DESC LIMIT 1`
    )
    .get(merchantId) as PolicyRow | undefined;
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
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
  };
}
