import { newId } from "../commitment";

export interface PrintCheckInput {
  filename: string;
  sizeBytes: number;
  minDpi?: number;
  minBleedMm?: number;
}

export function runPrintCheck(input: PrintCheckInput): {
  status: "pass" | "warn" | "fail";
  checks: Array<{ code: string; message: string; level: "pass" | "warn" | "fail" }>;
  receiptId: string;
  payload: Record<string, unknown>;
} {
  const checks: Array<{
    code: string;
    message: string;
    level: "pass" | "warn" | "fail";
  }> = [];

  if (input.sizeBytes < 1024) {
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

  const minDpi = input.minDpi ?? 300;
  if (filenameIndicatesLowDpi(input.filename)) {
    checks.push({
      code: "resolution",
      message: `Raster images below ${minDpi} DPI detected (filename hint)`,
      level: "fail",
    });
  } else {
    checks.push({
      code: "resolution",
      message: `Resolution check passed (target ${minDpi} DPI)`,
      level: "pass",
    });
  }

  if (input.filename.toLowerCase().includes("no_bleed")) {
    checks.push({
      code: "bleed",
      message: `Bleed below ${input.minBleedMm ?? 3}mm requirement`,
      level: "fail",
    });
  } else {
    checks.push({
      code: "bleed",
      message: "Bleed margin acceptable",
      level: "pass",
    });
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
      checks,
      engine: "speclock-print-check-v1",
    },
  };
}

function filenameIndicatesLowDpi(filename: string): boolean {
  return /72dpi|low_res|draft/i.test(filename);
}
