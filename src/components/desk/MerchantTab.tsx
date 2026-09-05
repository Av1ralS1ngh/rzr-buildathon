"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { readApiJson } from "@/lib/http";
import { formatInr } from "@/lib/inr";

type MerchantRfq = {
  id: string;
  status: string;
  raw_text: string;
  created_at: number;
  total_paise?: number;
  deposit_paise?: number;
  commitment_status?: string;
};

function chip(status: string) {
  if (status === "locked") return { bg: "var(--seal-wash)", fg: "var(--seal)" };
  if (status === "quoted" || status === "payment_pending") return { bg: "var(--press-wash)", fg: "var(--press)" };
  return { bg: "var(--flag-wash)", fg: "var(--flag)" };
}

export function MerchantTab({ onOpenRfq }: { onOpenRfq?: (id: string) => void }) {
  const [rfqs, setRfqs] = useState<MerchantRfq[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stamped, setStamped] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/merchant/rfqs", { cache: "no-store" });
      const body = await readApiJson<{ rfqs?: MerchantRfq[]; error?: string }>(response);
      if (!response.ok) throw new Error(body.error ?? "Unable to load RFQs");
      setRfqs(body.rfqs ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load RFQs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(id: string) {
    setError(null);
    const response = await fetch(`/api/rfq/${id}/approve`, { method: "POST" });
    const body = await readApiJson<{ error?: string }>(response);
    if (!response.ok) {
      setError(body.error ?? "Approval failed");
      return;
    }
    setStamped((s) => [...s, id]);
    await load();
  }

  const stats = useMemo(() => {
    const captured = rfqs
      .filter((r) => r.status === "locked" || r.commitment_status === "locked")
      .reduce((sum, r) => sum + (r.deposit_paise ?? 0), 0);
    const open = rfqs
      .filter((r) => r.status !== "locked" && r.status !== "cancelled")
      .reduce((sum, r) => sum + (r.deposit_paise ?? 0), 0);
    const needs = rfqs.filter((r) => r.status === "awaiting_approval" || r.status === "revision_proposed").length;
    return [
      { k: "OPEN DEPOSITS", v: formatInr(open), note: "Awaiting capture across open jobs", fg: "var(--ink)" },
      { k: "CAPTURED TODAY", v: formatInr(captured), note: "Plates locked to a spec hash", fg: "var(--seal)" },
      { k: "NEEDS YOU", v: String(needs), note: "Over the ₹50,000.00 threshold, or a revision", fg: "var(--flag)" },
    ];
  }, [rfqs]);

  return (
    <div style={{ width: "min(100% - 56px, 1040px)", margin: "0 auto", padding: "34px 0 120px" }}>
      <div style={{ fontFamily: "var(--font-code)", fontSize: 11, letterSpacing: "0.14em", color: "var(--ink-3)" }}>
        FACTORY QUEUE
      </div>
      <h1 style={{ margin: "6px 0 0", fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em" }}>
        {rfqs.length === 0 ? "No jobs on the floor" : `${rfqs.length} job${rfqs.length === 1 ? "" : "s"} on the floor`}
      </h1>
      {error && <p style={{ marginTop: 12, color: "var(--flag)", fontSize: 13 }}>{error}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 24 }} className="sl-split">
        {stats.map((m) => (
          <div key={m.k} style={{ background: "var(--sheet)", border: "1px solid var(--rule)", borderRadius: 12, padding: "16px 18px" }}>
            <div style={{ fontFamily: "var(--font-code)", fontSize: 10, letterSpacing: "0.13em", color: "var(--ink-3)" }}>{m.k}</div>
            <div
              className="sl-nums"
              style={{
                fontFamily: "var(--font-code)",
                fontSize: 24,
                fontWeight: 500,
                letterSpacing: "-0.03em",
                marginTop: 8,
                color: m.fg,
              }}
            >
              {m.v}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 5, textWrap: "pretty" }}>{m.note}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, background: "var(--sheet)", border: "1px solid var(--rule)", borderRadius: 14, overflow: "hidden" }}>
        <div
          className="sl-merchant-grid"
          style={{
            padding: "12px 20px",
            borderBottom: "1px solid var(--rule)",
            background: "var(--sunken)",
            fontFamily: "var(--font-code)",
            fontSize: 9.5,
            letterSpacing: "0.13em",
            color: "var(--ink-3)",
          }}
        >
          <span>RFQ</span>
          <span>STATUS</span>
          <span style={{ textAlign: "right" }}>QUOTE</span>
          <span style={{ textAlign: "right" }}>DEPOSIT</span>
          <span style={{ textAlign: "right" }}>ACTION</span>
        </div>
        {loading && (
          <div style={{ padding: 20, fontSize: 13, color: "var(--ink-3)" }}>Loading the factory queue…</div>
        )}
        {!loading && rfqs.length === 0 && (
          <div style={{ padding: 20, fontSize: 13, color: "var(--ink-3)" }}>
            Raise a job on Flow and it will land here with its quote and deposit.
          </div>
        )}
        {rfqs.map((r) => {
          const status = r.status;
          const colors = chip(status);
          const done = stamped.includes(r.id);
          const canApprove = status === "awaiting_approval" || status === "revision_proposed";
          return (
            <div
              key={r.id}
              className="sl-merchant-grid"
              style={{ alignItems: "center", padding: "15px 20px", borderBottom: "1px solid var(--rule-soft)" }}
            >
              <div style={{ minWidth: 0 }}>
                <button
                  type="button"
                  onClick={() => onOpenRfq?.(r.id)}
                  style={{
                    appearance: "none",
                    border: 0,
                    background: "none",
                    padding: 0,
                    fontFamily: "var(--font-code)",
                    fontSize: 12,
                    fontWeight: 500,
                    color: "var(--press)",
                    cursor: "pointer",
                  }}
                >
                  {r.id}
                </button>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.raw_text}
                </div>
              </div>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "4px 9px",
                  borderRadius: 6,
                  justifySelf: "start",
                  background: colors.bg,
                  color: colors.fg,
                  fontFamily: "var(--font-code)",
                  fontSize: 9.5,
                  letterSpacing: "0.1em",
                  animation: done ? "stampIn 240ms var(--ease) both" : "none",
                }}
              >
                <span style={{ width: 5, height: 5, borderRadius: 3, background: "currentColor" }} />
                {status.toUpperCase()}
              </span>
              <span className="sl-nums" style={{ textAlign: "right", fontFamily: "var(--font-code)", fontSize: 12.5 }}>
                {r.total_paise != null ? formatInr(r.total_paise) : "—"}
              </span>
              <span className="sl-nums" style={{ textAlign: "right", fontFamily: "var(--font-code)", fontSize: 12.5, color: "var(--ink-3)" }}>
                {r.deposit_paise != null ? formatInr(r.deposit_paise) : "—"}
              </span>
              <span style={{ textAlign: "right" }}>
                {canApprove && (
                  <button
                    type="button"
                    className="sl-btn sl-btn-ghost"
                    onClick={() => approve(r.id)}
                    style={{
                      borderColor: "var(--rule-strong)",
                      color: "var(--ink)",
                      fontSize: 12.5,
                      padding: "7px 13px",
                      borderRadius: 8,
                    }}
                  >
                    Approve
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
