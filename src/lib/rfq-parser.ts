import type { LabelSpec } from "./types";

export interface ParseResult {
  spec: Partial<LabelSpec>;
  missingFields: string[];
  clarificationQuestions: string[];
  confidence: number;
}

const DEFAULTS: Partial<LabelSpec> = {
  productType: "food_label",
  substrate: "pp_white",
  finish: "matte",
  oilExposure: false,
  refrigeration: false,
  deliveryPincode: "560001",
};

export function parseRfqText(raw: string): ParseResult {
  const text = raw.toLowerCase();
  const spec: Partial<LabelSpec> = { ...DEFAULTS };

  const qtyMatch = text.match(/(\d{1,6})\s*(k|thousand)?\s*(labels?|pcs|pieces)?/i);
  if (qtyMatch) {
    const n = parseInt(qtyMatch[1], 10);
    spec.quantity = qtyMatch[2]?.toLowerCase() === "k" ? n * 1000 : n;
  }

  const dimMatch = text.match(/(\d{2,3})\s*[x×]\s*(\d{2,3})\s*mm/i);
  if (dimMatch) {
    spec.widthMm = parseInt(dimMatch[1], 10);
    spec.heightMm = parseInt(dimMatch[2], 10);
  }

  const budgetMatch = text.match(/(?:₹|rs\.?|inr)\s*([\d,]+)/i);
  if (budgetMatch) {
    spec.budgetPaise = parseInt(budgetMatch[1].replace(/,/g, ""), 10) * 100;
  } else if (text.match(/25\s*k|25000/)) {
    spec.budgetPaise = 2500000;
  }

  if (text.includes("pickle") || text.includes("food") || text.includes("jar")) {
    spec.productType = "pickle_jar_label";
  }
  if (text.includes("oil") || text.includes("grease")) {
    spec.oilExposure = true;
  }
  if (text.includes("fridge") || text.includes("refrig") || text.includes("cold")) {
    spec.refrigeration = true;
  }
  if (text.includes("waterproof") || text.includes("lamination")) {
    spec.finish = "matte_lamination";
  }

  const fridayMatch = text.match(/friday|monday|tuesday|wednesday|thursday|saturday|sunday/);
  if (fridayMatch) {
    const d = new Date();
    const dayMap: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    const target = dayMap[fridayMatch[0]];
    const diff = (target + 7 - d.getDay()) % 7 || 7;
    d.setDate(d.getDate() + diff);
    spec.deliveryDate = d.toISOString().slice(0, 10);
  }

  if (text.includes("ignore") && text.includes("charge")) {
    // prompt injection — do not alter pricing path
  }

  const missingFields: string[] = [];
  const clarificationQuestions: string[] = [];

  if (!spec.quantity) missingFields.push("quantity");
  if (!spec.widthMm || !spec.heightMm) missingFields.push("dimensions");
  if (!spec.budgetPaise) missingFields.push("budget");
  if (!spec.deliveryDate) missingFields.push("deliveryDate");

  if (spec.oilExposure === undefined || (!text.includes("oil") && !text.includes("fridge"))) {
    if (!text.includes("oil") && spec.productType?.includes("pickle")) {
      clarificationQuestions.push(
        "Will these labels be exposed to oil and refrigeration on the jar?"
      );
    }
  }

  const filled = ["quantity", "widthMm", "heightMm", "budgetPaise", "deliveryDate"].filter(
    (f) => (spec as Record<string, unknown>)[f] !== undefined
  ).length;

  return {
    spec,
    missingFields,
    clarificationQuestions,
    confidence: filled / 5,
  };
}

export function mergeSpec(
  base: Partial<LabelSpec>,
  patch: Partial<LabelSpec>
): Partial<LabelSpec> {
  return { ...base, ...patch };
}

export function toLabelSpec(partial: Partial<LabelSpec>): LabelSpec | null {
  if (
    !partial.quantity ||
    !partial.widthMm ||
    !partial.heightMm ||
    !partial.budgetPaise ||
    !partial.deliveryDate ||
    !partial.deliveryPincode
  ) {
    return null;
  }
  return {
    productType: partial.productType ?? "food_label",
    quantity: partial.quantity,
    widthMm: partial.widthMm,
    heightMm: partial.heightMm,
    substrate: partial.substrate ?? "pp_white",
    finish: partial.finish ?? "matte",
    oilExposure: partial.oilExposure ?? false,
    refrigeration: partial.refrigeration ?? false,
    deliveryDate: partial.deliveryDate,
    deliveryPincode: partial.deliveryPincode,
    budgetPaise: partial.budgetPaise,
    fssaiLicense: partial.fssaiLicense,
  };
}
