import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getNegotiation } from "@/lib/commerce/negotiation-service";
import { createCommerceOrder } from "@/lib/commerce/commerce-order";
import { verifyMandate } from "@/lib/commerce/mandates";
import {
  toUcpCheckout,
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
    if (!req.headers.get("ucp-agent")) {
      return NextResponse.json({ error: "UCP-Agent header is required" }, { status: 400 });
    }
    const requestId = req.headers.get("request-id");
    if (!requestId) {
      return NextResponse.json({ error: "Request-Id header is required" }, { status: 400 });
    }
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
    const session = await getNegotiation(id);
    if (session.status !== "agreed") {
      return NextResponse.json(
        { error: "Negotiation must be agreed before checkout completion" },
        { status: 409 }
      );
    }
    for (const token of [input.checkout_mandate, input.payment_mandate]) {
      if (token && !(await verifyMandate(token)).valid) {
        return NextResponse.json({ error: "Invalid AP2 mandate" }, { status: 400 });
      }
    }
    const order = await createCommerceOrder(id);
    const checkout = await toUcpCheckout(id);
    return NextResponse.json(
      {
        ...checkout,
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
          "Idempotency-Key": idempotencyKey,
          "Request-Id": requestId,
        },
      }
    );
  } catch (error) {
    return apiError(error);
  }
}
