import { NextRequest, NextResponse } from "next/server";
import { listMandates } from "@/lib/commerce/mandates";
import { apiError } from "@/lib/api-response";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await ctx.params;
    return NextResponse.json({
      protocol: "AP2",
      profile: "AP2-compatible signed mandates without selective disclosures",
      sessionId,
      mandates: listMandates(sessionId, "shared"),
      verificationEndpoint: "/api/mandates/verify",
    });
  } catch (error) {
    return apiError(error);
  }
}
