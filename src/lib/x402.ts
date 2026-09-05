import type { NextRequest } from "next/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { parsePaymentPayload } from "@x402/core/schemas";
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
} from "@x402/core/types";

export const X402_PRICES_USD = {
  label_rules: "0.02",
  print_check: "0.05",
  capacity: "0.01",
} as const;

export const DEFAULT_X402_FACILITATOR_URL = "https://x402.org/facilitator";
export const DEFAULT_X402_NETWORK = "eip155:84532";
export const DEFAULT_X402_USDC =
  "0x036CbD53842cFd8590b1C631E3ac9657c6c6d4d4";

export type CapabilityName = keyof typeof X402_PRICES_USD;

export function x402FacilitatorUrl(): string {
  return (process.env.X402_FACILITATOR_URL?.trim() || DEFAULT_X402_FACILITATOR_URL).replace(
    /\/+$/,
    ""
  );
}

export function x402PayTo(): string | undefined {
  const payTo = process.env.X402_PAY_TO?.trim();
  if (!payTo) return undefined;
  if (!/^0x[a-fA-F0-9]{40}$/.test(payTo)) return undefined;
  if (/^0x0+$/.test(payTo)) return undefined;
  return payTo;
}

export function x402SettlementReady(): boolean {
  return Boolean(x402PayTo());
}

export function paymentRequirements(
  capability: CapabilityName
): PaymentRequirements {
  const network = process.env.X402_NETWORK ?? DEFAULT_X402_NETWORK;
  if (!network.includes(":")) {
    throw new Error("X402_NETWORK must use CAIP-2 format");
  }
  return {
    scheme: "exact",
    network: network as Network,
    amount: usdToAtomic(X402_PRICES_USD[capability]),
    payTo: x402PayTo() ?? "0x0000000000000000000000000000000000000000",
    maxTimeoutSeconds: 120,
    asset: process.env.X402_USDC_ADDRESS ?? DEFAULT_X402_USDC,
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

export function facilitatorClient(): HTTPFacilitatorClient {
  const facilitatorToken = process.env.X402_FACILITATOR_TOKEN;
  return new HTTPFacilitatorClient({
    url: x402FacilitatorUrl(),
    createAuthHeaders: facilitatorToken
      ? async () => {
          const headers = { Authorization: `Bearer ${facilitatorToken}` };
          return { verify: headers, settle: headers, supported: headers };
        }
      : undefined,
  });
}

export async function x402FacilitatorStatus(): Promise<{
  facilitatorUrl: string;
  network: string;
  payTo: string | null;
  settlementReady: boolean;
  supported: boolean;
  error?: string;
}> {
  const payTo = x402PayTo() ?? null;
  const status = {
    facilitatorUrl: x402FacilitatorUrl(),
    network: process.env.X402_NETWORK ?? DEFAULT_X402_NETWORK,
    payTo,
    settlementReady: Boolean(payTo),
    supported: false,
  };
  try {
    const supported = await Promise.race([
      facilitatorClient().getSupported(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Facilitator timeout")), 4_000);
      }),
    ]);
    return { ...status, supported: Array.isArray(supported?.kinds) ? supported.kinds.length > 0 : true };
  } catch (error) {
    return {
      ...status,
      error: error instanceof Error ? error.message : "Facilitator unreachable",
    };
  }
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

  if (!x402SettlementReady()) {
    return {
      ok: false,
      mode: "none",
      error: "x402 settlement needs X402_PAY_TO (Base Sepolia USDC address)",
    };
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(paymentSignature, "base64").toString("utf8")
    ) as unknown;
    const parsedPayload = parsePaymentPayload(decoded);
    if (!parsedPayload.success) {
      return { ok: false, mode: "none", error: "Malformed payment payload" };
    }
    const payload = parsedPayload.data;
    if (payload.x402Version !== 2) {
      return { ok: false, mode: "none", error: "Only x402 v2 payments are accepted" };
    }
    const typedPayload = payload as PaymentPayload;
    const requirements = paymentRequirements(capability);
    const client = facilitatorClient();

    const verified = await client.verify(typedPayload, requirements);
    if (!verified.isValid) {
      return {
        ok: false,
        mode: "none",
        error: verified.invalidReason ?? "Payment verification failed",
      };
    }

    const settled = await client.settle(typedPayload, requirements);
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Malformed or invalid payment";
    return { ok: false, mode: "none", error: message };
  }
}
