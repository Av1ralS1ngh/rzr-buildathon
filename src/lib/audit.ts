import db from "./db";
import { newId } from "./commitment";

export async function logAudit(
  rfqId: string,
  actor: string,
  action: string,
  detail: Record<string, unknown> = {}
) {
  const id = newId("aud");
  await db
    .prepare(
      `INSERT INTO audit_events (id, rfq_id, actor, action, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, rfqId, actor, action, JSON.stringify(detail), Date.now());
}

export async function getAuditEvents(rfqId: string) {
  const rows = await db
    .prepare(
      `SELECT id, rfq_id, actor, action, detail_json, created_at
       FROM audit_events WHERE rfq_id = ? ORDER BY created_at ASC`
    )
    .all(rfqId);
  return rows.map((row) => {
      const r = row as {
        id: string;
        rfq_id: string;
        actor: string;
        action: string;
        detail_json: string;
        created_at: number;
      };
      return {
        id: r.id,
        rfqId: r.rfq_id,
        actor: r.actor,
        action: r.action,
        detail: JSON.parse(r.detail_json) as Record<string, unknown>,
        createdAt: r.created_at,
      };
    });
}
