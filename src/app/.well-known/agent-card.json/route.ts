import { NextResponse } from "next/server";
import { A2A_VERSION } from "@/lib/commerce/protocol-adapters";

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:43123";
  return NextResponse.json(
    {
      name: "SpecLock Seller Agent",
      description:
        "Negotiates specification-heavy B2B orders within private buyer and seller mandates.",
      supportedInterfaces: [
        {
          url: `${baseUrl}/a2a/v1`,
          protocolBinding: "HTTP+JSON",
          protocolVersion: A2A_VERSION,
        },
      ],
      provider: {
        organization: "SpecLock",
        url: baseUrl,
      },
      version: "1.0.0",
      documentationUrl: `${baseUrl}/docs/ARCHITECTURE.md`,
      capabilities: {
        streaming: false,
        pushNotifications: false,
        extendedAgentCard: false,
        extensions: [
          {
            uri: `${baseUrl}/protocols/negotiation/v1`,
            description:
              "Immutable multi-round offers, private reservation prices, cross-sell bundles, and mandate closure.",
            required: false,
          },
        ],
      },
      defaultInputModes: ["application/json", "text/plain"],
      defaultOutputModes: ["application/json", "text/plain"],
      skills: [
        {
          id: "negotiate-custom-manufacturing",
          name: "Negotiate custom manufacturing",
          description:
            "Creates bounded negotiations and exchanges immutable offers without disclosing private price limits.",
          tags: ["negotiation", "manufacturing", "pricing", "offers"],
          examples: ["Negotiate 1,000 pickle labels under ₹50,000."],
        },
        {
          id: "optimize-product-bundle",
          name: "Optimize a product bundle",
          description:
            "Finds permissioned cross-sell bundles that satisfy minimum quantities and budget authority.",
          tags: ["cross-sell", "bundle", "packaging", "optimization"],
        },
        {
          id: "close-mandated-checkout",
          name: "Close a mandated checkout",
          description:
            "Produces signed checkout and payment mandates tied to the accepted offer.",
          tags: ["AP2", "mandate", "checkout", "payment"],
        },
      ],
    },
    { headers: { "Cache-Control": "public, max-age=300" } }
  );
}
