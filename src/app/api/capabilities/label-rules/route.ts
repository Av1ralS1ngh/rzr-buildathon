import { NextRequest, NextResponse } from "next/server";
import { runLabelRulesCheck } from "@/lib/capabilities/label-rules";
import type { LabelSpec } from "@/lib/types";
import { buildPaymentRequired, isCapabilityAuthorized } from "@/lib/x402";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = isCapabilityAuthorized(req);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:43123";
  const resourceUrl = `${baseUrl}/api/capabilities/label-rules`;

  if (!auth.ok) {
    return new NextResponse(JSON.stringify({ error: "Payment required" }), {
      status: 402,
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-REQUIRED": buildPaymentRequired("label_rules", resourceUrl),
      },
    });
  }

  const body = await req.json();
  const spec = body.spec as LabelSpec;
  if (!spec) {
    return NextResponse.json({ error: "spec required" }, { status: 400 });
  }

  const result = runLabelRulesCheck(spec, body.artworkFields ?? {});
  return NextResponse.json({
    capability: "label_rules",
    paymentMode: auth.mode,
    ...result,
  });
}
