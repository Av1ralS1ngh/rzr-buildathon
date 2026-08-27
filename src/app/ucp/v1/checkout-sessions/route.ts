import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createProtocolNegotiation,
  toUcpCheckout,
} from "@/lib/commerce/protocol-adapters";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";

const lineItemSchema = z
  .object({
    id: z.string().optional(),
    product_id: z.string().optional(),
    item: z.object({ id: z.string().min(1) }).passthrough().optional(),
    quantity: z.number().int().positive(),
  })
  .passthrough()
  .refine((item) => item.product_id || item.item?.id || item.id, {
    message: "Each line item needs a product id",
  });

const createSchema = z
  .object({
    currency: z.string().length(3),
    line_items: z.array(lineItemSchema).min(1).max(50),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export async function POST(req: NextRequest) {
  try {
    const agent = req.headers.get("ucp-agent");
    if (!agent) {
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
    const body = createSchema.parse(await req.json());
    const session = createProtocolNegotiation({
      protocol: "ucp",
      buyerAgentId: agent,
      idempotencyKey,
      currency: body.currency,
      items: body.line_items.map((item) => ({
        productId: item.product_id ?? item.item?.id ?? item.id!,
        quantity: item.quantity,
      })),
      metadata: body.metadata,
    });
    return NextResponse.json(toUcpCheckout(session.id), {
      status: 201,
      headers: { "Idempotency-Key": idempotencyKey, "Request-Id": requestId },
    });
  } catch (error) {
    return apiError(error);
  }
}
