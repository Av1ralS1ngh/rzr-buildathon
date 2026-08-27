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

  const qtyMatch =
    text.match(
      /(\d[\d,]*(?:\.\d+)?)\s*(k|thousand)?(?:\s+[a-z-]+){0,5}\s+(?:labels?|pcs|pieces|units)\b/i
    ) ??
    text.match(/\b(?:qty|quantity)\s*[:=-]?\s*([\d,]+(?:\.\d+)?)\s*(k|thousand)?\b/i);
  if (qtyMatch) {
    const n = Number(qtyMatch[1].replace(/,/g, ""));
    spec.quantity = Math.round(
      qtyMatch[2] && ["k", "thousand"].includes(qtyMatch[2].toLowerCase())
        ? n * 1000
        : n
    );
  }

  const dimMatch = text.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(mm|cm)\b/i);
  if (dimMatch) {
    const multiplier = dimMatch[3].toLowerCase() === "cm" ? 10 : 1;
    spec.widthMm = Number(dimMatch[1]) * multiplier;
    spec.heightMm = Number(dimMatch[2]) * multiplier;
  }

  const budgetMatch = text.match(
    /(?:budget(?:\s+is|\s+of)?\s*)?(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(k|thousand|lakh)?/i
  );
  if (budgetMatch) {
    const amount = Number(budgetMatch[1].replace(/,/g, ""));
    const unit = budgetMatch[2]?.toLowerCase();
    const multiplier = unit === "lakh" ? 100_000 : unit ? 1_000 : 1;
    spec.budgetPaise = Math.round(amount * multiplier * 100);
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
  } else if (text.includes("gloss")) {
    spec.finish = "gloss";
  }
  if (text.includes("clear pp") || text.includes("transparent")) {
    spec.substrate = "pp_clear";
  } else if (text.includes("pet")) {
    spec.substrate = "pet_white";
  }

  const explicitDate = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (explicitDate && !Number.isNaN(Date.parse(`${explicitDate[0]}T00:00:00Z`))) {
    spec.deliveryDate = explicitDate[0];
  } else {
    const relativeDays = text.match(/\b(?:in|within)\s+(\d{1,3})\s+days?\b/);
    if (relativeDays) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + Number(relativeDays[1]));
      spec.deliveryDate = d.toISOString().slice(0, 10);
    }
  }

  const weekdayMatch = text.match(
    /\b(friday|monday|tuesday|wednesday|thursday|saturday|sunday)\b/
  );
  if (!spec.deliveryDate && weekdayMatch) {
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
    const target = dayMap[weekdayMatch[1]];
    const diff = (target + 7 - d.getUTCDay()) % 7 || 7;
    d.setUTCDate(d.getUTCDate() + diff);
    spec.deliveryDate = d.toISOString().slice(0, 10);
  }

  const pincodeMatch = text.match(/\b[1-9]\d{5}\b/);
  if (pincodeMatch) {
    spec.deliveryPincode = pincodeMatch[0];
  }

  const fssaiMatch = text.match(/\bfssai(?:\s+license)?\s*[:#-]?\s*(\d{14})\b/i);
  if (fssaiMatch) {
    spec.fssaiLicense = fssaiMatch[1];
  }

  const missingFields: string[] = [];
  const clarificationQuestions: string[] = [];

  if (!spec.quantity) missingFields.push("quantity");
  if (!spec.widthMm || !spec.heightMm) missingFields.push("dimensions");
  if (!spec.budgetPaise) missingFields.push("budget");
  if (!spec.deliveryDate) missingFields.push("deliveryDate");

  if (!text.includes("oil") && spec.productType?.includes("pickle")) {
    clarificationQuestions.push(
      "Will these labels be exposed to oil and refrigeration on the jar?"
    );
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
  const candidate: LabelSpec = {
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
  const delivery = Date.parse(`${candidate.deliveryDate}T00:00:00Z`);
  if (
    !Number.isFinite(delivery) ||
    !Number.isInteger(candidate.quantity) ||
    candidate.quantity <= 0 ||
    candidate.widthMm <= 0 ||
    candidate.heightMm <= 0 ||
    candidate.budgetPaise <= 0 ||
    !/^[1-9]\d{5}$/.test(candidate.deliveryPincode)
  ) {
    return null;
  }
  return candidate;
}
