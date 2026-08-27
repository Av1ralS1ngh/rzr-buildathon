import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import type { QuoteRow, RfqRow } from "@/lib/db-types";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const rfq = db.prepare(`SELECT * FROM rfqs WHERE id = ?`).get(id) as
    | RfqRow
    | undefined;
  if (!rfq) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
  if (rfq.status !== "awaiting_approval" && rfq.status !== "revision_proposed") {
    return NextResponse.json(
      { error: `RFQ is not awaiting approval (current status: ${rfq.status})` },
      { status: 409 }
    );
  }

  const quote = db
    .prepare(
      `SELECT * FROM quotes
       WHERE rfq_id = ? AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(id) as QuoteRow | undefined;
  if (!quote || quote.expires_at <= Date.now()) {
    return NextResponse.json(
      { error: "The quote is missing or expired; run verification again" },
      { status: 409 }
    );
  }
  if (!quote.requires_approval) {
    return NextResponse.json({ ok: true, quoteId: quote.id, status: rfq.status });
  }

  db.transaction(() => {
    db.prepare(`UPDATE quotes SET requires_approval = 0 WHERE id = ?`).run(quote.id);
    db.prepare(
      `UPDATE revisions SET requires_approval = 0
       WHERE quote_id = ? AND status = 'proposed'`
    ).run(quote.id);
    const nextStatus = rfq.status === "revision_proposed" ? "revision_proposed" : "quoted";
    db.prepare(`UPDATE rfqs SET status = ?, updated_at = ? WHERE id = ?`).run(
      nextStatus,
      Date.now(),
      id
    );
    logAudit(id, "merchant", "quote_approved", {
      quoteId: quote.id,
      totalPaise: quote.total_paise,
    });
  })();

  return NextResponse.json({
    ok: true,
    quoteId: quote.id,
    status: rfq.status === "revision_proposed" ? "revision_proposed" : "quoted",
  });
}
