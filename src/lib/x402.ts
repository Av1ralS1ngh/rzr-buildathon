import type { NextRequest } from "next/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { parsePaymentPayload } from "@x402/core/schemas";

export const X402_PRICES_USD = {
  label_rules: "0.02",
  print_check: "0.05",
  capacity: "0.01",
} as const;

export type CapabilityName = keyof typeof X402_PRICES_USD;

export function paymentRequirements(
  capability: CapabilityName
) {
  return {
    scheme: "exact",
    network: process.env.X402_NETWORK ?? "eip155:84532",
    amount: usdToAtomic(X402_PRICES_USD[capability]),
    payTo: process.env.X402_PAY_TO ?? "0x0000000000000000000000000000000000000000",
    maxTimeoutSeconds: 120,
    asset:
      process.env.X402_USDC_ADDRESS ??
      "0x036CbD53842cFd8590b1C631E3ac9657c6c6d4d4",
    extra: {},
  };
}

export function buildPaymentRequired(
  capability: CapabilityName,
  resourceUrl: string
): string {
  const payload = {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: resourceUrl,
      description: `SpecLock ${capability.replace("_", " ")} capability`,
      mimeType: "application/json",
      serviceName: "SpecLock",
    },
    accepts: [paymentRequirements(capability)],
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

function usdToAtomic(usd: string): string {
  const n = parseFloat(usd);
  return String(Math.round(n * 1_000_000));
}

export async function authorizeCapability(
  req: NextRequest,
  capability: CapabilityName
): Promise<{
  ok: boolean;
  mode: "internal" | "demo" | "x402" | "none";
  paymentResponse?: string;
  error?: string;
}> {
  const internal = req.headers.get("x-speclock-internal");
  const secret = process.env.SPELOCK_INTERNAL_SECRET;
  if (secret && internal === secret) {
    return { ok: true, mode: "internal" };
  }

  const demoKey = req.headers.get("x-demo-agent-key");
  const expectedDemo = process.env.X402_DEMO_AGENT_KEY;
  if (expectedDemo && demoKey === expectedDemo) {
    return { ok: true, mode: "demo" };
  }

  const paymentSignature = req.headers.get("payment-signature");
  if (!paymentSignature) {
    return { ok: false, mode: "none" };
  }

  const facilitatorUrl = process.env.X402_FACILITATOR_URL;
  const payTo = process.env.X402_PAY_TO;
  if (!facilitatorUrl || !payTo) {
    return {
      ok: false,
      mode: "none",
      error: "x402 settlement is not configured",
    };
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(paymentSignature, "base64").toString("utf8")
    ) as unknown;
    const payload = parsePaymentPayload(decoded);
    const requirements = paymentRequirements(capability);
    const facilitatorToken = process.env.X402_FACILITATOR_TOKEN;
    const client = new HTTPFacilitatorClient({
      url: facilitatorUrl,
      createAuthHeaders: facilitatorToken
        ? async () => {
            const headers = { Authorization: `Bearer ${facilitatorToken}` };
            return { verify: headers, settle: headers, supported: headers };
          }
        : undefined,
    });

    const verified = await client.verify(payload, requirements);
    if (!verified.isValid) {
      return {
        ok: false,
        mode: "none",
        error: verified.invalidReason ?? "Payment verification failed",
      };
    }

    const settled = await client.settle(payload, requirements);
    if (!settled.success) {
      return {
        ok: false,
        mode: "none",
        error: settled.errorReason ?? "Payment settlement failed",
      };
    }

    return {
      ok: true,
      mode: "x402",
      paymentResponse: Buffer.from(JSON.stringify(settled)).toString("base64"),
    };
  } catch {
    return { ok: false, mode: "none", error: "Malformed or invalid payment" };
  }
}
