import { NextRequest, NextResponse } from "next/server";
import { runPrintCheck } from "@/lib/capabilities/print-check";
import { buildPaymentRequired, isCapabilityAuthorized } from "@/lib/x402";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = isCapabilityAuthorized(req);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:43123";
  const resourceUrl = `${baseUrl}/api/capabilities/print-check`;

  if (!auth.ok) {
    return new NextResponse(JSON.stringify({ error: "Payment required" }), {
      status: 402,
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-REQUIRED": buildPaymentRequired("print_check", resourceUrl),
      },
    });
  }

  const body = await req.json();
  const result = runPrintCheck({
    filename: body.filename ?? "artwork.pdf",
    sizeBytes: body.sizeBytes ?? 0,
    minDpi: body.minDpi,
    minBleedMm: body.minBleedMm,
  });

  return NextResponse.json({
    capability: "print_check",
    paymentMode: auth.mode,
    ...result,
  });
}
