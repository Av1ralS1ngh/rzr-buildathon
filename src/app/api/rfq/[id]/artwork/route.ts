import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { hashArtwork } from "@/lib/commitment";
import { inspectArtworkBytes, mergeArtworkInspection } from "@/lib/preflight/artwork";
import { runEnfocusPreflight } from "@/lib/enfocus";
import { runPrintCheck } from "@/lib/capabilities/print-check";
import type { LabelSpec } from "@/lib/types";
import type { RfqRow } from "@/lib/db-types";
import type { RfqStatus } from "@/lib/types";
import { editableBeforePayment } from "@/lib/state-machine";
import { ALLOWED_ARTWORK_TYPES, MAX_ARTWORK_BYTES } from "@/lib/validation";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const rfq = (await db.prepare(`SELECT * FROM rfqs WHERE id = ?`).get(id)) as
    | RfqRow
    | undefined;
  if (!rfq) {
    return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
  }
  if (!editableBeforePayment(rfq.status as RfqStatus)) {
    return NextResponse.json(
      { error: "Artwork cannot be replaced after checkout; create a revision" },
      { status: 409 }
    );
  }

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_ARTWORK_BYTES + 1_000_000) {
    return NextResponse.json({ error: "Artwork exceeds the 10 MB limit" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }
  const value = form.get("artwork");
  if (!(value instanceof File)) {
    return NextResponse.json({ error: "artwork file is required" }, { status: 400 });
  }
  if (value.size === 0 || value.size > MAX_ARTWORK_BYTES) {
    return NextResponse.json(
      { error: value.size === 0 ? "Artwork is empty" : "Artwork exceeds the 10 MB limit" },
      { status: value.size === 0 ? 400 : 413 }
    );
  }
  if (!ALLOWED_ARTWORK_TYPES.has(value.type)) {
    return NextResponse.json(
      { error: "Artwork must be PDF, PNG, or JPEG" },
      { status: 415 }
    );
  }

  const mimeType = value.type as "application/pdf" | "image/png" | "image/jpeg";
  const buffer = Buffer.from(await value.arrayBuffer());
  if (!matchesMagicBytes(buffer, mimeType)) {
    return NextResponse.json(
      { error: "File contents do not match the declared artwork type" },
      { status: 415 }
    );
  }

  const hash = hashArtwork(buffer);
  const spec = JSON.parse(rfq.spec_json ?? "{}") as Partial<LabelSpec>;
  let inspection = inspectArtworkBytes(buffer, mimeType);
  const enfocus = await runEnfocusPreflight(buffer, safeFilename(value.name), mimeType);
  if (enfocus) {
    inspection = mergeArtworkInspection(inspection, enfocus);
  }
  const preflight = runPrintCheck({
    filename: safeFilename(value.name),
    sizeBytes: value.size,
    mimeType,
    trimWidthMm: spec.widthMm,
    trimHeightMm: spec.heightMm,
    inspection,
  });
  await db.transaction(async () => {
    await db
      .prepare(
        `UPDATE rfqs
       SET artwork_hash = ?, artwork_name = ?, artwork_mime = ?, artwork_size = ?,
           artwork_preflight_json = ?,
           status = 'draft', updated_at = ?
       WHERE id = ?`
      )
      .run(
        hash,
        safeFilename(value.name),
        value.type,
        value.size,
        JSON.stringify({ inspection, print: preflight }),
        Date.now(),
        id
      );
    await db
      .prepare(
        `UPDATE quotes SET status = 'superseded'
       WHERE rfq_id = ? AND status = 'active'`
      )
      .run(id);
    await logAudit(id, "buyer_agent", "artwork_uploaded", {
      filename: safeFilename(value.name),
      mimeType: value.type,
      sizeBytes: value.size,
      hash,
      printStatus: preflight.status,
      engine: inspection.engine,
    });
  });

  return NextResponse.json({
    artwork: {
      filename: safeFilename(value.name),
      mimeType: value.type,
      sizeBytes: value.size,
      hash,
    },
    preflight,
  });
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 255) || "artwork";
}

function matchesMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === "application/pdf") return buffer.subarray(0, 5).toString() === "%PDF-";
  if (mimeType === "image/png") {
    return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mimeType === "image/jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  return false;
}
