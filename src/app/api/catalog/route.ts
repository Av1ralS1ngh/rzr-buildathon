import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_MERCHANT_ID,
  createProduct,
  ensureDefaultCommerceData,
  listAllProducts,
  listProducts,
  toMerchantProduct,
  toPublicProduct,
} from "@/lib/commerce/catalog";
import { productWriteSchema } from "@/lib/commerce/types";
import { handleRoute } from "@/lib/api-response";
import { validationMessage } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    await ensureDefaultCommerceData();
    const merchantId =
      req.nextUrl.searchParams.get("merchantId") ?? DEFAULT_MERCHANT_ID;
    const merchantView = req.nextUrl.searchParams.get("view") === "merchant";
    const products = merchantView
      ? (await listAllProducts(merchantId)).map(toMerchantProduct)
      : (await listProducts(merchantId)).map(toPublicProduct);
    return NextResponse.json({
      merchantId,
      currency: "INR",
      view: merchantView ? "merchant" : "public",
      products,
    });
  });
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const parsed = productWriteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: validationMessage(parsed.error) },
        { status: 400 }
      );
    }
    const product = await createProduct(parsed.data);
    return NextResponse.json(toMerchantProduct(product), { status: 201 });
  });
}
