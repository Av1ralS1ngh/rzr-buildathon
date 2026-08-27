import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { orchestrateRfq } from "@/lib/orchestrator";
import { toLabelSpec } from "@/lib/rfq-parser";
import type { LabelSpec } from "@/lib/types";
import { logAudit } from "@/lib/audit";
import type { RfqRow } from "@/lib/db-types";
import type { RfqStatus } from "@/lib/types";
import { orchestrationSchema, validationMessage } from "@/lib/validation";

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

  if (
    !["draft", "needs_clarification", "quoted", "blocked"].includes(
      rfq.status as RfqStatus
    )
  ) {
    return NextResponse.json(
      { error: `Agent verification is not allowed while RFQ is '${rfq.status}'` },
      { status: 409 }
    );
  }

  const parsedBody = orchestrationSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: validationMessage(parsedBody.error) },
      { status: 400 }
    );
  }
  const spec = toLabelSpec(
    JSON.parse(rfq.spec_json ?? "{}") as Partial<LabelSpec>
  );
  if (!spec) {
    return NextResponse.json(
      { error: "Specification incomplete — clarify RFQ first" },
      { status: 400 }
    );
  }

  db.prepare(`UPDATE rfqs SET status = ?, updated_at = ? WHERE id = ?`).run(
    "orchestrating",
    Date.now(),
    id
  );
  logAudit(id, "buyer_agent", "orchestration_started", {});

  try {
    const body = parsedBody.data;
    const result = await orchestrateRfq(id, spec, {
      filename: rfq.artwork_name ?? body.artworkFilename ?? "artwork.pdf",
      sizeBytes: rfq.artwork_size ?? body.artworkSizeBytes ?? 0,
      mimeType: (rfq.artwork_mime ?? undefined) as
        | "application/pdf"
        | "image/png"
        | "image/jpeg"
        | undefined,
      hash: rfq.artwork_hash ?? undefined,
      fields: body.artworkFields,
    });
    return NextResponse.json(result, { status: result.blocked ? 422 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Verification failed";
    db.prepare(`UPDATE rfqs SET status = 'draft', updated_at = ? WHERE id = ?`).run(
      Date.now(),
      id
    );
    logAudit(id, "orchestrator", "orchestration_failed", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
