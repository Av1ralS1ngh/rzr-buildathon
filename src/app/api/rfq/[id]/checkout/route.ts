import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { getRazorpay } from "@/lib/razorpay";
import { hashCommitment, newId } from "@/lib/commitment";
import { logAudit } from "@/lib/audit";
import type { LineItem } from "@/lib/types";
import type { QuoteRow, RfqRow } from "@/lib/db-types";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: rfqId } = await ctx.params;
  const quote = db
    .prepare(`SELECT * FROM quotes WHERE rfq_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(rfqId) as QuoteRow | undefined;

  if (!quote) {
    return NextResponse.json({ error: "No quote — run orchestration first" }, { status: 400 });
  }

  if (Date.now() > quote.expires_at) {
    return NextResponse.json({ error: "Quote expired" }, { status: 400 });
  }

  const rfq = db.prepare(`SELECT * FROM rfqs WHERE id = ?`).get(rfqId) as RfqRow | undefined;
  const lineItems = JSON.parse(quote.line_items_json) as LineItem[];
  const commitmentHash = hashCommitment({
    specHash: quote.spec_hash,
    artworkHash: rfq?.artwork_hash ?? "none",
    lineItems,
    pricebookVersion: quote.pricebook_version,
    totalPaise: quote.total_paise,
  });

  const commitmentId = newId("cmt");
  const versionRow = db
    .prepare(`SELECT MAX(version) as v FROM commitments WHERE rfq_id = ?`)
    .get(rfqId) as { v: number | null } | undefined;
  const version = (versionRow?.v ?? 0) + 1;

  const depositPaise = quote.deposit_paise;
  const receiptKey = `rfq_${rfqId}_dep_v${version}`.slice(0, 40);

  const razorpay = getRazorpay();
  let orderId: string;
  let mock = false;

  if (razorpay) {
    const order = await razorpay.orders.create({
      amount: depositPaise,
      currency: "INR",
      receipt: receiptKey,
      notes: {
        commitment_id: commitmentId.slice(0, 40),
        spec_hash: quote.spec_hash.slice(0, 32),
        rfq_id: rfqId.slice(0, 32),
        pricebook_v: quote.pricebook_version,
      },
    });
    orderId = order.id;
  } else {
    mock = true;
    orderId = `order_mock_${commitmentId}`;
  }

  db.prepare(
    `INSERT INTO commitments (id, rfq_id, version, spec_hash, artwork_hash, quote_id, status, razorpay_order_id, razorpay_payment_id, previous_commitment_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    commitmentId,
    rfqId,
    version,
    quote.spec_hash,
    rfq?.artwork_hash ?? null,
    quote.id,
    "payment_pending",
    orderId,
    null,
    null,
    Date.now()
  );

  db.prepare(`UPDATE rfqs SET status = ? WHERE id = ?`).run("payment_pending", rfqId);

  logAudit(rfqId, "razorpay", "order_created", {
    orderId,
    depositPaise,
    commitmentId,
    commitmentHash,
    mock,
  });

  return NextResponse.json({
    commitmentId,
    commitmentHash,
    orderId,
    amountPaise: depositPaise,
    currency: "INR",
    keyId: process.env.RAZORPAY_KEY_ID,
    mock,
  });
}
