import { NextRequest, NextResponse } from "next/server";
import { cancelNegotiation } from "@/lib/commerce/negotiation-service";
import {
  ACP_VERSION,
  toAcpCheckout,
} from "@/lib/commerce/protocol-adapters";
import { apiError } from "@/lib/api-response";
import { isAcpAuthorized } from "@/lib/commerce/protocol-auth";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    if (req.headers.get("api-version") !== ACP_VERSION) {
      return NextResponse.json(
        { type: "invalid_request", message: `API-Version must be ${ACP_VERSION}` },
        { status: 400 }
      );
    }
    if (!isAcpAuthorized(req)) {
      return NextResponse.json(
        { type: "authentication_error", message: "Invalid bearer token" },
        { status: 401 }
      );
    }
    const { id } = await ctx.params;
    cancelNegotiation(id);
    return NextResponse.json(toAcpCheckout(id), {
      headers: { "API-Version": ACP_VERSION },
    });
  } catch (error) {
    return apiError(error);
  }
}
