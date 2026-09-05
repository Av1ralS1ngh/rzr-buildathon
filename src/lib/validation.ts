import { z } from "zod";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export const labelSpecSchema = z
  .object({
    productType: z.string().trim().min(2).max(80),
    quantity: z.number().int().min(100).max(5_000_000),
    widthMm: z.number().positive().max(2_000),
    heightMm: z.number().positive().max(2_000),
    substrate: z.enum(["pp_white", "pp_clear", "pet_white"]),
    finish: z.enum(["matte", "gloss", "matte_lamination"]),
    oilExposure: z.boolean(),
    refrigeration: z.boolean(),
    deliveryDate: z
      .string()
      .regex(isoDate, "deliveryDate must be YYYY-MM-DD")
      .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
        message: "deliveryDate is invalid",
      }),
    deliveryPincode: z.string().regex(/^[1-9]\d{5}$/, "Enter a valid Indian pincode"),
    budgetPaise: z.number().int().positive().max(1_000_000_000),
    fssaiLicense: z
      .string()
      .trim()
      .regex(/^\d{14}$/, "FSSAI license must contain 14 digits")
      .optional(),
  })
  .strict();

export const labelSpecPatchSchema = labelSpecSchema.partial().strict();

export const createRfqSchema = z
  .object({
    rawText: z.string().trim().min(10, "Describe the order in at least 10 characters").max(5_000),
  })
  .strict();

export const updateRfqSchema = z
  .object({
    spec: labelSpecPatchSchema.optional(),
  })
  .strict()
  .refine((value) => value.spec && Object.keys(value.spec).length > 0, {
    message: "Provide at least one specification field",
  });

export const orchestrationSchema = z
  .object({
    artworkFilename: z.string().trim().min(1).max(255).optional(),
    artworkSizeBytes: z.number().int().min(0).max(15 * 1024 * 1024).optional(),
    artworkFields: z.record(z.string(), z.boolean()).optional(),
  })
  .strict();

export const revisionSchema = z
  .object({
    changes: labelSpecPatchSchema,
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value.changes).length > 0, {
    message: "Revision changes are required",
  });

export const labelRulesRequestSchema = z
  .object({
    spec: labelSpecSchema,
    artworkFields: z.record(z.string(), z.boolean()).optional(),
  })
  .strict();

export const artworkInspectionSchema = z
  .object({
    engine: z.string().trim().min(1).max(80),
    pageCount: z.number().int().positive().max(500).optional(),
    widthMm: z.number().positive().max(5_000).optional(),
    heightMm: z.number().positive().max(5_000).optional(),
    bleedMm: z.number().min(0).max(50).optional(),
    dpi: z.number().positive().max(2_400).optional(),
    notes: z.array(z.string().max(500)).max(40).optional(),
  })
  .strict();

export const printCheckRequestSchema = z
  .object({
    filename: z.string().trim().min(1).max(255),
    sizeBytes: z.number().int().min(0).max(15 * 1024 * 1024),
    mimeType: z.enum(["application/pdf", "image/png", "image/jpeg"]).optional(),
    minDpi: z.number().int().min(72).max(1_200).optional(),
    minBleedMm: z.number().min(0).max(20).optional(),
    trimWidthMm: z.number().positive().max(2_000).optional(),
    trimHeightMm: z.number().positive().max(2_000).optional(),
    inspection: artworkInspectionSchema.optional(),
  })
  .strict();

export const capacityRequestSchema = z.object({ spec: labelSpecSchema }).strict();

export const clientPaymentConfirmationSchema = z
  .object({
    orderId: z.string().trim().min(1).max(100),
    paymentId: z.string().trim().min(1).max(100).optional(),
    signature: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

export const MAX_ARTWORK_BYTES = 10 * 1024 * 1024;
export const ALLOWED_ARTWORK_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
]);

export function validationMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`)
    .join("; ");
}
