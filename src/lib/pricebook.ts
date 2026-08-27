import type { LabelSpec, LineItem, QuoteResult } from "./types";

const PRICEbook_VERSION = "v1";

const SETUP_PAise = 350000; // ₹3,500
const WASTAGE_RATE = 0.08;
const MIN_MOQ = 1000;
const MARGIN_RATE = 0.22;
const VERIFICATION_FEE_PAise = 35000; // ₹350 bundled in quote

function materialRatePaise(spec: LabelSpec): number {
  let base = 18; // paise per label
  if (spec.substrate === "pet_white") base += 4;
  if (spec.substrate === "pp_clear") base += 2;
  if (spec.finish === "matte_lamination") base += 6;
  if (spec.oilExposure && spec.refrigeration) base += 8;
  return base;
}

export function calculateQuote(spec: LabelSpec): QuoteResult {
  if (spec.quantity < MIN_MOQ) {
    throw new Error(`MOQ is ${MIN_MOQ} labels`);
  }

  const materialPerLabel = materialRatePaise(spec);
  const printPaise = spec.quantity * 6;
  const materialPaise = Math.round(spec.quantity * materialPerLabel);
  const wastagePaise = Math.round(
    (materialPaise + printPaise) * WASTAGE_RATE
  );

  let upsell: QuoteResult["upsell"] | undefined;
  if (
    spec.oilExposure &&
    spec.refrigeration &&
    spec.finish !== "matte_lamination"
  ) {
    const delta = Math.round(spec.quantity * 8);
    upsell = {
      code: "oil_cold_lamination",
      label: "Oil + cold resistant matte lamination",
      deltaPaise: delta,
      reason:
        "Pickle jar labels in oil and refrigeration need lamination to prevent adhesive failure.",
    };
  }

  const lineItems: LineItem[] = [
    { code: "setup", label: "Plate & setup", amountPaise: SETUP_PAise },
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
      amountPaise: VERIFICATION_FEE_PAise,
    },
  ];

  if (upsell) {
    lineItems.push({
      code: upsell.code,
      label: upsell.label,
      amountPaise: upsell.deltaPaise,
    });
  }

  const subtotalPaise = lineItems.reduce((s, i) => s + i.amountPaise, 0);
  const marginPaise = Math.round(subtotalPaise * MARGIN_RATE);
  lineItems.push({
    code: "margin",
    label: "Production margin",
    amountPaise: marginPaise,
  });

  const totalPaise = subtotalPaise + marginPaise;
  const depositPaise = Math.max(100, Math.round(totalPaise * 0.3));

  if (totalPaise > spec.budgetPaise) {
    throw new Error(
      `Quote ₹${(totalPaise / 100).toFixed(2)} exceeds budget ₹${(
        spec.budgetPaise / 100
      ).toFixed(2)}`
    );
  }

  return {
    lineItems,
    subtotalPaise: subtotalPaise + marginPaise,
    verificationFeePaise: VERIFICATION_FEE_PAise,
    totalPaise,
    depositPaise,
    upsell,
  };
}

export function getPricebookVersion() {
  return PRICEbook_VERSION;
}

export function checkCapacity(spec: LabelSpec): {
  feasible: boolean;
  earliestShipDate: string;
  reason: string;
} {
  const today = new Date();
  const requested = new Date(spec.deliveryDate);
  const daysNeeded =
    spec.quantity > 15000 ? 5 : spec.quantity > 8000 ? 4 : 3;
  const earliest = new Date(today);
  earliest.setDate(earliest.getDate() + daysNeeded);

  const feasible = earliest <= requested;
  return {
    feasible,
    earliestShipDate: earliest.toISOString().slice(0, 10),
    reason: feasible
      ? `Slot available with ${daysNeeded}-day production window`
      : `Earliest feasible ship date is ${earliest.toISOString().slice(0, 10)}`,
  };
}
