import { NextRequest, NextResponse } from "next/server";
import { cancelNegotiation } from "@/lib/commerce/negotiation-service";
import {
  toUcpCheckout,
  UCP_VERSION,
} from "@/lib/commerce/protocol-adapters";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    cancelNegotiation(id);
    return NextResponse.json(toUcpCheckout(id), {
      headers: { "UCP-Version": UCP_VERSION },
    });
  } catch (error) {
    return apiError(error);
  }
}
