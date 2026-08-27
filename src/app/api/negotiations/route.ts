import { NextRequest, NextResponse } from "next/server";
import { createNegotiation } from "@/lib/commerce/negotiation-service";
import { createNegotiationSchema, type CreateNegotiationInput } from "@/lib/commerce/types";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const idempotencyKey =
      req.headers.get("idempotency-key") ??
      (typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined);
    const input = createNegotiationSchema.parse({
      ...body,
      idempotencyKey,
    }) as CreateNegotiationInput;
    return NextResponse.json(await createNegotiation(input), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
