import { NextResponse } from "next/server";
import {
  DEFAULT_MERCHANT_ID,
  ensureDefaultCommerceData,
} from "@/lib/commerce/catalog";
import {
  publicJwkForIssuer,
} from "@/lib/commerce/mandates";
import { UCP_VERSION } from "@/lib/commerce/protocol-adapters";

export const runtime = "nodejs";

export async function GET() {
  ensureDefaultCommerceData();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:43123";
  return NextResponse.json(
    {
      ucp: {
        version: UCP_VERSION,
        services: {
          "dev.ucp.shopping": [
            {
              version: UCP_VERSION,
              spec: `https://ucp.dev/${UCP_VERSION}/specification/overview`,
              transport: "rest",
              endpoint: `${baseUrl}/ucp/v1`,
              schema: `https://ucp.dev/${UCP_VERSION}/services/shopping/rest.openapi.json`,
            },
            {
              version: UCP_VERSION,
              spec: `https://ucp.dev/${UCP_VERSION}/specification/overview`,
              transport: "a2a",
              endpoint: `${baseUrl}/.well-known/agent-card.json`,
            },
          ],
        },
        capabilities: {
          "dev.ucp.shopping.checkout": [
            {
              version: UCP_VERSION,
              spec: `https://ucp.dev/${UCP_VERSION}/specification/checkout`,
              schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/checkout.json`,
            },
          ],
          "dev.ucp.shopping.ap2_mandates": [
            {
              version: UCP_VERSION,
              spec: "https://ap2-protocol.org/",
              schema: `${baseUrl}/api/protocols/schemas/mandate`,
              extends: "dev.ucp.shopping.checkout",
            },
          ],
          "in.speclock.negotiation": [
            {
              version: "2026-08-27",
              spec: `${baseUrl}/docs/negotiation`,
              schema: `${baseUrl}/api/protocols/schemas/negotiation`,
              extends: "dev.ucp.shopping.checkout",
            },
          ],
        },
        payment_handlers: {
          "in.speclock.razorpay": [
            {
              id: "razorpay_inr",
              version: "2026-08-27",
              spec: `${baseUrl}/docs/razorpay-handler`,
              schema: `${baseUrl}/api/protocols/schemas/razorpay-handler`,
              config: { currency: "INR", mode: "redirect_checkout" },
            },
          ],
        },
      },
      keys: [publicJwkForIssuer(DEFAULT_MERCHANT_ID)],
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300",
      },
    }
  );
}
