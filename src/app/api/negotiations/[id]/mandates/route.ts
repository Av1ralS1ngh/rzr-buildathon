import { NextRequest, NextResponse } from "next/server";
import { listMandates, type MandateAudience } from "@/lib/commerce/mandates";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const requested = req.nextUrl.searchParams.get("audience") as MandateAudience | null;
    const internalSecret = process.env.SPELOCK_INTERNAL_SECRET;
    const authorized =
      internalSecret &&
      req.headers.get("x-speclock-internal") === internalSecret;
    const audience: MandateAudience =
      authorized && requested && ["buyer", "seller", "processor", "shared"].includes(requested)
        ? requested
        : "shared";
    return NextResponse.json({ mandates: listMandates(id, audience) });
  } catch (error) {
    return apiError(error);
  }
}
