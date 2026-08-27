import type { LabelSpec } from "../types";
import { newId } from "../commitment";

/** Rules derived from FSSAI labelling expectations for packaged foods (demo checklist). */
export function runLabelRulesCheck(
  spec: LabelSpec,
  artworkFields: Record<string, boolean> = {}
): {
  status: "pass" | "warn" | "fail";
  requiredFields: string[];
  missingOnArtwork: string[];
  receiptId: string;
  payload: Record<string, unknown>;
} {
  const requiredFields = [
    "net_quantity",
    "manufacturer_name",
    "manufacturer_address",
    "fssai_logo",
    "fssai_license_number",
    "mrp",
    "batch_or_use_by",
    "vegetarian_non_veg_symbol",
  ];

  if (spec.productType.includes("pickle") || spec.oilExposure) {
    requiredFields.push("ingredient_list");
  }

  const suppliedArtworkFields = Object.keys(artworkFields).length > 0;
  const missingOnArtwork = suppliedArtworkFields
    ? requiredFields.filter((field) => artworkFields[field] !== true)
    : [];

  let status: "pass" | "warn" | "fail" = "pass";
  if (!suppliedArtworkFields) status = "warn";
  else if (missingOnArtwork.length > 3) status = "fail";
  else if (missingOnArtwork.length > 0) status = "warn";

  return {
    status,
    requiredFields,
    missingOnArtwork,
    receiptId: newId("rcpt_rules"),
    payload: {
      productType: spec.productType,
      requiredFields,
      missingOnArtwork,
      verificationScope: suppliedArtworkFields
        ? "submitted_artwork_fields"
        : "requirements_only",
      message: suppliedArtworkFields
        ? undefined
        : "Artwork fields were not supplied; requirements were generated but content was not certified.",
      disclaimer:
        "Rules-based checklist — not a statutory compliance certificate.",
    },
  };
}
