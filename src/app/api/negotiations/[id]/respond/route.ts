import { NextRequest, NextResponse } from "next/server";
import { respondAsSeller } from "@/lib/commerce/negotiation-service";
import { sellerRespondSchema } from "@/lib/commerce/types";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const input = sellerRespondSchema.parse({
      ...body,
      idempotencyKey:
        req.headers.get("idempotency-key") ?? body.idempotencyKey,
    });
    return NextResponse.json(await respondAsSeller(id, input));
  } catch (error) {
    return apiError(error);
  }
}
