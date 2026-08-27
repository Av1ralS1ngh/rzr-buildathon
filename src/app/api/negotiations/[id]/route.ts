import { NextRequest, NextResponse } from "next/server";
import { getNegotiation } from "@/lib/commerce/negotiation-service";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    return NextResponse.json(getNegotiation(id));
  } catch (error) {
    return apiError(error);
  }
}
