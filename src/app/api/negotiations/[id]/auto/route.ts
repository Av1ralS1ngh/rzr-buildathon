import { NextRequest, NextResponse } from "next/server";
import { runAutonomousNegotiation } from "@/lib/commerce/negotiation-service";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    return NextResponse.json(await runAutonomousNegotiation(id));
  } catch (error) {
    return apiError(error);
  }
}
