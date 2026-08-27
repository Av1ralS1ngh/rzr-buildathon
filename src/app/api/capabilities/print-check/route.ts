import { NextRequest, NextResponse } from "next/server";
import { runPrintCheck } from "@/lib/capabilities/print-check";
import { buildPaymentRequired, authorizeCapability } from "@/lib/x402";
import { printCheckRequestSchema, validationMessage } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:43123";
  const resourceUrl = `${baseUrl}/api/capabilities/print-check`;
  const parsed = printCheckRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: validationMessage(parsed.error) },
      { status: 400 }
    );
  }
  const auth = await authorizeCapability(req, "print_check");

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error ?? "Payment required" }, {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": buildPaymentRequired("print_check", resourceUrl),
        "Cache-Control": "no-store",
      },
    });
  }

  const body = parsed.data;
  const result = runPrintCheck({
    filename: body.filename,
    sizeBytes: body.sizeBytes,
    mimeType: body.mimeType,
    minDpi: body.minDpi,
    minBleedMm: body.minBleedMm,
  });

  return NextResponse.json(
    { capability: "print_check", paymentMode: auth.mode, ...result },
    { headers: auth.paymentResponse ? { "PAYMENT-RESPONSE": auth.paymentResponse } : undefined }
  );
}
