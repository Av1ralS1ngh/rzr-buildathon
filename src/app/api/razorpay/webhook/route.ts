import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import {
  verifyPaymentSignature,
  verifyWebhookSignature,
  isRazorpayMockMode,
} from "@/lib/razorpay";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  const eventId = req.headers.get("x-razorpay-event-id") ?? "";

  if (!isRazorpayMockMode()) {
    if (!verifyWebhookSignature(rawBody, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
  }

  if (eventId) {
    const seen = db
      .prepare(`SELECT event_id FROM webhook_events WHERE event_id = ?`)
      .get(eventId);
    if (seen) {
      logAudit("system", "webhook", "duplicate_ignored", { eventId });
      return NextResponse.json({ ok: true, duplicate: true });
    }
    db.prepare(`INSERT INTO webhook_events (event_id, processed_at) VALUES (?, ?)`).run(
      eventId,
      Date.now()
    );
  }

  const payload = JSON.parse(rawBody);
  const event = payload.event as string;

  if (event === "payment.captured" || event === "order.paid") {
    const payment = payload.payload?.payment?.entity;
    const orderId = payment?.order_id as string | undefined;
    if (orderId) {
      markOrderPaid(orderId, payment?.id as string | undefined);
    }
  }

  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest) {
  /** Client-side payment confirmation (test mode + mock). */
  const body = await req.json();
  const { orderId, paymentId, signature, rfqId } = body;

  if (!isRazorpayMockMode() && orderId && paymentId && signature) {
    if (!verifyPaymentSignature({ orderId, paymentId, signature })) {
      return NextResponse.json({ error: "Invalid payment signature" }, { status: 400 });
    }
  }

  markOrderPaid(orderId, paymentId ?? `pay_mock_${Date.now()}`, rfqId);
  return NextResponse.json({ ok: true });
}

function markOrderPaid(
  orderId: string,
  paymentId?: string,
  rfqIdHint?: string
) {
  const commitment = db
    .prepare(`SELECT * FROM commitments WHERE razorpay_order_id = ?`)
    .get(orderId) as { id: string; rfq_id: string } | undefined;

  if (!commitment) {
    if (rfqIdHint) {
      const c = db
        .prepare(
          `SELECT * FROM commitments WHERE rfq_id = ? ORDER BY created_at DESC LIMIT 1`
        )
        .get(rfqIdHint) as
        | { id: string; rfq_id: string }
        | undefined;
      if (c) {
        applyPaid(c.id, c.rfq_id, paymentId);
      }
    }
    return;
  }

  applyPaid(commitment.id, commitment.rfq_id, paymentId);
}

function applyPaid(commitmentId: string, rfqId: string, paymentId?: string) {
  const current = db
    .prepare(`SELECT status FROM commitments WHERE id = ?`)
    .get(commitmentId) as { status: string } | undefined;
  if (current?.status === "deposit_paid" || current?.status === "locked") {
    logAudit(rfqId, "razorpay", "duplicate_payment_ignored", { commitmentId });
    return;
  }

  db.prepare(
    `UPDATE commitments SET status = ?, razorpay_payment_id = ? WHERE id = ?`
  ).run("deposit_paid", paymentId ?? null, commitmentId);

  db.prepare(`UPDATE rfqs SET status = ? WHERE id = ?`).run("deposit_paid", rfqId);

  logAudit(rfqId, "razorpay", "deposit_captured", {
    commitmentId,
    paymentId,
  });

  db.prepare(`UPDATE commitments SET status = ? WHERE id = ?`).run("locked", commitmentId);
  db.prepare(`UPDATE rfqs SET status = ? WHERE id = ?`).run("locked", rfqId);
  logAudit(rfqId, "system", "production_locked", { commitmentId });
}
