import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import {
  createProduct,
  DEFAULT_LABEL_PRODUCT_ID,
  DEFAULT_MERCHANT_ID,
  ensureDefaultCommerceData,
  listAllProducts,
  matchCatalogProduct,
  updateProduct,
} from "@/lib/commerce/catalog";
import { loadPricebookRates, savePricebookRates } from "@/lib/commerce/pricebook-store";
import { calculateCatalogQuote, calculateQuote } from "@/lib/pricebook";
import { priceSpecification } from "@/lib/quote";
import type { LabelSpec } from "@/lib/types";

beforeEach(async () => {
  await db.exec(`
    DELETE FROM negotiation_messages;
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
    DELETE FROM merchant_pricebooks;
    DELETE FROM merchants;
  `);
  await ensureDefaultCommerceData();
});

const spec: LabelSpec = {
  productType: "pickle_jar_label",
  quantity: 10_000,
  widthMm: 50,
  heightMm: 30,
  substrate: "pp_white",
  finish: "matte_lamination",
  oilExposure: true,
  refrigeration: true,
  deliveryDate: "2026-09-20",
  deliveryPincode: "560001",
  budgetPaise: 50_000_000,
};

describe("merchant catalog and pricebook", () => {
  it("seeds a live pricebook that matches the spec formula defaults", async () => {
    const rates = await loadPricebookRates();
    expect(rates.version).toBe("v2");
    expect(calculateQuote(spec, rates).totalPaise).toBe(calculateQuote(spec).totalPaise);
  });

  it("bumps the pricebook version when the merchant edits it", async () => {
    const next = await savePricebookRates({ setupPaise: 250_000, marginBps: 1_800 });
    expect(next.version).toBe("v3");
    expect(next.setupPaise).toBe(250_000);
    const loaded = await loadPricebookRates();
    expect(loaded.setupPaise).toBe(250_000);
    expect(loaded.version).toBe("v3");
  });

  it("lets the merchant add and edit an arbitrary SKU", async () => {
    const created = await createProduct({
      sku: "JAR-CHUTNEY-50",
      name: "Chutney jar labels",
      category: "labels",
      description: "Small-run chutney labels.",
      unit: "label",
      costPaise: 1_500,
      listPricePaise: 4_500,
      targetPricePaise: 3_800,
      floorPricePaise: 2_400,
      minQuantity: 300,
      maxQuantity: 80_000,
      quantityStep: 50,
    });
    expect(created.id).toMatch(/^prod_/);
    const updated = await updateProduct(created.id, { listPricePaise: 4_800 });
    expect(updated.listPricePaise).toBe(4_800);
    expect(updated.sku).toBe("JAR-CHUTNEY-50");
    const all = await listAllProducts(DEFAULT_MERCHANT_ID);
    expect(all.some((product) => product.sku === "JAR-CHUTNEY-50")).toBe(true);
  });

  it("quotes a selected SKU from catalog cost plus the live pricebook", async () => {
    const product = (await listAllProducts(DEFAULT_MERCHANT_ID)).find(
      (item) => item.id === DEFAULT_LABEL_PRODUCT_ID
    );
    expect(product).toBeDefined();
    const catalogQuote = calculateCatalogQuote(spec, product!);
    expect(catalogQuote.lineItems.some((item) => item.code === "sku")).toBe(true);
    expect(catalogQuote.totalPaise).toBeGreaterThan(calculateQuote(spec).totalPaise);
    const priced = await priceSpecification(spec, DEFAULT_LABEL_PRODUCT_ID);
    expect(priced.quote.totalPaise).toBe(catalogQuote.totalPaise);
    expect(priced.productId).toBe(DEFAULT_LABEL_PRODUCT_ID);
  });

  it("matches RFQ text to a catalog SKU without silently binding it", () => {
    const products = [
      {
        sku: "LBL-PICKLE-STD",
        name: "Custom waterproof pickle labels",
        category: "labels",
      },
      {
        sku: "FOIL-ROTI-STD",
        name: "Branded roti and paratha foil wraps",
        category: "food_wraps",
      },
    ];
    expect(matchCatalogProduct("10,000 pickle labels to 560001", products)?.sku).toBe(
      "LBL-PICKLE-STD"
    );
    expect(matchCatalogProduct("foil wraps for roti", products)?.sku).toBe("FOIL-ROTI-STD");
  });
});
