import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createCommerceOrder } from "@/lib/commerce/commerce-order";
import {
  ACP_VERSION,
  toAcpCheckout,
} from "@/lib/commerce/protocol-adapters";
import { apiError } from "@/lib/api-response";
import { isAcpAuthorized } from "@/lib/commerce/protocol-auth";

export const runtime = "nodejs";

const completeSchema = z
  .object({
    payment_data: z
      .object({
        handler_id: z.string().min(1),
        instrument: z
          .object({
            type: z.string().min(1),
            credential: z
              .object({
                type: z.string().min(1),
                token: z.string().min(1),
              })
              .strict(),
          })
          .strict(),
      })
      .strict(),
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
    if (!isAcpAuthorized(req)) {
      return NextResponse.json(
        { type: "authentication_error", message: "Invalid bearer token" },
        { status: 401 }
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
    if (input.payment_data.handler_id !== "razorpay_inr") {
      return NextResponse.json(
        {
          type: "invalid_request",
          code: "unsupported_payment_provider",
          message:
            "Stripe Shared Payment Tokens cannot be charged through Razorpay. Use handler_id 'razorpay_inr'.",
        },
        { status: 422 }
      );
    }
    if (
      input.payment_data.instrument.type !== "redirect" ||
      input.payment_data.instrument.credential.type !== "checkout_session"
    ) {
      return NextResponse.json(
        {
          type: "invalid_request",
          code: "unsupported_payment_instrument",
          message: "The Razorpay handler requires a redirect checkout instrument.",
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
