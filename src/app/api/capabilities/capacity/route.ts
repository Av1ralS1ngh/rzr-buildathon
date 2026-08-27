import { NextRequest, NextResponse } from "next/server";
import { runCapacityCheck } from "@/lib/capabilities/capacity";
import { hashSpec } from "@/lib/commitment";
import { buildPaymentRequired, authorizeCapability } from "@/lib/x402";
import { capacityRequestSchema, validationMessage } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:43123";
  const resourceUrl = `${baseUrl}/api/capabilities/capacity`;
  const parsed = capacityRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: validationMessage(parsed.error) },
      { status: 400 }
    );
  }
  const auth = await authorizeCapability(req, "capacity");

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error ?? "Payment required" }, {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": buildPaymentRequired("capacity", resourceUrl),
        "Cache-Control": "no-store",
      },
    });
  }

  const spec = parsed.data.spec;
  const specHash = hashSpec(spec);
  const result = runCapacityCheck(spec, specHash);

  return NextResponse.json(
    { capability: "capacity", paymentMode: auth.mode, ...result },
    { headers: auth.paymentResponse ? { "PAYMENT-RESPONSE": auth.paymentResponse } : undefined }
  );
}
