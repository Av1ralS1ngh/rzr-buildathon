import { NextRequest, NextResponse } from "next/server";
import {
  loadPricebookRates,
  savePricebookRates,
} from "@/lib/commerce/pricebook-store";
import { DEFAULT_MERCHANT_ID } from "@/lib/commerce/catalog";
import { pricebookWriteSchema } from "@/lib/commerce/types";
import { handleRoute } from "@/lib/api-response";
import { validationMessage } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const merchantId =
      req.nextUrl.searchParams.get("merchantId") ?? DEFAULT_MERCHANT_ID;
    const rates = await loadPricebookRates(merchantId);
    return NextResponse.json(rates);
  });
}

export async function PUT(req: NextRequest) {
  return handleRoute(async () => {
    const parsed = pricebookWriteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: validationMessage(parsed.error) },
        { status: 400 }
      );
    }
    const rates = await savePricebookRates(parsed.data);
    return NextResponse.json(rates);
  });
}
