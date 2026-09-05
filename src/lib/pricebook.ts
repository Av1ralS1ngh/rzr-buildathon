import type { CatalogProduct } from "./commerce/types";
import type { LabelSpec, LineItem, QuoteResult } from "./types";

export type PricebookRates = {
  merchantId: string;
  version: string;
  setupPaise: number;
  materialBasePaise: number;
  printUnitPaise: number;
  petWhiteAddPaise: number;
  ppClearAddPaise: number;
  matteLaminationAddPaise: number;
  oilColdAddPaise: number;
  wastageBps: number;
  verificationPaise: number;
  marginBps: number;
  depositBps: number;
  minMoq: number;
};

export const DEFAULT_PRICEBOOK_RATES: PricebookRates = {
  merchantId: "merchant_abc_labels",
  version: "v2",
  setupPaise: 350_000,
  materialBasePaise: 18,
  printUnitPaise: 6,
  petWhiteAddPaise: 4,
  ppClearAddPaise: 2,
  matteLaminationAddPaise: 6,
  oilColdAddPaise: 8,
  wastageBps: 800,
  verificationPaise: 35_000,
  marginBps: 2_200,
  depositBps: 3_000,
  minMoq: 1_000,
};

function materialRatePaise(spec: LabelSpec, rates: PricebookRates): number {
  let base = rates.materialBasePaise;
  if (spec.substrate === "pet_white") base += rates.petWhiteAddPaise;
  if (spec.substrate === "pp_clear") base += rates.ppClearAddPaise;
  if (spec.finish === "matte_lamination") base += rates.matteLaminationAddPaise;
  if (spec.oilExposure && spec.refrigeration) base += rates.oilColdAddPaise;
  return base;
}

function applyOverheads(
  spec: LabelSpec,
  rates: PricebookRates,
  lineItems: LineItem[],
  upsell?: QuoteResult["upsell"]
): QuoteResult {
  const preMarginPaise = lineItems.reduce((sum, item) => sum + item.amountPaise, 0);
  const marginPaise = Math.round((preMarginPaise * rates.marginBps) / 10_000);
  lineItems.push({
    code: "margin",
    label: "Production margin",
    amountPaise: marginPaise,
  });

  const totalPaise = preMarginPaise + marginPaise;
  const depositPaise = Math.max(
    100,
    Math.round((totalPaise * rates.depositBps) / 10_000)
  );

  if (totalPaise > spec.budgetPaise) {
    throw new Error(
      `Quote ₹${(totalPaise / 100).toFixed(2)} exceeds budget ₹${(
        spec.budgetPaise / 100
      ).toFixed(2)}`
    );
  }

  return {
    lineItems,
    subtotalPaise: preMarginPaise,
    verificationFeePaise: rates.verificationPaise,
    totalPaise,
    depositPaise,
    upsell,
  };
}

function assertQuoteInputs(spec: LabelSpec, minMoq: number) {
  if (
    !Number.isSafeInteger(spec.quantity) ||
    !Number.isSafeInteger(spec.budgetPaise) ||
    spec.widthMm <= 0 ||
    spec.heightMm <= 0
  ) {
    throw new Error("Specification contains invalid numeric values");
  }
  if (spec.quantity < minMoq) {
    throw new Error(`MOQ is ${minMoq} units`);
  }
}

export function calculateQuote(
  spec: LabelSpec,
  rates: PricebookRates = DEFAULT_PRICEBOOK_RATES
): QuoteResult {
  assertQuoteInputs(spec, rates.minMoq);

  const materialPerLabel = materialRatePaise(spec, rates);
  const printPaise = spec.quantity * rates.printUnitPaise;
  const materialPaise = Math.round(spec.quantity * materialPerLabel);
  const wastagePaise = Math.round(
    ((materialPaise + printPaise) * rates.wastageBps) / 10_000
  );

  let upsell: QuoteResult["upsell"] | undefined;
  if (
    spec.oilExposure &&
    spec.refrigeration &&
    spec.finish !== "matte_lamination"
  ) {
    const delta = Math.round(spec.quantity * rates.oilColdAddPaise);
    upsell = {
      code: "oil_cold_lamination",
      label: "Oil + cold resistant matte lamination",
      deltaPaise: delta,
      reason:
        "Pickle jar labels in oil and refrigeration need lamination to prevent adhesive failure.",
    };
  }

  const lineItems: LineItem[] = [
    { code: "setup", label: "Plate & setup", amountPaise: rates.setupPaise },
    {
      code: "material",
      label: `Material (${spec.substrate})`,
      amountPaise: materialPaise,
    },
    { code: "print", label: "Printing", amountPaise: printPaise },
    { code: "wastage", label: "Expected wastage", amountPaise: wastagePaise },
    {
      code: "verification",
      label: "Technical verification bundle",
      amountPaise: rates.verificationPaise,
    },
  ];

  if (upsell) {
    lineItems.push({
      code: upsell.code,
      label: upsell.label,
      amountPaise: upsell.deltaPaise,
    });
  }

  return applyOverheads(spec, rates, lineItems, upsell);
}

export function calculateCatalogQuote(
  spec: LabelSpec,
  product: CatalogProduct,
  rates: PricebookRates = DEFAULT_PRICEBOOK_RATES
): QuoteResult {
  const minMoq = Math.max(rates.minMoq, product.minQuantity);
  assertQuoteInputs(spec, minMoq);
  if (spec.quantity > product.maxQuantity) {
    throw new Error(
      `Quantity exceeds the catalog maximum of ${product.maxQuantity} ${product.unit}s`
    );
  }

  const skuPaise = spec.quantity * product.costPaise;
  const wastagePaise = Math.round((skuPaise * rates.wastageBps) / 10_000);
  const lineItems: LineItem[] = [
    { code: "setup", label: "Plate & setup", amountPaise: rates.setupPaise },
    {
      code: "sku",
      label: `${product.sku} · ${spec.quantity.toLocaleString("en-IN")} ${product.unit}s @ cost`,
      amountPaise: skuPaise,
    },
    { code: "wastage", label: "Expected wastage", amountPaise: wastagePaise },
    {
      code: "verification",
      label: "Technical verification bundle",
      amountPaise: rates.verificationPaise,
    },
  ];
  return applyOverheads(spec, rates, lineItems);
}

export function getPricebookVersion(rates: PricebookRates = DEFAULT_PRICEBOOK_RATES) {
  return rates.version;
}

export function nextPricebookVersion(current: string): string {
  const match = /^v(\d+)$/.exec(current.trim());
  return match ? `v${Number(match[1]) + 1}` : "v3";
}

export function checkCapacity(spec: LabelSpec): {
  feasible: boolean;
  earliestShipDate: string;
  reason: string;
} {
  const today = startOfUtcDay(new Date());
  const requested = new Date(`${spec.deliveryDate}T00:00:00Z`);
  const daysNeeded =
    spec.quantity > 15000 ? 5 : spec.quantity > 8000 ? 4 : 3;
  const earliest = addBusinessDays(today, daysNeeded);

  const feasible = earliest <= requested;
  return {
    feasible,
    earliestShipDate: earliest.toISOString().slice(0, 10),
    reason: feasible
      ? `Slot available with ${daysNeeded}-day production window`
      : `Earliest feasible ship date is ${earliest.toISOString().slice(0, 10)}`,
  };
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addBusinessDays(from: Date, count: number): Date {
  const date = new Date(from);
  let added = 0;
  while (added < count) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return date;
}
