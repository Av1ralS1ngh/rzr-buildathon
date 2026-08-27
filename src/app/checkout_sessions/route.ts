import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ACP_VERSION,
  createProtocolNegotiation,
  toAcpCheckout,
} from "@/lib/commerce/protocol-adapters";
import { apiError } from "@/lib/api-response";
import { isAcpAuthorized } from "@/lib/commerce/protocol-auth";

export const runtime = "nodejs";

const itemSchema = z
  .object({
    id: z.string().optional(),
    product_id: z.string().optional(),
    item: z.object({ id: z.string().min(1) }).passthrough().optional(),
    quantity: z.number().int().positive(),
  })
  .passthrough()
  .refine((item) => item.product_id || item.item?.id || item.id);

const createSchema = z
  .object({
    currency: z.string().length(3),
    line_items: z.array(itemSchema).min(1).max(50).optional(),
    items: z.array(itemSchema).min(1).max(50).optional(),
    capabilities: z.record(z.string(), z.unknown()).default({}),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
  .refine((input) => input.line_items || input.items, {
    message: "line_items is required",
  });

export async function POST(req: NextRequest) {
  try {
    const version = req.headers.get("api-version");
    if (version !== ACP_VERSION) {
      return NextResponse.json(
        {
          type: "invalid_request",
          code: "unsupported_api_version",
          message: `API-Version must be ${ACP_VERSION}`,
        },
        { status: 400 }
      );
    }
    const idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey) {
      return NextResponse.json(
        {
          type: "invalid_request",
          code: "idempotency_key_required",
          message: "Idempotency-Key header is required",
        },
        { status: 400 }
      );
    }
    if (!isAcpAuthorized(req)) {
      return NextResponse.json(
        { type: "authentication_error", message: "Invalid bearer token" },
        { status: 401 }
      );
    }
    const body = createSchema.parse(await req.json());
    const lineItems = body.line_items ?? body.items!;
    const session = await createProtocolNegotiation({
      protocol: "acp",
      buyerAgentId:
        req.headers.get("user-agent") ?? "unknown-acp-buyer-agent",
      idempotencyKey,
      currency: body.currency,
      items: lineItems.map((item) => ({
        productId: item.product_id ?? item.item?.id ?? item.id!,
        quantity: item.quantity,
      })),
      metadata: {
        ...body.metadata,
        acp_capabilities: body.capabilities,
      },
    });
    return NextResponse.json(await toAcpCheckout(session.id), {
      status: 201,
      headers: {
        "API-Version": ACP_VERSION,
        "Idempotency-Key": idempotencyKey,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
