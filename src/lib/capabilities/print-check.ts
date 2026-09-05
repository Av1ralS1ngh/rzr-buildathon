import { newId } from "../commitment";
import type { ArtworkInspection } from "../preflight/artwork";

export interface PrintCheckInput {
  filename: string;
  sizeBytes: number;
  mimeType?: "application/pdf" | "image/png" | "image/jpeg";
  minDpi?: number;
  minBleedMm?: number;
  trimWidthMm?: number;
  trimHeightMm?: number;
  inspection?: ArtworkInspection;
}

export type PrintCheckResult = {
  status: "pass" | "warn" | "fail";
  checks: Array<{ code: string; message: string; level: "pass" | "warn" | "fail" }>;
  receiptId: string;
  payload: Record<string, unknown>;
};

export function runPrintCheck(input: PrintCheckInput): PrintCheckResult {
  const checks: PrintCheckResult["checks"] = [];
  const minDpi = input.minDpi ?? 300;
  const minBleedMm = input.minBleedMm ?? 3;
  const inspection = input.inspection;

  if (input.sizeBytes === 0) {
    checks.push({
      code: "artwork",
      message: "No artwork uploaded; preflight must be completed before production",
      level: "warn",
    });
  } else if (input.sizeBytes < 1024) {
    checks.push({
      code: "file_size",
      message: "Artwork file too small — likely not print-ready",
      level: "fail",
    });
  } else {
    checks.push({
      code: "file_size",
      message: "File size acceptable",
      level: "pass",
    });
  }

  const extension = input.filename.toLowerCase().split(".").pop();
  const supportedExtension = ["pdf", "png", "jpg", "jpeg"].includes(extension ?? "");
  if (!supportedExtension && !input.mimeType) {
    checks.push({
      code: "file_type",
      message: "Artwork must be PDF, PNG, or JPEG",
      level: "fail",
    });
  } else {
    checks.push({
      code: "file_type",
      message: `Supported artwork format${input.mimeType ? ` (${input.mimeType})` : ""}`,
      level: "pass",
    });
  }

  if (filenameIndicatesLowDpi(input.filename) || (inspection?.dpi != null && inspection.dpi < minDpi)) {
    checks.push({
      code: "resolution",
      message: `Raster below ${minDpi} DPI${inspection?.dpi ? ` (measured ${inspection.dpi})` : " (filename hint)"}`,
      level: "fail",
    });
  } else if (inspection?.dpi != null) {
    checks.push({
      code: "resolution",
      message: `Measured ${inspection.dpi} DPI (target ${minDpi})`,
      level: "pass",
    });
  } else {
    checks.push({
      code: "resolution",
      message: inspection
        ? `Density not in file; Enfocus needed to certify ${minDpi} DPI`
        : `Resolution not measured (target ${minDpi} DPI)`,
      level: inspection ? "warn" : "pass",
    });
  }

  if (
    input.filename.toLowerCase().includes("no_bleed") ||
    (inspection?.bleedMm != null && inspection.bleedMm + 0.05 < minBleedMm)
  ) {
    checks.push({
      code: "bleed",
      message: `Bleed below ${minBleedMm}mm${inspection?.bleedMm != null ? ` (measured ${inspection.bleedMm}mm)` : ""}`,
      level: "fail",
    });
  } else if (inspection?.bleedMm != null) {
    checks.push({
      code: "bleed",
      message: `Bleed ${inspection.bleedMm}mm meets ${minBleedMm}mm`,
      level: "pass",
    });
  } else {
    checks.push({
      code: "bleed",
      message: inspection
        ? `Bleed boxes not readable; Enfocus PitStop required to certify ${minBleedMm}mm`
        : "Bleed not measured from artwork bytes",
      level: inspection ? "warn" : "pass",
    });
  }

  if (inspection?.widthMm && inspection.heightMm && input.trimWidthMm && input.trimHeightMm) {
    const dw = Math.abs(inspection.widthMm - input.trimWidthMm);
    const dh = Math.abs(inspection.heightMm - input.trimHeightMm);
    const tolerance = minBleedMm * 2 + 1;
    if (dw > tolerance || dh > tolerance) {
      checks.push({
        code: "trim_match",
        message: `Artwork ${inspection.widthMm}×${inspection.heightMm}mm vs spec ${input.trimWidthMm}×${input.trimHeightMm}mm`,
        level: "warn",
      });
    } else {
      checks.push({
        code: "trim_match",
        message: "Artwork geometry matches the spec trim (within bleed)",
        level: "pass",
      });
    }
  }

  for (const note of inspection?.notes ?? []) {
    if (/enfocus http|failed/i.test(note)) {
      checks.push({ code: "enfocus", message: note, level: "warn" });
    }
  }

  const worst = checks.some((c) => c.level === "fail")
    ? "fail"
    : checks.some((c) => c.level === "warn")
      ? "warn"
      : "pass";

  return {
    status: worst,
    checks,
    receiptId: newId("rcpt_print"),
    payload: {
      filename: input.filename,
      sizeBytes: input.sizeBytes,
      mimeType: input.mimeType,
      checks,
      inspection: inspection ?? null,
      engine: inspection?.engine ?? "speclock-print-check-v2",
    },
  };
}

function filenameIndicatesLowDpi(filename: string): boolean {
  return /72dpi|low_res|draft/i.test(filename);
}
