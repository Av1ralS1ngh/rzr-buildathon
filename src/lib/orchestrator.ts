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
  artworkMeta?: { filename: string; sizeBytes: number; hash?: string }
): Promise<{
  receipts: CapabilityReceipt[];
  quoteId?: string;
  blocked: boolean;
  blockReason?: string;
}> {
  const specHash = hashSpec(spec);
  const receipts: CapabilityReceipt[] = [];
  const paymentMode: CapabilityReceipt["paymentMode"] = "internal";

  const rules = runLabelRulesCheck(spec);
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
    sizeBytes: artworkMeta?.sizeBytes ?? 2048,
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

  for (const r of receipts) {
    db.prepare(
      `INSERT INTO capability_receipts (id, rfq_id, capability, receipt_json, payment_mode, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      r.receiptId,
      rfqId,
      r.capability,
      JSON.stringify(r),
      r.paymentMode,
      Date.now()
    );
  }

  logAudit(rfqId, "orchestrator", "capabilities_purchased", {
    receipts: receipts.map((r) => ({
      capability: r.capability,
      status: r.status,
      receiptId: r.receiptId,
    })),
  });

  const failed = receipts.some((r) => r.status === "fail");
  if (failed) {
    db.prepare(`UPDATE rfqs SET status = ? WHERE id = ?`).run("blocked", rfqId);
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
      db.prepare(`UPDATE rfqs SET status = ? WHERE id = ?`).run("blocked", rfqId);
      return {
        receipts,
        blocked: true,
        blockReason: policy.reasons.join("; "),
      };
    }

    const quoteId = newId("quote");
    const expiresAt = Date.now() + 48 * 60 * 60 * 1000;

    db.prepare(
      `INSERT INTO quotes (id, rfq_id, line_items_json, total_paise, deposit_paise, spec_hash, pricebook_version, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      quoteId,
      rfqId,
      JSON.stringify(quote.lineItems),
      quote.totalPaise,
      quote.depositPaise,
      specHash,
      getPricebookVersion(),
      expiresAt,
      Date.now()
    );

    db.prepare(`UPDATE rfqs SET status = ? WHERE id = ?`).run(
      policy.requiresApproval ? "quoted" : "quoted",
      rfqId
    );

    logAudit(rfqId, "pricebook", "quote_generated", {
      quoteId,
      totalPaise: quote.totalPaise,
      depositPaise: quote.depositPaise,
      requiresApproval: policy.requiresApproval,
    });

    return { receipts, quoteId, blocked: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Quote failed";
    db.prepare(`UPDATE rfqs SET status = ? WHERE id = ?`).run("blocked", rfqId);
    logAudit(rfqId, "pricebook", "quote_blocked", { message });
    return { receipts, blocked: true, blockReason: message };
  }
}

export function getReceiptsForRfq(rfqId: string): CapabilityReceipt[] {
  return db
    .prepare(
      `SELECT receipt_json FROM capability_receipts WHERE rfq_id = ? ORDER BY created_at ASC`
    )
    .all(rfqId)
    .map((row) => JSON.parse((row as { receipt_json: string }).receipt_json) as CapabilityReceipt);
}
