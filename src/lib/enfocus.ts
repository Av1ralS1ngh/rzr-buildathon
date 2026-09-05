import type { ArtworkInspection } from "./preflight/artwork";

/**
 * Optional Enfocus PitStop Server / pdfToolbox HTTP preflight.
 * POST the artwork bytes to ENFOCUS_PREFLIGHT_URL with ENFOCUS_API_KEY.
 * Expected JSON (flexible): { status|result, bleedMm?, dpi?, widthMm?, heightMm?, messages?[] }
 */
export function enfocusConfigured(): boolean {
  return Boolean(process.env.ENFOCUS_PREFLIGHT_URL?.trim() && process.env.ENFOCUS_API_KEY?.trim());
}

export async function runEnfocusPreflight(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<ArtworkInspection | null> {
  const url = process.env.ENFOCUS_PREFLIGHT_URL?.trim();
  const key = process.env.ENFOCUS_API_KEY?.trim();
  if (!url || !key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": mimeType,
        "X-Filename": filename,
      },
      body: new Uint8Array(buffer),
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        engine: "enfocus-pitstop",
        notes: [`Enfocus HTTP ${response.status}`],
      };
    }
    const body = (await response.json()) as Record<string, unknown>;
    const messages = Array.isArray(body.messages)
      ? body.messages.map(String)
      : Array.isArray(body.errors)
        ? body.errors.map(String)
        : [];
    return {
      engine: "enfocus-pitstop",
      pageCount: numberish(body.pageCount),
      widthMm: numberish(body.widthMm),
      heightMm: numberish(body.heightMm),
      bleedMm: numberish(body.bleedMm),
      dpi: numberish(body.dpi),
      notes: messages.length > 0 ? messages : ["Enfocus preflight completed"],
    };
  } catch (error) {
    return {
      engine: "enfocus-pitstop",
      notes: [error instanceof Error ? error.message : "Enfocus request failed"],
    };
  } finally {
    clearTimeout(timer);
  }
}
function numberish(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
