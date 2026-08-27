import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { orchestrateRfq } from "@/lib/orchestrator";
import { toLabelSpec } from "@/lib/rfq-parser";
import type { LabelSpec } from "@/lib/types";
import { logAudit } from "@/lib/audit";
import type { RfqRow } from "@/lib/db-types";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const rfq = db.prepare(`SELECT * FROM rfqs WHERE id = ?`).get(id) as RfqRow | undefined;
  if (!rfq) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const spec = toLabelSpec(
    JSON.parse(rfq.spec_json ?? "{}") as Partial<LabelSpec>
  );
  if (!spec) {
    return NextResponse.json(
      { error: "Specification incomplete — clarify RFQ first" },
      { status: 400 }
    );
  }

  db.prepare(`UPDATE rfqs SET status = ? WHERE id = ?`).run("orchestrating", id);
  logAudit(id, "buyer_agent", "orchestration_started", {});

  const result = await orchestrateRfq(id, spec, {
    filename: body.artworkFilename ?? "artwork.pdf",
    sizeBytes: body.artworkSizeBytes ?? 4096,
    hash: rfq.artwork_hash ?? undefined,
  });

  return NextResponse.json(result);
}
