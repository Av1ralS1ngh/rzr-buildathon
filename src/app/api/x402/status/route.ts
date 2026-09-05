import { NextResponse } from "next/server";
import { x402FacilitatorStatus } from "@/lib/x402";
import { llmConfigured } from "@/lib/llm";
import { enfocusConfigured } from "@/lib/enfocus";
import { STATUTE_PACK } from "@/lib/statutes/india-packaged-goods";

export const runtime = "nodejs";

export async function GET() {
  const x402 = await x402FacilitatorStatus();
  return NextResponse.json({
    x402,
    parser: {
      llm: llmConfigured(),
      fallback: "rules+zod",
    },
    labelRules: {
      pack: STATUTE_PACK,
    },
    printCheck: {
      localEngine: "speclock-preflight-v2",
      enfocus: enfocusConfigured(),
    },
  });
}
