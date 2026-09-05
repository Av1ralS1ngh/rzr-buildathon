import db from "@/lib/db";
import { parseRfq } from "@/lib/rfq-parser";
import { logAudit } from "@/lib/audit";
import { newId } from "@/lib/commitment";
import type { LabelSpec } from "@/lib/types";

export type CreatedRfq = {
  id: string;
  status: string;
  spec: Partial<LabelSpec>;
  missingFields: string[];
  clarificationQuestions: string[];
  engine: "rules" | "llm+zod";
  llmModel?: string;
};

export async function createRfqFromText(
  rawText: string,
  source: "web" | "telegram" = "web"
): Promise<CreatedRfq> {
  const parsed = await parseRfq(rawText);
  const id = newId("rfq");
  const status =
    parsed.missingFields.length > 0 || parsed.clarificationQuestions.length > 0
      ? "needs_clarification"
      : "draft";

  await db
    .prepare(
      `INSERT INTO rfqs (
      id, status, raw_text, spec_json, artwork_hash, clarification_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      status,
      rawText,
      JSON.stringify(parsed.spec),
      null,
      JSON.stringify({
        missingFields: parsed.missingFields,
        questions: parsed.clarificationQuestions,
        engine: parsed.engine,
        llmModel: parsed.llmModel ?? null,
        source,
      }),
      Date.now(),
      Date.now()
    );

  await logAudit(id, source === "telegram" ? "telegram_buyer" : "buyer_agent", "rfq_created", {
    missingFields: parsed.missingFields,
    confidence: parsed.confidence,
    engine: parsed.engine,
    llmModel: parsed.llmModel,
    source,
  });

  return {
    id,
    status,
    spec: parsed.spec,
    missingFields: parsed.missingFields,
    clarificationQuestions: parsed.clarificationQuestions,
    engine: parsed.engine,
    llmModel: parsed.llmModel,
  };
}
