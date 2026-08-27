import { NextResponse } from "next/server";
import db from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const rfqs = await db
    .prepare(
      `SELECT r.id, r.status, r.raw_text, r.created_at,
              q.total_paise, q.deposit_paise,
              c.status as commitment_status
       FROM rfqs r
       LEFT JOIN quotes q ON q.id = (
         SELECT q2.id FROM quotes q2
         WHERE q2.rfq_id = r.id AND q2.status = 'active'
         ORDER BY q2.created_at DESC LIMIT 1
       )
       LEFT JOIN commitments c ON c.id = (
         SELECT c2.id FROM commitments c2
         WHERE c2.rfq_id = r.id
         ORDER BY c2.version DESC LIMIT 1
       )
       ORDER BY r.created_at DESC
       LIMIT 50`
    )
    .all();

  return NextResponse.json({ rfqs });
}
