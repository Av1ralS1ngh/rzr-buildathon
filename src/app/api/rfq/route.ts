import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { parseRfqText } from "@/lib/rfq-parser";
import { logAudit } from "@/lib/audit";
import { newId } from "@/lib/commitment";
import { createRfqSchema, validationMessage } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const result = createRfqSchema.safeParse(await req.json().catch(() => null));
  if (!result.success) {
    return NextResponse.json(
      { error: validationMessage(result.error) },
      { status: 400 }
    );
  }
  const { rawText } = result.data;

  const parsed = parseRfqText(rawText);
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
      }),
      Date.now(),
      Date.now()
    );

  await logAudit(id, "buyer_agent", "rfq_created", {
    missingFields: parsed.missingFields,
    confidence: parsed.confidence,
  });

  return NextResponse.json(
    {
      id,
      status,
      spec: parsed.spec,
      missingFields: parsed.missingFields,
      clarificationQuestions: parsed.clarificationQuestions,
    },
    { status: 201 }
  );
}

export async function GET() {
  const rows = await db
    .prepare(`SELECT id, status, raw_text, created_at FROM rfqs ORDER BY created_at DESC LIMIT 20`)
    .all();
  return NextResponse.json({ rfqs: rows });
}
