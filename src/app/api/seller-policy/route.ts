import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_MERCHANT_ID,
  ensureDefaultCommerceData,
  getActiveSellerPolicy,
  saveSellerPolicy,
} from "@/lib/commerce/catalog";
import { sellerPolicyWriteSchema } from "@/lib/commerce/types";
import { handleRoute } from "@/lib/api-response";
import { validationMessage } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    await ensureDefaultCommerceData();
    const merchantId =
      req.nextUrl.searchParams.get("merchantId") ?? DEFAULT_MERCHANT_ID;
    const policy = await getActiveSellerPolicy(merchantId);
    if (!policy) {
      return NextResponse.json({ error: "No active seller policy" }, { status: 404 });
    }
    return NextResponse.json(policy);
  });
}

export async function PUT(req: NextRequest) {
  return handleRoute(async () => {
    const parsed = sellerPolicyWriteSchema.safeParse(
      await req.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: validationMessage(parsed.error) },
        { status: 400 }
      );
    }
    const policy = await saveSellerPolicy(parsed.data);
    return NextResponse.json(policy);
  });
}
