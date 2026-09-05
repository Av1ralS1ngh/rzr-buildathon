export type ArtworkInspection = {
  engine: string;
  pageCount?: number;
  widthMm?: number;
  heightMm?: number;
  bleedMm?: number;
  dpi?: number;
  notes: string[];
};

const PT_TO_MM = 25.4 / 72;

export function mergeArtworkInspection(
  local: ArtworkInspection,
  remote: ArtworkInspection
): ArtworkInspection {
  const remoteHasData =
    remote.dpi != null || remote.bleedMm != null || remote.widthMm != null;
  return {
    engine: remoteHasData ? remote.engine : local.engine,
    pageCount: remote.pageCount ?? local.pageCount,
    widthMm: remote.widthMm ?? local.widthMm,
    heightMm: remote.heightMm ?? local.heightMm,
    bleedMm: remote.bleedMm ?? local.bleedMm,
    dpi: remote.dpi ?? local.dpi,
    notes: [...local.notes, ...remote.notes],
  };
}

export function inspectArtworkBytes(
  buffer: Buffer,
  mimeType: string
): ArtworkInspection {
  if (mimeType === "image/png") return inspectPng(buffer);
  if (mimeType === "image/jpeg") return inspectJpeg(buffer);
  if (mimeType === "application/pdf") return inspectPdf(buffer);
  return { engine: "speclock-preflight-v2", notes: ["Unsupported artwork type"] };
}

function inspectPng(buffer: Buffer): ArtworkInspection {
  const notes: string[] = [];
  if (buffer.length < 24) {
    return { engine: "speclock-preflight-v2", notes: ["PNG too small to inspect"] };
  }
  const widthPx = buffer.readUInt32BE(16);
  const heightPx = buffer.readUInt32BE(20);
  let dpi: number | undefined;
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    if (type === "pHYs" && length >= 9) {
      const ppx = buffer.readUInt32BE(dataStart);
      const unit = buffer[dataStart + 8];
      if (unit === 1 && ppx > 0) dpi = Math.round(ppx * 0.0254);
    }
    offset = dataStart + length + 4;
    if (type === "IEND") break;
  }
  if (!dpi) notes.push("PNG has no pHYs density chunk; DPI assumed 72 unless Enfocus runs");
  return {
    engine: "speclock-preflight-v2",
    pageCount: 1,
    widthMm: pxToMm(widthPx, dpi),
    heightMm: pxToMm(heightPx, dpi),
    dpi,
    notes,
  };
}

function inspectJpeg(buffer: Buffer): ArtworkInspection {
  const notes: string[] = [];
  let i = 2;
  let widthPx = 0;
  let heightPx = 0;
  let dpi: number | undefined;
  while (i + 9 < buffer.length) {
    if (buffer[i] !== 0xff) break;
    const marker = buffer[i + 1];
    const size = buffer.readUInt16BE(i + 2);
    if (marker === 0xe0 && size >= 16 && buffer.subarray(i + 4, i + 8).toString("ascii") === "JFIF") {
      const units = buffer[i + 11];
      const xDensity = buffer.readUInt16BE(i + 12);
      if (units === 1) dpi = xDensity;
      else if (units === 2) dpi = Math.round(xDensity * 2.54);
    }
    if (marker >= 0xc0 && marker <= 0xc3) {
      heightPx = buffer.readUInt16BE(i + 5);
      widthPx = buffer.readUInt16BE(i + 7);
      break;
    }
    i += 2 + size;
  }
  if (!widthPx) notes.push("Could not read JPEG SOF dimensions");
  if (!dpi) notes.push("JPEG has no JFIF density; DPI assumed 72 unless Enfocus runs");
  return {
    engine: "speclock-preflight-v2",
    pageCount: 1,
    widthMm: widthPx ? pxToMm(widthPx, dpi) : undefined,
    heightMm: heightPx ? pxToMm(heightPx, dpi) : undefined,
    dpi,
    notes,
  };
}

function inspectPdf(buffer: Buffer): ArtworkInspection {
  const text = buffer.toString("latin1");
  const notes: string[] = [];
  if (!text.startsWith("%PDF-")) {
    return { engine: "speclock-preflight-v2", notes: ["Not a PDF header"] };
  }
  const pageCount = Math.max(1, (text.match(/\/Type\s*\/Page(?!s)/g) ?? []).length);
  const media = parseBox(text, "MediaBox");
  const bleed = parseBox(text, "BleedBox");
  const trim = parseBox(text, "TrimBox") ?? parseBox(text, "CropBox");
  if (!media) {
    notes.push(
      "MediaBox is not in a readable object stream. Enfocus PitStop is required for compressed/encrypted PDFs."
    );
  }
  const widthPt = media ? media[2] - media[0] : undefined;
  const heightPt = media ? media[3] - media[1] : undefined;
  let bleedMm: number | undefined;
  if (media && (bleed || trim)) {
    const inner = bleed ?? trim!;
    bleedMm = Math.min(
      (inner[0] - media[0]) * PT_TO_MM,
      (inner[1] - media[1]) * PT_TO_MM,
      (media[2] - inner[2]) * PT_TO_MM,
      (media[3] - inner[3]) * PT_TO_MM
    );
  } else if (media) {
    notes.push("No BleedBox/TrimBox; cannot certify 3mm bleed from the file alone");
  }
  return {
    engine: "speclock-preflight-v2",
    pageCount,
    widthMm: widthPt != null ? round1(widthPt * PT_TO_MM) : undefined,
    heightMm: heightPt != null ? round1(heightPt * PT_TO_MM) : undefined,
    bleedMm: bleedMm != null ? round1(bleedMm) : undefined,
    notes,
  };
}

function parseBox(source: string, name: string): [number, number, number, number] | null {
  const match = source.match(
    new RegExp(`/${name}\\s*\\[\\s*([0-9.]+)\\s+([0-9.]+)\\s+([0-9.]+)\\s+([0-9.]+)\\s*\\]`)
  );
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
}

function pxToMm(px: number, dpi?: number): number {
  return round1((px * 25.4) / (dpi && dpi > 0 ? dpi : 72));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
