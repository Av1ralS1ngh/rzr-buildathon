import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { toLabelSpec, mergeSpec } from "@/lib/rfq-parser";
import type { LabelSpec } from "@/lib/types";
import type { CommitmentRow, QuoteRow, RfqRow } from "@/lib/db-types";
import { calculateQuote, getPricebookVersion } from "@/lib/pricebook";
import { policyCheckQuote, policyCheckRevision } from "@/lib/policy";
import { hashSpec, newId } from "@/lib/commitment";
import { logAudit } from "@/lib/audit";
import { labelSpecSchema, revisionSchema, validationMessage } from "@/lib/validation";
import { runLabelRulesCheck } from "@/lib/capabilities/label-rules";
import { runPrintCheck } from "@/lib/capabilities/print-check";
import { runCapacityCheck } from "@/lib/capabilities/capacity";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: rfqId } = await ctx.params;
  const rfq = db.prepare(`SELECT * FROM rfqs WHERE id = ?`).get(rfqId) as RfqRow | undefined;
  if (!rfq) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (rfq.status !== "locked") {
    return NextResponse.json(
      { error: "Revisions only after deposit on locked spec" },
      { status: 400 }
    );
  }

  const parsedBody = revisionSchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: validationMessage(parsedBody.error) },
      { status: 400 }
    );
  }
  const pending = db
    .prepare(`SELECT id FROM revisions WHERE rfq_id = ? AND status = 'proposed'`)
    .get(rfqId);
  if (pending) {
    return NextResponse.json(
      { error: "Resolve the existing proposed revision first" },
      { status: 409 }
    );
  }

  const existing = JSON.parse(rfq.spec_json ?? "{}") as Partial<LabelSpec>;
  const merged = mergeSpec(existing, parsedBody.data.changes);
  const validatedSpec = labelSpecSchema.safeParse(merged);
  const newSpec = validatedSpec.success ? toLabelSpec(validatedSpec.data) : null;
  if (!newSpec || !validatedSpec.success) {
    return NextResponse.json(
      {
        error: validatedSpec.success
          ? "Invalid revision specification"
          : validationMessage(validatedSpec.error),
      },
      { status: 400 }
    );
  }

  const oldHash = hashSpec(JSON.parse(rfq.spec_json ?? "{}") as LabelSpec);
  const newHash = hashSpec(newSpec);
  if (oldHash === newHash) {
    return NextResponse.json({ error: "No material spec change" }, { status: 400 });
  }

  const baseCommitment = db
    .prepare(
      `SELECT * FROM commitments
       WHERE rfq_id = ? AND status = 'locked'
       ORDER BY version DESC LIMIT 1`
    )
    .get(rfqId) as CommitmentRow | undefined;
  if (!baseCommitment) {
    return NextResponse.json({ error: "Locked commitment not found" }, { status: 409 });
  }
  const oldQuote = db.prepare(`SELECT * FROM quotes WHERE id = ?`).get(
    baseCommitment.quote_id
  ) as QuoteRow | undefined;
  if (!oldQuote) {
    return NextResponse.json({ error: "Original quote not found" }, { status: 409 });
  }

  const rules = runLabelRulesCheck(newSpec);
  const print = runPrintCheck({
    filename: rfq.artwork_name ?? "artwork.pdf",
    sizeBytes: rfq.artwork_size ?? 0,
    mimeType: (rfq.artwork_mime ?? undefined) as
      | "application/pdf"
      | "image/png"
      | "image/jpeg"
      | undefined,
  });
  const capacity = runCapacityCheck(newSpec, newHash);
  const failed = [rules, print, capacity].filter((result) => result.status === "fail");
  if (failed.length > 0) {
    logAudit(rfqId, "orchestrator", "revision_blocked", {
      failedChecks: failed.map((result) => result.receiptId),
    });
    return NextResponse.json(
      { error: "Revision failed capability checks", checks: { rules, print, capacity } },
      { status: 422 }
    );
  }

  let newQuote;
  try {
    newQuote = calculateQuote(newSpec);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Revision cannot be quoted" },
      { status: 422 }
    );
  }
  const deltaPaise = newQuote.totalPaise - oldQuote.total_paise;
  const revisionPolicy = policyCheckRevision(deltaPaise);
  const quotePolicy = policyCheckQuote(newSpec, newQuote.totalPaise);
  const paidDeposits = (
    db
      .prepare(
        `SELECT COALESCE(SUM(amount_paise), 0) AS total
         FROM commitments WHERE rfq_id = ? AND status = 'locked'`
      )
      .get(rfqId) as { total: number }
  ).total;
  const additionalDepositPaise = Math.max(0, newQuote.depositPaise - paidDeposits);
  const requiresApproval =
    revisionPolicy.requiresHumanApproval || quotePolicy.requiresApproval;
  const revisionId = newId("rev");
  const quoteId = newId("quote");
  const now = Date.now();

  db.transaction(() => {
    db.prepare(`UPDATE quotes SET status = 'superseded' WHERE rfq_id = ? AND status = 'active'`)
      .run(rfqId);
    db.prepare(
      `INSERT INTO quotes (
        id, rfq_id, line_items_json, total_paise, deposit_paise, spec_hash,
        artwork_hash, pricebook_version, expires_at, created_at, status, requires_approval
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
    ).run(
      quoteId,
      rfqId,
      JSON.stringify(newQuote.lineItems),
      newQuote.totalPaise,
      additionalDepositPaise,
      newHash,
      rfq.artwork_hash,
      getPricebookVersion(),
      now + 48 * 60 * 60 * 1000,
      now,
      requiresApproval ? 1 : 0
    );
    db.prepare(
      `INSERT INTO revisions (
        id, rfq_id, base_commitment_id, quote_id, spec_json, status,
        delta_paise, requires_approval, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?)`
    ).run(
      revisionId,
      rfqId,
      baseCommitment.id,
      quoteId,
      JSON.stringify(newSpec),
      deltaPaise,
      requiresApproval ? 1 : 0,
      parsedBody.data.reason ?? null,
      now
    );
    db.prepare(`UPDATE rfqs SET status = 'revision_proposed', updated_at = ? WHERE id = ?`)
      .run(now, rfqId);
    logAudit(rfqId, "buyer_agent", "revision_proposed", {
      revisionId,
      quoteId,
      deltaPaise,
      additionalDepositPaise,
      oldHash,
      newHash,
      requiresHumanApproval: requiresApproval,
    });
  })();

  return NextResponse.json({
    revisionId,
    quoteId,
    deltaPaise,
    additionalDepositPaise,
    requiresHumanApproval: requiresApproval,
    oldTotalPaise: oldQuote.total_paise,
    newTotalPaise: newQuote.totalPaise,
    newSpec,
  });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: rfqId } = await ctx.params;
  const revision = db
    .prepare(
      `SELECT id, quote_id, base_commitment_id
       FROM revisions WHERE rfq_id = ? AND status = 'proposed'
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(rfqId) as
    | { id: string; quote_id: string; base_commitment_id: string }
    | undefined;
  if (!revision) {
    return NextResponse.json({ error: "No proposed revision found" }, { status: 404 });
  }
  const pendingPayment = db
    .prepare(
      `SELECT id FROM commitments
       WHERE quote_id = ? AND status = 'payment_pending'`
    )
    .get(revision.quote_id);
  if (pendingPayment) {
    return NextResponse.json(
      { error: "A payment order already exists for this revision" },
      { status: 409 }
    );
  }
  const base = db
    .prepare(`SELECT quote_id FROM commitments WHERE id = ? AND status = 'locked'`)
    .get(revision.base_commitment_id) as { quote_id: string } | undefined;
  if (!base) {
    return NextResponse.json({ error: "Base commitment not found" }, { status: 409 });
  }

  db.transaction(() => {
    db.prepare(`UPDATE revisions SET status = 'cancelled' WHERE id = ?`).run(revision.id);
    db.prepare(`UPDATE quotes SET status = 'superseded' WHERE id = ?`).run(revision.quote_id);
    db.prepare(`UPDATE quotes SET status = 'active' WHERE id = ?`).run(base.quote_id);
    db.prepare(`UPDATE rfqs SET status = 'locked', updated_at = ? WHERE id = ?`).run(
      Date.now(),
      rfqId
    );
    logAudit(rfqId, "buyer_agent", "revision_cancelled", { revisionId: revision.id });
  })();

  return NextResponse.json({ ok: true, status: "locked" });
}
