import { NextRequest, NextResponse } from "next/server";
import {
  generateBundleOptions,
  selectBundleOption,
} from "@/lib/commerce/bundle-optimizer";
import { apiError } from "@/lib/api-response";
import { z } from "zod";

export const runtime = "nodejs";

const selectBundleSchema = z.object({ bundleId: z.string().min(1) }).strict();

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    return NextResponse.json({ bundles: generateBundleOptions(id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const input = selectBundleSchema.parse(await req.json());
    return NextResponse.json({
      offer: selectBundleOption(id, input.bundleId),
    });
  } catch (error) {
    return apiError(error);
  }
}
