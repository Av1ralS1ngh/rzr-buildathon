import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_MERCHANT_ID,
  ensureDefaultCommerceData,
  listProducts,
  toPublicProduct,
} from "@/lib/commerce/catalog";
import { handleRoute } from "@/lib/api-response";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    await ensureDefaultCommerceData();
    const merchantId =
      req.nextUrl.searchParams.get("merchantId") ?? DEFAULT_MERCHANT_ID;
    const products = (await listProducts(merchantId)).map(toPublicProduct);
    return NextResponse.json({ merchantId, currency: "INR", products });
  });
}
