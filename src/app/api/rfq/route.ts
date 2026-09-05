import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { createRfqFromText } from "@/lib/create-rfq";
import { createRfqSchema, validationMessage } from "@/lib/validation";
import { handleRoute } from "@/lib/api-response";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const result = createRfqSchema.safeParse(await req.json().catch(() => null));
    if (!result.success) {
      return NextResponse.json(
        { error: validationMessage(result.error) },
        { status: 400 }
      );
    }
    const created = await createRfqFromText(result.data.rawText, "web");
    return NextResponse.json(created, { status: 201 });
  });
}

export async function GET() {
  return handleRoute(async () => {
    const rows = await db
      .prepare(
        `SELECT id, status, raw_text, created_at FROM rfqs ORDER BY created_at DESC LIMIT 20`
      )
      .all();
    return NextResponse.json({ rfqs: rows });
  });
}
