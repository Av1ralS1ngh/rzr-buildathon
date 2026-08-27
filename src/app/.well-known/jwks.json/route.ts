import { NextResponse } from "next/server";
import { DEFAULT_MERCHANT_ID } from "@/lib/commerce/catalog";
import { publicJwkForIssuer } from "@/lib/commerce/mandates";

export async function GET() {
  return NextResponse.json(
    {
      keys: [
        publicJwkForIssuer(DEFAULT_MERCHANT_ID),
        publicJwkForIssuer("razorpay-adapter"),
      ],
    },
    { headers: { "Cache-Control": "public, max-age=300" } }
  );
}
