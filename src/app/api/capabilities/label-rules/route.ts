import { NextRequest, NextResponse } from "next/server";
import { runLabelRulesCheck } from "@/lib/capabilities/label-rules";
import { buildPaymentRequired, authorizeCapability } from "@/lib/x402";
import { labelRulesRequestSchema, validationMessage } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:43123";
  const resourceUrl = `${baseUrl}/api/capabilities/label-rules`;
  const parsed = labelRulesRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: validationMessage(parsed.error) },
      { status: 400 }
    );
  }
  const auth = await authorizeCapability(req, "label_rules");

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error ?? "Payment required" }, {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": buildPaymentRequired("label_rules", resourceUrl),
        "Cache-Control": "no-store",
      },
    });
  }

  const result = runLabelRulesCheck(parsed.data.spec, parsed.data.artworkFields);
  return NextResponse.json(
    { capability: "label_rules", paymentMode: auth.mode, ...result },
    { headers: auth.paymentResponse ? { "PAYMENT-RESPONSE": auth.paymentResponse } : undefined }
  );
}
