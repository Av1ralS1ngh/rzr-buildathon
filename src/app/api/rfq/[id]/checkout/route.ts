import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { assertMockPaymentsAllowed, getRazorpay } from "@/lib/razorpay";
import { hashCommitment, newId } from "@/lib/commitment";
import { logAudit } from "@/lib/audit";
import type { LineItem, RfqStatus } from "@/lib/types";
import type { CommitmentRow, QuoteRow, RfqRow } from "@/lib/db-types";
import { checkoutAllowed } from "@/lib/state-machine";
import { hashSpec } from "@/lib/commitment";
import { labelSpecSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: rfqId } = await ctx.params;
  const quote = db
    .prepare(
      `SELECT * FROM quotes
       WHERE rfq_id = ? AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(rfqId) as QuoteRow | undefined;

  if (!quote) {
    return NextResponse.json(
      { error: "No active quote — run agent verification first" },
      { status: 409 }
    );
  }

  if (Date.now() > quote.expires_at) {
    return NextResponse.json(
      { error: "Quote expired — run agent verification again" },
      { status: 410 }
    );
  }

  const rfq = db.prepare(`SELECT * FROM rfqs WHERE id = ?`).get(rfqId) as RfqRow | undefined;
  if (!rfq) {
    return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
  }
  if (!checkoutAllowed(rfq.status as RfqStatus)) {
    return NextResponse.json(
      { error: `Checkout is not allowed while RFQ is '${rfq.status}'` },
      { status: 409 }
    );
  }
  if (quote.requires_approval) {
    return NextResponse.json(
      { error: "Merchant approval is required before checkout" },
      { status: 409 }
    );
  }

  const revision = rfq.status === "revision_proposed"
    ? (db
        .prepare(
          `SELECT id, base_commitment_id, spec_json, requires_approval
           FROM revisions
           WHERE rfq_id = ? AND quote_id = ? AND status = 'proposed'`
        )
        .get(rfqId, quote.id) as
        | {
            id: string;
            base_commitment_id: string;
            spec_json: string;
            requires_approval: number;
          }
        | undefined)
    : undefined;
  if (rfq.status === "revision_proposed" && !revision) {
    return NextResponse.json(
      { error: "Active revision does not match the active quote" },
      { status: 409 }
    );
  }
  if (revision?.requires_approval) {
    return NextResponse.json(
      { error: "Merchant approval is required before revision checkout" },
      { status: 409 }
    );
  }

  const parsedSpec = labelSpecSchema.safeParse(
    JSON.parse(revision?.spec_json ?? rfq.spec_json ?? "{}")
  );
  if (!parsedSpec.success || hashSpec(parsedSpec.data) !== quote.spec_hash) {
    return NextResponse.json(
      { error: "The specification changed after quoting; run verification again" },
      { status: 409 }
    );
  }
  if ((rfq.artwork_hash ?? null) !== (quote.artwork_hash ?? null)) {
    return NextResponse.json(
      { error: "The artwork changed after quoting; run verification again" },
      { status: 409 }
    );
  }

  const lineItems = JSON.parse(quote.line_items_json) as LineItem[];
  const commitmentHash = hashCommitment({
    specHash: quote.spec_hash,
    artworkHash: rfq.artwork_hash ?? "none",
    lineItems,
    pricebookVersion: quote.pricebook_version,
    totalPaise: quote.total_paise,
  });

  const existingCommitment = db
    .prepare(
      `SELECT * FROM commitments
       WHERE quote_id = ? AND status <> 'superseded'
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(quote.id) as CommitmentRow | undefined;
  if (existingCommitment?.status === "locked") {
    return NextResponse.json(
      { error: "This quote has already been paid", commitmentId: existingCommitment.id },
      { status: 409 }
    );
  }
  if (
    existingCommitment?.status === "payment_pending" &&
    existingCommitment.razorpay_order_id
  ) {
    return NextResponse.json(
      checkoutResponse(existingCommitment, quote.deposit_paise)
    );
  }

  const commitmentId = existingCommitment?.id ?? newId("cmt");
  const versionRow = db
    .prepare(`SELECT MAX(version) as v FROM commitments WHERE rfq_id = ?`)
    .get(rfqId) as { v: number | null } | undefined;
  const version = (versionRow?.v ?? 0) + 1;

  const depositPaise = quote.deposit_paise;
  const previous = revision
    ? { id: revision.base_commitment_id }
    : db
    .prepare(
      `SELECT id FROM commitments
       WHERE rfq_id = ? AND status = 'locked'
       ORDER BY version DESC LIMIT 1`
    )
    .get(rfqId) as { id: string } | undefined;

  if (!existingCommitment) {
    try {
      db.prepare(
        `INSERT INTO commitments (
          id, rfq_id, version, spec_hash, artwork_hash, quote_id, status,
          razorpay_order_id, razorpay_payment_id, previous_commitment_id,
          created_at, commitment_hash, amount_paise
        ) VALUES (?, ?, ?, ?, ?, ?, 'preparing', NULL, NULL, ?, ?, ?, ?)`
      ).run(
        commitmentId,
        rfqId,
        version,
        quote.spec_hash,
        rfq.artwork_hash,
        quote.id,
        previous?.id ?? null,
        Date.now(),
        commitmentHash,
        depositPaise
      );
    } catch {
      const concurrent = db
        .prepare(
          `SELECT * FROM commitments
           WHERE quote_id = ? AND status <> 'superseded'
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(quote.id) as CommitmentRow | undefined;
      if (concurrent?.razorpay_order_id) {
        return NextResponse.json(checkoutResponse(concurrent, depositPaise));
      }
      return NextResponse.json({ error: "Checkout is already being prepared" }, { status: 409 });
    }
  }

  if (depositPaise === 0) {
    db.transaction(() => {
      db.prepare(
        `UPDATE commitments
         SET status = 'locked', commitment_hash = ?, amount_paise = 0
         WHERE id = ?`
      ).run(commitmentHash, commitmentId);
      if (revision) {
        db.prepare(`UPDATE revisions SET status = 'accepted' WHERE id = ?`).run(
          revision.id
        );
        db.prepare(
          `UPDATE rfqs SET spec_json = ?, status = 'locked', updated_at = ? WHERE id = ?`
        ).run(revision.spec_json, Date.now(), rfqId);
      }
      logAudit(rfqId, "system", "revision_locked_without_additional_payment", {
        revisionId: revision?.id,
        commitmentId,
        commitmentHash,
      });
    })();
    return NextResponse.json({
      commitmentId,
      commitmentHash,
      amountPaise: 0,
      currency: "INR",
      noPaymentRequired: true,
    });
  }

  try {
    assertMockPaymentsAllowed();
    const razorpay = getRazorpay();
    const mock = !razorpay;
    const receiptKey = `rfq_${rfqId}_${quote.id}`.slice(0, 40);
    const orderId = razorpay
      ? (
          await razorpay.orders.create({
            amount: depositPaise,
            currency: "INR",
            receipt: receiptKey,
            notes: {
              commitment_id: commitmentId,
              commitment_hash: commitmentHash,
              spec_hash: quote.spec_hash,
              rfq_id: rfqId,
              pricebook_v: quote.pricebook_version,
            },
          })
        ).id
      : `order_mock_${commitmentId}`;

    db.transaction(() => {
      db.prepare(
        `UPDATE commitments
         SET status = 'payment_pending', razorpay_order_id = ?, commitment_hash = ?,
             amount_paise = ?
         WHERE id = ?`
      ).run(orderId, commitmentHash, depositPaise, commitmentId);
      db.prepare(`UPDATE rfqs SET status = 'payment_pending', updated_at = ? WHERE id = ?`)
        .run(Date.now(), rfqId);
      logAudit(rfqId, "razorpay", "order_created", {
        orderId,
        depositPaise,
        commitmentId,
        commitmentHash,
        mock,
      });
    })();

    return NextResponse.json({
      commitmentId,
      commitmentHash,
      orderId,
      amountPaise: depositPaise,
      currency: "INR",
      keyId: mock ? undefined : process.env.RAZORPAY_KEY_ID,
      mock,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create payment order";
    db.transaction(() => {
      db.prepare(`UPDATE commitments SET status = 'checkout_failed' WHERE id = ?`).run(
        commitmentId
      );
      db.prepare(`UPDATE rfqs SET status = 'quoted', updated_at = ? WHERE id = ?`).run(
        Date.now(),
        rfqId
      );
      logAudit(rfqId, "razorpay", "order_creation_failed", { commitmentId, message });
    })();
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function checkoutResponse(commitment: CommitmentRow, amountPaise: number) {
  const mock = commitment.razorpay_order_id?.startsWith("order_mock_") ?? false;
  return {
    commitmentId: commitment.id,
    commitmentHash: commitment.commitment_hash,
    orderId: commitment.razorpay_order_id,
    amountPaise,
    currency: "INR",
    keyId: mock ? undefined : process.env.RAZORPAY_KEY_ID,
    mock,
    reused: true,
  };
}
