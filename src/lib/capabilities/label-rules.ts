import type { LabelSpec } from "../types";
import { newId } from "../commitment";
import { STATUTE_PACK, statutoryRequirements } from "../statutes/india-packaged-goods";

/** Statutory FSSAI + Legal Metrology pack. Not a compliance certificate. */
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
  const pack = statutoryRequirements(spec);
  const required = pack.filter((row) => row.required);
  const requiredFields = required.map((row) => row.id);
  const suppliedArtworkFields = Object.keys(artworkFields).length > 0;
  const missingOnArtwork = suppliedArtworkFields
    ? required.filter((row) => artworkFields[row.id] !== true).map((row) => row.id)
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
      pack: STATUTE_PACK,
      required,
      missingOnArtwork,
      verificationScope: suppliedArtworkFields
        ? "submitted_artwork_fields"
        : "requirements_only",
      message: suppliedArtworkFields
        ? undefined
        : "Artwork field evidence was not supplied; the statute pack was generated but the plate was not certified.",
      disclaimer:
        "Statutory requirements pack for Indian packaged goods. Not a legal compliance certificate.",
    },
  };
}
