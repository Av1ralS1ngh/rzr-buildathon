import { NextRequest, NextResponse } from "next/server";
import { cancelNegotiation } from "@/lib/commerce/negotiation-service";
import {
  toUcpCheckout,
} from "@/lib/commerce/protocol-adapters";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    if (!req.headers.get("ucp-agent")) {
      return NextResponse.json({ error: "UCP-Agent header is required" }, { status: 400 });
    }
    if (!req.headers.get("request-id")) {
      return NextResponse.json({ error: "Request-Id header is required" }, { status: 400 });
    }
    const { id } = await ctx.params;
    cancelNegotiation(id);
    return NextResponse.json(toUcpCheckout(id));
  } catch (error) {
    return apiError(error);
  }
}
