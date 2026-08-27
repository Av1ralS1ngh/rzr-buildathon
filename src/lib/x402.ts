import type { NextRequest } from "next/server";

export const X402_PRICES_USD = {
  label_rules: "0.02",
  print_check: "0.05",
  capacity: "0.01",
} as const;

export type CapabilityName = keyof typeof X402_PRICES_USD;

export function buildPaymentRequired(
  capability: CapabilityName,
  resourceUrl: string
): string {
  const payload = {
    x402Version: 2,
    error: "Payment required",
    accepts: [
      {
        scheme: "exact",
        network: process.env.X402_NETWORK ?? "eip155:84532",
        maxAmountRequired: usdToAtomic(X402_PRICES_USD[capability]),
        resource: resourceUrl,
        description: `SpecLock ${capability} capability`,
        mimeType: "application/json",
        payTo: process.env.X402_PAY_TO ?? "0x0000000000000000000000000000000000000000",
        maxTimeoutSeconds: 120,
        asset: process.env.X402_USDC_ADDRESS ?? "0x036CbD53842cFd8590b1C631E3ac9657c6c6d4d4",
      },
    ],
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

function usdToAtomic(usd: string): string {
  const n = parseFloat(usd);
  return String(Math.round(n * 1_000_000));
}

export function isCapabilityAuthorized(req: NextRequest): {
  ok: boolean;
  mode: "internal" | "demo" | "x402" | "none";
} {
  const internal = req.headers.get("x-speclock-internal");
  const secret = process.env.SPELOCK_INTERNAL_SECRET ?? "change-me-in-production";
  if (internal === secret) {
    return { ok: true, mode: "internal" };
  }

  const demoKey = req.headers.get("x-demo-agent-key");
  const expectedDemo = process.env.X402_DEMO_AGENT_KEY ?? "speclock-demo-agent";
  if (demoKey === expectedDemo) {
    return { ok: true, mode: "demo" };
  }

  const paymentSig =
    req.headers.get("payment-signature") ??
    req.headers.get("PAYMENT-SIGNATURE");
  if (paymentSig) {
    // Full CDP facilitator verification can be wired when keys are present.
    return { ok: true, mode: "x402" };
  }

  return { ok: false, mode: "none" };
}
