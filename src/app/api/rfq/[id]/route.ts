import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { getAuditEvents } from "@/lib/audit";
import { getReceiptsForRfq } from "@/lib/orchestrator";
import { mergeSpec, toLabelSpec } from "@/lib/rfq-parser";
import type { LabelSpec } from "@/lib/types";
import type { QuoteRow, RfqRow, CommitmentRow } from "@/lib/db-types";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const rfq = db.prepare(`SELECT * FROM rfqs WHERE id = ?`).get(id) as RfqRow | undefined;
  if (!rfq) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const quote = db
    .prepare(`SELECT * FROM quotes WHERE rfq_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(id) as QuoteRow | undefined;

  const commitment = db
    .prepare(`SELECT * FROM commitments WHERE rfq_id = ? ORDER BY version DESC LIMIT 1`)
    .get(id) as CommitmentRow | undefined;

  return NextResponse.json({
    rfq: {
      id: rfq.id,
      status: rfq.status,
      rawText: rfq.raw_text,
      spec: rfq.spec_json ? JSON.parse(rfq.spec_json) : null,
      artworkHash: rfq.artwork_hash,
      clarification: rfq.clarification_json
        ? JSON.parse(rfq.clarification_json)
        : null,
      createdAt: rfq.created_at,
    },
    quote: quote
      ? {
          id: quote.id,
          lineItems: JSON.parse(quote.line_items_json),
          totalPaise: quote.total_paise,
          depositPaise: quote.deposit_paise,
          specHash: quote.spec_hash,
          pricebookVersion: quote.pricebook_version,
          expiresAt: quote.expires_at,
        }
      : null,
    commitment: commitment
      ? {
          id: commitment.id,
          version: commitment.version,
          status: commitment.status,
          specHash: commitment.spec_hash,
          artworkHash: commitment.artwork_hash,
          razorpayOrderId: commitment.razorpay_order_id,
          razorpayPaymentId: commitment.razorpay_payment_id,
        }
      : null,
    receipts: getReceiptsForRfq(id),
    audit: getAuditEvents(id),
  });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const body = await req.json();
  const rfq = db.prepare(`SELECT * FROM rfqs WHERE id = ?`).get(id) as RfqRow | undefined;
  if (!rfq) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const existing = JSON.parse(rfq.spec_json ?? "{}");
  const merged = mergeSpec(existing, body.spec ?? {});
  const spec = toLabelSpec(merged as Partial<LabelSpec>);

  db.prepare(`UPDATE rfqs SET spec_json = ?, status = ? WHERE id = ?`).run(
    JSON.stringify(merged),
    spec ? "draft" : "needs_clarification",
    id
  );

  if (body.artworkHash) {
    db.prepare(`UPDATE rfqs SET artwork_hash = ? WHERE id = ?`).run(
      body.artworkHash,
      id
    );
  }

  return NextResponse.json({ ok: true, spec: merged, ready: !!spec });
}
