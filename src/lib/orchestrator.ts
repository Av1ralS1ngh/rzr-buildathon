import db from "./db";
import type { LabelSpec, CapabilityReceipt } from "./types";
import { hashSpec, newId } from "./commitment";
import { runLabelRulesCheck } from "./capabilities/label-rules";
import { runPrintCheck } from "./capabilities/print-check";
import { runCapacityCheck } from "./capabilities/capacity";
import { calculateQuote, getPricebookVersion } from "./pricebook";
import { policyCheckQuote } from "./policy";
import { logAudit } from "./audit";

export async function orchestrateRfq(
  rfqId: string,
  spec: LabelSpec,
  artworkMeta?: {
    filename: string;
    sizeBytes: number;
    mimeType?: "application/pdf" | "image/png" | "image/jpeg";
    hash?: string;
    fields?: Record<string, boolean>;
  }
): Promise<{
  receipts: CapabilityReceipt[];
  quoteId?: string;
  blocked: boolean;
  blockReason?: string;
}> {
  const specHash = hashSpec(spec);
  const existingQuote = await db
    .prepare(
      `SELECT id, requires_approval FROM quotes
       WHERE rfq_id = ? AND spec_hash = ?
         AND COALESCE(artwork_hash, '') = ?
         AND status = 'active' AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get<{ id: string; requires_approval: number }>(
      rfqId,
      specHash,
      artworkMeta?.hash ?? "",
      Date.now()
    );
  if (existingQuote) {
    await db
      .prepare(`UPDATE rfqs SET status = ?, updated_at = ? WHERE id = ?`)
      .run(
        existingQuote.requires_approval ? "awaiting_approval" : "quoted",
        Date.now(),
        rfqId
      );
    return {
      receipts: (await getReceiptsForRfq(rfqId)).filter(
        (receipt) =>
          receipt.specHash === specHash &&
          (receipt.capability !== "print_check" ||
            receipt.artworkHash === artworkMeta?.hash)
      ),
      quoteId: existingQuote.id,
      blocked: false,
    };
  }

  const receipts: CapabilityReceipt[] = [];
  const paymentMode: CapabilityReceipt["paymentMode"] = "internal";

  const rules = runLabelRulesCheck(spec, artworkMeta?.fields);
  receipts.push({
    capability: "label_rules",
    status: rules.status,
    receiptId: rules.receiptId,
    specHash,
    payload: rules.payload,
    paymentMode,
    paidAt: new Date().toISOString(),
  });

  const print = runPrintCheck({
    filename: artworkMeta?.filename ?? "artwork.pdf",
    sizeBytes: artworkMeta?.sizeBytes ?? 0,
    mimeType: artworkMeta?.mimeType,
  });
  receipts.push({
    capability: "print_check",
    status: print.status,
    receiptId: print.receiptId,
    specHash,
    artworkHash: artworkMeta?.hash,
    payload: print.payload,
    paymentMode,
    paidAt: new Date().toISOString(),
  });

  const capacity = runCapacityCheck(spec, specHash);
  receipts.push({
    capability: "capacity",
    status: capacity.status,
    receiptId: capacity.receiptId,
    specHash,
    payload: capacity.payload,
    paymentMode,
    paidAt: new Date().toISOString(),
  });

  await db.transaction(async () => {
    for (const receipt of receipts) {
      await db
        .prepare(
          `INSERT INTO capability_receipts (id, rfq_id, capability, receipt_json, payment_mode, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          receipt.receiptId,
          rfqId,
          receipt.capability,
          JSON.stringify(receipt),
          receipt.paymentMode,
          Date.now()
        );
    }
  });

  await logAudit(rfqId, "orchestrator", "capabilities_purchased", {
    receipts: receipts.map((r) => ({
      capability: r.capability,
      status: r.status,
      receiptId: r.receiptId,
    })),
  });

  const failed = receipts.some((r) => r.status === "fail");
  if (failed) {
    await db
      .prepare(`UPDATE rfqs SET status = ?, updated_at = ? WHERE id = ?`)
      .run("blocked", Date.now(), rfqId);
    await logAudit(rfqId, "orchestrator", "capability_check_blocked", {
      failed: receipts
        .filter((receipt) => receipt.status === "fail")
        .map((receipt) => receipt.capability),
    });
    return {
      receipts,
      blocked: true,
      blockReason: "One or more capability checks failed",
    };
  }

  try {
    const quote = calculateQuote(spec);
    const policy = policyCheckQuote(spec, quote.totalPaise);
    if (!policy.allowed) {
      await db
        .prepare(`UPDATE rfqs SET status = ? WHERE id = ?`)
        .run("blocked", rfqId);
      return {
        receipts,
        blocked: true,
        blockReason: policy.reasons.join("; "),
      };
    }

    const quoteId = newId("quote");
    const expiresAt = Date.now() + 48 * 60 * 60 * 1000;

    const nextStatus = policy.requiresApproval ? "awaiting_approval" : "quoted";
    await db.transaction(async () => {
      await db
        .prepare(
          `UPDATE quotes SET status = 'superseded' WHERE rfq_id = ? AND status = 'active'`
        )
        .run(rfqId);
      await db
        .prepare(
          `INSERT INTO quotes (
          id, rfq_id, line_items_json, total_paise, deposit_paise, spec_hash, artwork_hash,
          pricebook_version, expires_at, created_at, status, requires_approval
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
        )
        .run(
          quoteId,
          rfqId,
          JSON.stringify(quote.lineItems),
          quote.totalPaise,
          quote.depositPaise,
          specHash,
          artworkMeta?.hash ?? null,
          getPricebookVersion(),
          expiresAt,
          Date.now(),
          policy.requiresApproval ? 1 : 0
        );
      await db
        .prepare(`UPDATE rfqs SET status = ?, updated_at = ? WHERE id = ?`)
        .run(nextStatus, Date.now(), rfqId);
    });

    await logAudit(rfqId, "pricebook", "quote_generated", {
      quoteId,
      totalPaise: quote.totalPaise,
      depositPaise: quote.depositPaise,
      requiresApproval: policy.requiresApproval,
    });

    return { receipts, quoteId, blocked: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Quote failed";
    await db
      .prepare(`UPDATE rfqs SET status = ?, updated_at = ? WHERE id = ?`)
      .run("blocked", Date.now(), rfqId);
    await logAudit(rfqId, "pricebook", "quote_blocked", { message });
    return { receipts, blocked: true, blockReason: message };
  }
}

export async function getReceiptsForRfq(
  rfqId: string
): Promise<CapabilityReceipt[]> {
  const rows = await db
    .prepare(
      `SELECT receipt_json FROM capability_receipts WHERE rfq_id = ? ORDER BY created_at ASC`
    )
    .all<{ receipt_json: string }>(rfqId);
  return rows.map(
    (row) => JSON.parse(row.receipt_json) as CapabilityReceipt
  );
}
