import { NextRequest, NextResponse } from "next/server";
import { toMerchantProduct, updateProduct } from "@/lib/commerce/catalog";
import { productPatchSchema } from "@/lib/commerce/types";
import { handleRoute } from "@/lib/api-response";
import { validationMessage } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return handleRoute(async () => {
    const { id } = await ctx.params;
    const parsed = productPatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: validationMessage(parsed.error) },
        { status: 400 }
      );
    }
    if (Object.keys(parsed.data).length === 0) {
      return NextResponse.json({ error: "No product fields to update" }, { status: 400 });
    }
    const product = await updateProduct(id, parsed.data);
    return NextResponse.json(toMerchantProduct(product));
  });
}
