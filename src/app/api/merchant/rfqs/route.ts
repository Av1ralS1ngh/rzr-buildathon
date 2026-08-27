import { NextResponse } from "next/server";
import db from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const rfqs = db
    .prepare(
      `SELECT r.id, r.status, r.raw_text, r.created_at,
              q.total_paise, q.deposit_paise,
              c.status as commitment_status
       FROM rfqs r
       LEFT JOIN quotes q ON q.rfq_id = r.id
       LEFT JOIN commitments c ON c.rfq_id = r.id
       ORDER BY r.created_at DESC
       LIMIT 50`
    )
    .all();

  return NextResponse.json({ rfqs });
}
