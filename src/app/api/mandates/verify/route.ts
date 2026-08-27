import { NextRequest, NextResponse } from "next/server";
import { verifyMandate } from "@/lib/commerce/mandates";
import { z } from "zod";

export const runtime = "nodejs";

const verifySchema = z.object({ compactJws: z.string().min(20) }).strict();

export async function POST(req: NextRequest) {
  const parsed = verifySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "compactJws is required" }, { status: 400 });
  }
  const result = verifyMandate(parsed.data.compactJws);
  return NextResponse.json(result, { status: result.valid ? 200 : 400 });
}
