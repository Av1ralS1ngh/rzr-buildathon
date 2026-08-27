import { NextRequest, NextResponse } from "next/server";
import {
  createCommerceOrder,
  getCommerceOrder,
} from "@/lib/commerce/commerce-order";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    return NextResponse.json(await createCommerceOrder(id));
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(
  req: NextRequest,
  _ctx: { params: Promise<{ id: string }> }
) {
  try {
    const orderId = req.nextUrl.searchParams.get("orderId");
    if (!orderId) {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 });
    }
    return NextResponse.json(getCommerceOrder(orderId));
  } catch (error) {
    return apiError(error);
  }
}
