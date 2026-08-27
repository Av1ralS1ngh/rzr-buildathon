import { NextResponse } from "next/server";
import { ACP_VERSION } from "@/lib/commerce/protocol-adapters";

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:43123";
  return NextResponse.json(
    {
      protocol: {
        name: "acp",
        version: ACP_VERSION,
        supported_versions: [ACP_VERSION],
        documentation_url:
          "https://github.com/agentic-commerce-protocol/agentic-commerce-protocol",
      },
      api_base_url: baseUrl,
      transports: ["rest"],
      capabilities: {
        services: ["checkout", "orders"],
        extensions: ["in.speclock.negotiation"],
        intervention_types: [],
        supported_currencies: ["inr"],
        supported_locales: ["en-IN"],
      },
    },
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}
