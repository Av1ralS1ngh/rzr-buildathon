import { NextRequest, NextResponse } from "next/server";
import { runCapacityCheck } from "@/lib/capabilities/capacity";
import type { LabelSpec } from "@/lib/types";
import { hashSpec } from "@/lib/commitment";
import { buildPaymentRequired, isCapabilityAuthorized } from "@/lib/x402";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = isCapabilityAuthorized(req);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:43123";
  const resourceUrl = `${baseUrl}/api/capabilities/capacity`;

  if (!auth.ok) {
    return new NextResponse(JSON.stringify({ error: "Payment required" }), {
      status: 402,
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-REQUIRED": buildPaymentRequired("capacity", resourceUrl),
      },
    });
  }

  const body = await req.json();
  const spec = body.spec as LabelSpec;
  if (!spec) {
    return NextResponse.json({ error: "spec required" }, { status: 400 });
  }

  const specHash = hashSpec(spec);
  const result = runCapacityCheck(spec, specHash);

  return NextResponse.json({
    capability: "capacity",
    paymentMode: auth.mode,
    ...result,
  });
}
