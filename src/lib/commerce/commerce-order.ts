import crypto from "crypto";
import db from "../db";
import { newId } from "../commitment";
import { assertMockPaymentsAllowed, getRazorpay } from "../razorpay";
import { createPaymentReceipt, getMandate } from "./mandates";

export type CommerceOrderRow = {
  id: string;
  session_id: string;
  accepted_offer_id: string;
  checkout_mandate_id: string;
  payment_mandate_id: string;
  status: "preparing" | "payment_pending" | "paid" | "failed" | "refunded";
  currency: "INR";
  amount_paise: number;
  commitment_hash: string;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  created_at: number;
  updated_at: number;
};

export async function createCommerceOrder(sessionId: string) {
  const existing = await getCommerceOrderBySession(sessionId);
  if (existing?.status === "paid") return mapOrder(existing, true);
  if (existing?.status === "payment_pending" && existing.razorpay_order_id) {
    return mapOrder(existing, true);
  }

  const session = await db
    .prepare(
      `SELECT accepted_offer_id FROM negotiation_sessions
       WHERE id = ? AND status = 'agreed'`
    )
    .get<{ accepted_offer_id: string | null }>(sessionId);
  if (!session?.accepted_offer_id) {
    throw new Error("Negotiation must be agreed before checkout");
  }
  const offer = await db
    .prepare(
      `SELECT total_paise, deposit_bps FROM negotiation_offers
       WHERE id = ? AND session_id = ? AND status = 'accepted'`
    )
    .get<{ total_paise: number; deposit_bps: number }>(
      session.accepted_offer_id,
      sessionId
    );
  if (!offer) throw new Error("Accepted offer not found");
  const checkoutMandate = await getMandate(sessionId, "checkout", "closed");
  const paymentMandate = await getMandate(sessionId, "payment", "closed");
  const amountPaise = Math.round(
    (offer.total_paise * offer.deposit_bps) / 10_000
  );
  const commitmentHash = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        sessionId,
        acceptedOfferId: session.accepted_offer_id,
        checkoutMandateHash: checkoutMandate.payloadHash,
        paymentMandateHash: paymentMandate.payloadHash,
        amountPaise,
        currency: "INR",
      })
    )
    .digest("hex");
  const orderId = existing?.id ?? newId("deal");
  const now = Date.now();

  if (!existing) {
    try {
      await db
        .prepare(
          `INSERT INTO commerce_orders (
          id, session_id, accepted_offer_id, checkout_mandate_id,
          payment_mandate_id, status, currency, amount_paise, commitment_hash,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'preparing', 'INR', ?, ?, ?, ?)`
        )
        .run(
          orderId,
          sessionId,
          session.accepted_offer_id,
          checkoutMandate.id,
          paymentMandate.id,
          amountPaise,
          commitmentHash,
          now,
          now
        );
    } catch {
      const concurrent = await getCommerceOrderBySession(sessionId);
      if (concurrent) return mapOrder(concurrent, true);
      throw new Error("Checkout is already being prepared");
    }
  }

  if (amountPaise === 0) {
    await db
      .prepare(
        `UPDATE commerce_orders SET status = 'paid', updated_at = ? WHERE id = ?`
      )
      .run(Date.now(), orderId);
    await createPaymentReceipt({
      sessionId,
      commerceOrderId: orderId,
      paymentId: `pay_zero_${orderId}`,
      amountPaise: 0,
    });
    return mapOrder(await requireCommerceOrder(orderId), false);
  }

  try {
    assertMockPaymentsAllowed();
    const razorpay = getRazorpay();
    const mock = !razorpay;
    const razorpayOrderId = razorpay
      ? (
          await razorpay.orders.create({
            amount: amountPaise,
            currency: "INR",
            receipt: `deal_${orderId}`.slice(0, 40),
            notes: {
              negotiation_id: sessionId,
              accepted_offer_id: session.accepted_offer_id,
              checkout_mandate_hash: checkoutMandate.payloadHash,
              payment_mandate_hash: paymentMandate.payloadHash,
              commitment_hash: commitmentHash,
            },
          })
        ).id
      : `order_mock_${orderId}`;
    const update = await db
      .prepare(
        `UPDATE commerce_orders
       SET status = 'payment_pending', razorpay_order_id = ?, updated_at = ?
       WHERE id = ? AND status IN ('preparing', 'failed')`
      )
      .run(razorpayOrderId, Date.now(), orderId);
    if (update.changes !== 1) throw new Error("Checkout changed concurrently");
    return {
      ...mapOrder(await requireCommerceOrder(orderId), false),
      mock,
      keyId: mock ? undefined : process.env.RAZORPAY_KEY_ID,
    };
  } catch (error) {
    await db
      .prepare(
        `UPDATE commerce_orders SET status = 'failed', updated_at = ? WHERE id = ?`
      )
      .run(Date.now(), orderId);
    throw error;
  }
}

export async function markCommerceOrderPaid(input: {
  razorpayOrderId: string;
  paymentId: string;
  amountPaise?: number;
  currency?: string;
}) {
  const order = await db
    .prepare(`SELECT * FROM commerce_orders WHERE razorpay_order_id = ?`)
    .get<CommerceOrderRow>(input.razorpayOrderId);
  if (!order) return null;
  if (input.currency && input.currency !== order.currency) {
    throw new Error("Payment currency does not match the negotiated order");
  }
  if (
    input.amountPaise !== undefined &&
    input.amountPaise !== order.amount_paise
  ) {
    throw new Error("Payment amount does not match the negotiated order");
  }
  if (order.status === "paid") return { duplicate: true, order: mapOrder(order, true) };
  if (order.status !== "payment_pending") {
    throw new Error(`Negotiated order cannot be paid while '${order.status}'`);
  }

  await db.transaction(async () => {
    const update = await db
      .prepare(
        `UPDATE commerce_orders
       SET status = 'paid', razorpay_payment_id = ?, updated_at = ?
       WHERE id = ? AND status = 'payment_pending'`
      )
      .run(input.paymentId, Date.now(), order.id);
    if (update.changes !== 1) throw new Error("Negotiated order changed concurrently");
    await createPaymentReceipt({
      sessionId: order.session_id,
      commerceOrderId: order.id,
      paymentId: input.paymentId,
      amountPaise: order.amount_paise,
    });
  });
  return { duplicate: false, order: mapOrder(await requireCommerceOrder(order.id), false) };
}

export async function getCommerceOrder(orderId: string) {
  return mapOrder(await requireCommerceOrder(orderId), false);
}

async function getCommerceOrderBySession(sessionId: string) {
  return db
    .prepare(`SELECT * FROM commerce_orders WHERE session_id = ?`)
    .get<CommerceOrderRow>(sessionId);
}

async function requireCommerceOrder(orderId: string) {
  const order = await db
    .prepare(`SELECT * FROM commerce_orders WHERE id = ?`)
    .get<CommerceOrderRow>(orderId);
  if (!order) throw new Error("Negotiated order not found");
  return order;
}

function mapOrder(row: CommerceOrderRow, reused: boolean) {
  const mock = row.razorpay_order_id?.startsWith("order_mock_") ?? false;
  return {
    id: row.id,
    sessionId: row.session_id,
    acceptedOfferId: row.accepted_offer_id,
    checkoutMandateId: row.checkout_mandate_id,
    paymentMandateId: row.payment_mandate_id,
    status: row.status,
    currency: row.currency,
    amountPaise: row.amount_paise,
    commitmentHash: row.commitment_hash,
    razorpayOrderId: row.razorpay_order_id,
    razorpayPaymentId: row.razorpay_payment_id,
    mock,
    reused,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
