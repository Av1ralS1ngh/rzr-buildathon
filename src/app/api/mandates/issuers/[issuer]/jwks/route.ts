import { NextRequest, NextResponse } from "next/server";
import { publicJwkForIssuer } from "@/lib/commerce/mandates";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ issuer: string }> }
) {
  const { issuer } = await ctx.params;
  if (!issuer || issuer.length > 200) {
    return NextResponse.json({ error: "Invalid issuer" }, { status: 400 });
  }
  return NextResponse.json(
    { keys: [publicJwkForIssuer(issuer)] },
    { headers: { "Cache-Control": "public, max-age=300" } }
  );
}
