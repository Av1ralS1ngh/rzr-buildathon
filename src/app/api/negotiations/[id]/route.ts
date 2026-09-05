import { NextRequest, NextResponse } from "next/server";
import { getNegotiation } from "@/lib/commerce/negotiation-service";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const roleParam = req.nextUrl.searchParams.get("role");
    const role =
      roleParam === "seller" || roleParam === "buyer" ? roleParam : undefined;
    return NextResponse.json(await getNegotiation(id, role ? { role } : undefined));
  } catch (error) {
    return apiError(error);
  }
}
