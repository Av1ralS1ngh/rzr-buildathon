import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createCommerceOrder } from "@/lib/commerce/commerce-order";
import {
  ACP_VERSION,
  toAcpCheckout,
} from "@/lib/commerce/protocol-adapters";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";

const completeSchema = z
  .object({
    payment_data: z
      .object({
        provider: z.string().optional(),
        type: z.string().optional(),
        token: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough();

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    if (req.headers.get("api-version") !== ACP_VERSION) {
      return NextResponse.json(
        { type: "invalid_request", message: `API-Version must be ${ACP_VERSION}` },
        { status: 400 }
      );
    }
    if (!req.headers.get("idempotency-key")) {
      return NextResponse.json(
        {
          type: "invalid_request",
          code: "idempotency_key_required",
          message: "Idempotency-Key header is required",
        },
        { status: 400 }
      );
    }
    const input = completeSchema.parse(await req.json());
    if (
      input.payment_data.provider &&
      input.payment_data.provider !== "razorpay"
    ) {
      return NextResponse.json(
        {
          type: "invalid_request",
          code: "unsupported_payment_provider",
          message:
            "Stripe Shared Payment Tokens cannot be charged through Razorpay. Use the Razorpay handler.",
        },
        { status: 422 }
      );
    }
    const { id } = await ctx.params;
    const order = await createCommerceOrder(id);
    return NextResponse.json(
      {
        ...toAcpCheckout(id),
        metadata: {
          ...toAcpCheckout(id).metadata,
          speclock_payment_action: {
            provider: "razorpay",
            order_id: order.razorpayOrderId,
            amount: order.amountPaise,
            currency: order.currency,
            mock: order.mock,
          },
        },
      },
      {
        status: order.status === "paid" ? 200 : 202,
        headers: { "API-Version": ACP_VERSION },
      }
    );
  } catch (error) {
    return apiError(error);
  }
}
