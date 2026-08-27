import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getNegotiation } from "@/lib/commerce/negotiation-service";
import { createCommerceOrder } from "@/lib/commerce/commerce-order";
import { verifyMandate } from "@/lib/commerce/mandates";
import {
  toUcpCheckout,
  UCP_VERSION,
} from "@/lib/commerce/protocol-adapters";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";

const completeSchema = z
  .object({
    checkout_mandate: z.string().min(20).optional(),
    payment_mandate: z.string().min(20).optional(),
    payment_handler: z.string().default("razorpay_inr"),
  })
  .passthrough();

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: "Idempotency-Key header is required" },
        { status: 400 }
      );
    }
    const input = completeSchema.parse(await req.json().catch(() => ({})));
    if (input.payment_handler !== "razorpay_inr") {
      return NextResponse.json(
        { error: "Unsupported payment handler" },
        { status: 422 }
      );
    }
    const session = getNegotiation(id);
    if (session.status !== "agreed") {
      return NextResponse.json(
        { error: "Negotiation must be agreed before checkout completion" },
        { status: 409 }
      );
    }
    for (const token of [input.checkout_mandate, input.payment_mandate]) {
      if (token && !verifyMandate(token).valid) {
        return NextResponse.json({ error: "Invalid AP2 mandate" }, { status: 400 });
      }
    }
    const order = await createCommerceOrder(id);
    return NextResponse.json(
      {
        ...toUcpCheckout(id),
        completion: {
          status: order.status,
          orderId: order.id,
          paymentHandler: "razorpay_inr",
          razorpayOrderId: order.razorpayOrderId,
          amountPaise: order.amountPaise,
          currency: order.currency,
          mock: order.mock,
        },
      },
      {
        status: order.status === "paid" ? 200 : 202,
        headers: {
          "UCP-Version": UCP_VERSION,
          "Idempotency-Key": idempotencyKey,
        },
      }
    );
  } catch (error) {
    return apiError(error);
  }
}
