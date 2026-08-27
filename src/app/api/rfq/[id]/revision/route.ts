import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { toLabelSpec, mergeSpec } from "@/lib/rfq-parser";
import type { LabelSpec } from "@/lib/types";
import type { RfqRow } from "@/lib/db-types";
import { calculateQuote } from "@/lib/pricebook";
import { policyCheckRevision } from "@/lib/policy";
import { hashSpec } from "@/lib/commitment";
import { logAudit } from "@/lib/audit";

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

  if (rfq.status !== "locked" && rfq.status !== "deposit_paid") {
    return NextResponse.json(
      { error: "Revisions only after deposit on locked spec" },
      { status: 400 }
    );
  }

  const body = await req.json();
  const existing = JSON.parse(rfq.spec_json ?? "{}") as Partial<LabelSpec>;
  const merged = mergeSpec(existing, body.changes ?? {});
  const newSpec = toLabelSpec(merged);
  if (!newSpec) {
    return NextResponse.json({ error: "Invalid revision spec" }, { status: 400 });
  }

  const oldHash = hashSpec(JSON.parse(rfq.spec_json ?? "{}") as LabelSpec);
  const newHash = hashSpec(newSpec);
  if (oldHash === newHash) {
    return NextResponse.json({ error: "No material spec change" }, { status: 400 });
  }

  const oldQuote = calculateQuote(JSON.parse(rfq.spec_json ?? "{}") as LabelSpec);
  const newQuote = calculateQuote(newSpec);
  const deltaPaise = newQuote.totalPaise - oldQuote.totalPaise;

  const revisionPolicy = policyCheckRevision(deltaPaise);

  logAudit(rfqId, "buyer_agent", "revision_proposed", {
    deltaPaise,
    oldHash,
    newHash,
    requiresHumanApproval: revisionPolicy.requiresHumanApproval,
  });

  db.prepare(`UPDATE rfqs SET spec_json = ?, status = ? WHERE id = ?`).run(
    JSON.stringify(merged),
    "revision_proposed",
    rfqId
  );

  return NextResponse.json({
    deltaPaise,
    requiresHumanApproval: revisionPolicy.requiresHumanApproval,
    oldTotalPaise: oldQuote.totalPaise,
    newTotalPaise: newQuote.totalPaise,
    newSpec: merged,
  });
}
