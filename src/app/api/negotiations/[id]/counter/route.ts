import { NextRequest, NextResponse } from "next/server";
import { counterNegotiation } from "@/lib/commerce/negotiation-service";
import { counterOfferSchema } from "@/lib/commerce/types";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as Record<string, unknown>;
    const input = counterOfferSchema.parse({
      ...body,
      idempotencyKey:
        req.headers.get("idempotency-key") ?? body.idempotencyKey,
    });
    return NextResponse.json(counterNegotiation(id, input));
  } catch (error) {
    return apiError(error);
  }
}
