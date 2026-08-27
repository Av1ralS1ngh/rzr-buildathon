import crypto from "crypto";
import type { LabelSpec, LineItem } from "./types";

export const PRICEbook_VERSION = "v1";

export function canonicalizeSpec(spec: LabelSpec): string {
  const ordered = {
    productType: spec.productType,
    quantity: spec.quantity,
    widthMm: spec.widthMm,
    heightMm: spec.heightMm,
    substrate: spec.substrate,
    finish: spec.finish,
    oilExposure: spec.oilExposure,
    refrigeration: spec.refrigeration,
    deliveryDate: spec.deliveryDate,
    deliveryPincode: spec.deliveryPincode,
    budgetPaise: spec.budgetPaise,
    fssaiLicense: spec.fssaiLicense ?? "",
  };
  return JSON.stringify(ordered);
}

export function hashSpec(spec: LabelSpec): string {
  return crypto
    .createHash("sha256")
    .update(canonicalizeSpec(spec))
    .digest("hex");
}

export function hashArtwork(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function hashCommitment(input: {
  specHash: string;
  artworkHash: string;
  lineItems: LineItem[];
  pricebookVersion: string;
  totalPaise: number;
}): string {
  const payload = {
    specHash: input.specHash,
    artworkHash: input.artworkHash,
    lineItems: input.lineItems.map((i) => ({
      code: i.code,
      amountPaise: i.amountPaise,
    })),
    pricebookVersion: input.pricebookVersion,
    totalPaise: input.totalPaise,
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}
