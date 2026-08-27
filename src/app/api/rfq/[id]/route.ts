import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { getAuditEvents } from "@/lib/audit";
import { getReceiptsForRfq } from "@/lib/orchestrator";
import { mergeSpec, toLabelSpec } from "@/lib/rfq-parser";
import type { LabelSpec, RfqStatus } from "@/lib/types";
import type { QuoteRow, RfqRow, CommitmentRow } from "@/lib/db-types";
import { editableBeforePayment } from "@/lib/state-machine";
import { hashSpec } from "@/lib/commitment";
import {
  labelSpecSchema,
  updateRfqSchema,
  validationMessage,
} from "@/lib/validation";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const rfq = (await db.prepare(`SELECT * FROM rfqs WHERE id = ?`).get(id)) as
    | RfqRow
    | undefined;
  if (!rfq) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const quote = (await db
    .prepare(
      `SELECT * FROM quotes
       WHERE rfq_id = ? AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(id)) as QuoteRow | undefined;

  const commitment = (await db
    .prepare(`SELECT * FROM commitments WHERE rfq_id = ? ORDER BY version DESC LIMIT 1`)
    .get(id)) as CommitmentRow | undefined;
  const revision = (await db
    .prepare(
      `SELECT id, quote_id, spec_json, status, delta_paise, requires_approval, reason, created_at
       FROM revisions WHERE rfq_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(id)) as
    | {
        id: string;
        quote_id: string;
        spec_json: string;
        status: string;
        delta_paise: number;
        requires_approval: number;
        reason: string | null;
        created_at: number;
      }
    | undefined;

  return NextResponse.json({
    rfq: {
      id: rfq.id,
      status: rfq.status,
      rawText: rfq.raw_text,
      spec: rfq.spec_json ? JSON.parse(rfq.spec_json) : null,
      artworkHash: rfq.artwork_hash,
      artwork: rfq.artwork_hash
        ? {
            hash: rfq.artwork_hash,
            filename: rfq.artwork_name,
            mimeType: rfq.artwork_mime,
            sizeBytes: rfq.artwork_size,
          }
        : null,
      clarification: rfq.clarification_json
        ? JSON.parse(rfq.clarification_json)
        : null,
      createdAt: rfq.created_at,
    },
    quote: quote
      ? {
          id: quote.id,
          lineItems: JSON.parse(quote.line_items_json),
          totalPaise: quote.total_paise,
          depositPaise: quote.deposit_paise,
          specHash: quote.spec_hash,
          pricebookVersion: quote.pricebook_version,
          expiresAt: quote.expires_at,
          expired: quote.expires_at <= Date.now(),
          requiresApproval: Boolean(quote.requires_approval),
        }
      : null,
    commitment: commitment
      ? {
          id: commitment.id,
          version: commitment.version,
          status: commitment.status,
          specHash: commitment.spec_hash,
          artworkHash: commitment.artwork_hash,
          razorpayOrderId: commitment.razorpay_order_id,
          razorpayPaymentId: commitment.razorpay_payment_id,
        }
      : null,
    revision: revision
      ? {
          id: revision.id,
          quoteId: revision.quote_id,
          spec: JSON.parse(revision.spec_json),
          status: revision.status,
          deltaPaise: revision.delta_paise,
          requiresApproval: Boolean(revision.requires_approval),
          reason: revision.reason,
          createdAt: revision.created_at,
        }
      : null,
    receipts: await getReceiptsForRfq(id),
    audit: await getAuditEvents(id),
  });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const parsedBody = updateRfqSchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: validationMessage(parsedBody.error) },
      { status: 400 }
    );
  }
  const rfq = (await db.prepare(`SELECT * FROM rfqs WHERE id = ?`).get(id)) as
    | RfqRow
    | undefined;
  if (!rfq) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!editableBeforePayment(rfq.status as RfqStatus)) {
    return NextResponse.json(
      { error: "This RFQ can no longer be edited; create a revision instead" },
      { status: 409 }
    );
  }

  const existing = JSON.parse(rfq.spec_json ?? "{}");
  const merged = mergeSpec(existing, parsedBody.data.spec ?? {});
  const shape = labelSpecSchema.safeParse(merged);
  const spec = shape.success ? toLabelSpec(shape.data as Partial<LabelSpec>) : null;
  const missingFields = shape.success
    ? []
    : [...new Set(shape.error.issues.map((issue) => String(issue.path[0] ?? "spec")))];
  const nextStatus = spec ? "draft" : "needs_clarification";
  const changed = spec
    ? hashSpec(spec) !== (labelSpecSchema.safeParse(existing).success
        ? hashSpec(existing as LabelSpec)
        : "")
    : true;

  await db.transaction(async () => {
    await db
      .prepare(
        `UPDATE rfqs
       SET spec_json = ?, clarification_json = ?, status = ?, updated_at = ?
       WHERE id = ?`
      )
      .run(
        JSON.stringify(merged),
        JSON.stringify({ missingFields, questions: [] }),
        nextStatus,
        Date.now(),
        id
      );
    if (changed) {
      await db
        .prepare(
          `UPDATE quotes SET status = 'superseded'
         WHERE rfq_id = ? AND status = 'active'`
        )
        .run(id);
    }
    await logAudit(id, "buyer_agent", "rfq_updated", {
      fields: Object.keys(parsedBody.data.spec ?? {}),
      quoteInvalidated: changed,
      ready: Boolean(spec),
    });
  });

  return NextResponse.json({ ok: true, spec: merged, ready: Boolean(spec), missingFields });
}
