import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import {
  verifyPaymentSignature,
  verifyWebhookSignature,
  isRazorpayMockMode,
} from "@/lib/razorpay";
import { logAudit } from "@/lib/audit";
import { clientPaymentConfirmationSchema, validationMessage } from "@/lib/validation";
import crypto from "crypto";
import type { CommitmentRow } from "@/lib/db-types";
import { markCommerceOrderPaid } from "@/lib/commerce/commerce-order";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  let mockMode: boolean;
  try {
    mockMode = isRazorpayMockMode();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Payment configuration error" },
      { status: 500 }
    );
  }
  if (!mockMode) {
    if (!verifyWebhookSignature(rawBody, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const event = typeof payload.event === "string" ? payload.event : "unknown";
  const eventId =
    req.headers.get("x-razorpay-event-id") ??
    (typeof payload.id === "string" ? payload.id : null) ??
    crypto.createHash("sha256").update(rawBody).digest("hex");
  const seen = await db
    .prepare(`SELECT event_id FROM webhook_events WHERE event_id = ?`)
    .get(eventId);
  if (seen) return NextResponse.json({ ok: true, duplicate: true });

  let result: PaymentResult = { ok: true, ignored: true };
  if (event === "payment.captured" || event === "order.paid") {
    const data = extractPayment(payload, event);
    if (!data.orderId) {
      return NextResponse.json({ error: "Webhook is missing an order id" }, { status: 400 });
    }
    result = await markOrderPaid(data.orderId, data.paymentId, data.amountPaise, data.currency);
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 409 });
  }
  await db
    .prepare(
      `INSERT INTO webhook_events (event_id, event_type, processed_at) VALUES (?, ?, ?)`
    )
    .run(eventId, event, Date.now());
  return NextResponse.json({ ok: true, ignored: result.ignored });
}

export async function PUT(req: NextRequest) {
  const parsed = clientPaymentConfirmationSchema.safeParse(
    await req.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: validationMessage(parsed.error) },
      { status: 400 }
    );
  }
  const { orderId, paymentId, signature } = parsed.data;
  const mockMode = isRazorpayMockMode();

  if (!mockMode) {
    if (!paymentId || !signature) {
      return NextResponse.json(
        { error: "paymentId and signature are required" },
        { status: 400 }
      );
    }
    if (!verifyPaymentSignature({ orderId, paymentId, signature })) {
      return NextResponse.json({ error: "Invalid payment signature" }, { status: 400 });
    }
  } else if (!orderId.startsWith("order_mock_")) {
    return NextResponse.json(
      { error: "Only mock orders can be confirmed while Razorpay is not configured" },
      { status: 400 }
    );
  }

  const result = await markOrderPaid(orderId, paymentId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 409 });
  }
  return NextResponse.json({ ok: true, duplicate: result.duplicate });
}

async function markOrderPaid(
  orderId: string,
  paymentId?: string,
  amountPaise?: number,
  currency?: string
): Promise<PaymentResult> {
  const commitment = (await db
    .prepare(`SELECT * FROM commitments WHERE razorpay_order_id = ?`)
    .get(orderId)) as CommitmentRow | undefined;

  if (!commitment) {
    try {
      const commerceResult = await markCommerceOrderPaid({
        razorpayOrderId: orderId,
        paymentId: paymentId ?? `pay_mock_${orderId}`,
        amountPaise,
        currency,
      });
      if (commerceResult) {
        return { ok: true, duplicate: commerceResult.duplicate };
      }
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Negotiated payment could not be applied",
      };
    }
    return { ok: false, error: "Unknown Razorpay order", status: 404 };
  }
  if (currency && currency !== "INR") {
    return { ok: false, error: "Payment currency does not match the order" };
  }
  if (amountPaise !== undefined && amountPaise !== commitment.amount_paise) {
    return { ok: false, error: "Payment amount does not match the commitment" };
  }

  return applyPaid(commitment, paymentId ?? `pay_mock_${commitment.id}`);
}

async function applyPaid(
  commitment: CommitmentRow,
  paymentId: string
): Promise<PaymentResult> {
  if (commitment.status === "deposit_paid" || commitment.status === "locked") {
    return { ok: true, duplicate: true };
  }
  if (commitment.status !== "payment_pending") {
    return {
      ok: false,
      error: `Commitment cannot be paid while '${commitment.status}'`,
    };
  }

  await db.transaction(async () => {
    const update = await db
      .prepare(
        `UPDATE commitments
       SET status = 'locked', razorpay_payment_id = ?
       WHERE id = ? AND status = 'payment_pending'`
      )
      .run(paymentId, commitment.id);
    if (update.changes !== 1) throw new Error("Commitment was updated concurrently");
    const revision = (await db
      .prepare(
        `SELECT id, spec_json FROM revisions
         WHERE quote_id = ? AND status = 'proposed'`
      )
      .get(commitment.quote_id)) as
      | { id: string; spec_json: string }
      | undefined;
    if (revision) {
      await db.prepare(`UPDATE revisions SET status = 'accepted' WHERE id = ?`).run(revision.id);
      await db
        .prepare(
          `UPDATE rfqs SET spec_json = ?, status = 'locked', updated_at = ? WHERE id = ?`
        )
        .run(revision.spec_json, Date.now(), commitment.rfq_id);
    } else {
      await db
        .prepare(`UPDATE rfqs SET status = 'locked', updated_at = ? WHERE id = ?`)
        .run(Date.now(), commitment.rfq_id);
    }
    await logAudit(commitment.rfq_id, "razorpay", "deposit_captured", {
      commitmentId: commitment.id,
      paymentId,
      amountPaise: commitment.amount_paise,
    });
    await logAudit(commitment.rfq_id, "system", "production_locked", {
      commitmentId: commitment.id,
      commitmentHash: commitment.commitment_hash,
    });
  });
  return { ok: true };
}

type PaymentResult = {
  ok: boolean;
  error?: string;
  status?: number;
  duplicate?: boolean;
  ignored?: boolean;
};

function extractPayment(payload: Record<string, unknown>, event: string) {
  const wrapper = payload.payload as Record<string, unknown> | undefined;
  const payment = (wrapper?.payment as { entity?: Record<string, unknown> } | undefined)
    ?.entity;
  const order = (wrapper?.order as { entity?: Record<string, unknown> } | undefined)?.entity;
  return {
    orderId:
      (typeof payment?.order_id === "string" ? payment.order_id : undefined) ??
      (event === "order.paid" && typeof order?.id === "string" ? order.id : undefined),
    paymentId: typeof payment?.id === "string" ? payment.id : undefined,
    amountPaise:
      typeof payment?.amount === "number"
        ? payment.amount
        : typeof order?.amount_paid === "number"
          ? order.amount_paid
          : undefined,
    currency:
      typeof payment?.currency === "string"
        ? payment.currency
        : typeof order?.currency === "string"
          ? order.currency
          : undefined,
  };
}
