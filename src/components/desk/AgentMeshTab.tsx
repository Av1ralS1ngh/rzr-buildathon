"use client";

import { useEffect, useState } from "react";

const WIRE = [
  { line: "→ POST /api/capabilities/label-rules", fg: "#7FA9FF" },
  { line: "← 402 Payment Required", fg: "rgba(255,255,255,.92)" },
  { line: "  PAYMENT-REQUIRED: x402/2; scheme=exact; network=eip155:84532", fg: "rgba(255,255,255,.62)" },
  { line: "→ PAYMENT-SIGNATURE: <x402 v2 payload>", fg: "#7FA9FF" },
  { line: "  // presence alone is never trusted — facilitator verify, then settle", fg: "rgba(255,255,255,.45)" },
  { line: "← 200 OK  PAYMENT-RESPONSE: settled", fg: "#4FD1A5" },
];

const PROTOCOLS = [
  { name: "A2A 1.0", path: "/.well-known/agent-card.json" },
  { name: "UCP 2026-04-08", path: "/ucp/v1/checkout-sessions/*" },
  { name: "AP2 COMPAT", path: "/api/ap2/mandates/:sessionId" },
  { name: "ACP 2026-04-17", path: "/checkout_sessions/*" },
  { name: "TELEGRAM", path: "/api/telegram/webhook" },
  { name: "RAZORPAY", path: "/api/razorpay/webhook" },
  { name: "x402", path: "/api/capabilities/*" },
];

const MANDATES = [
  { name: "mandate.checkout.open.1", open: true },
  { name: "mandate.payment.open.1", open: true },
  { name: "speclock.seller-authority.1", muted: true },
  { name: "mandate.checkout.1", signed: true },
  { name: "mandate.payment.1", signed: true },
  { name: "speclock.payment-receipt.1", signed: true },
];

type MeshStatus = {
  x402: {
    facilitatorUrl: string;
    network: string;
    payTo: string | null;
    settlementReady: boolean;
    supported: boolean;
    error?: string;
  };
  parser: { llm: boolean; fallback: string };
  labelRules: { pack: string };
  printCheck: { localEngine: string; enfocus: boolean };
  telegram?: { inbound: boolean };
};

export function AgentMeshTab() {
  const [status, setStatus] = useState<MeshStatus | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch("/api/x402/status")
        .then((res) => res.json())
        .then((body: MeshStatus) => setStatus(body))
        .catch(() => setStatus(null));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div style={{ width: "min(100% - 56px, 940px)", margin: "0 auto", padding: "34px 0 120px" }}>
      <div style={{ fontFamily: "var(--font-code)", fontSize: 11, letterSpacing: "0.14em", color: "var(--ink-3)" }}>
        MACHINE SURFACE
      </div>
      <h1 style={{ margin: "6px 0 0", fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em" }}>
        The buyer never sees any of this
      </h1>
      <div style={{ marginTop: 24, background: "var(--terminal)", border: "1px solid var(--rule)", borderRadius: 14, overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 20px",
            borderBottom: "1px solid rgba(255,255,255,.1)",
          }}
        >
          <span style={{ color: "#FFFFFF", fontSize: 13, fontWeight: 600 }}>POST /api/capabilities/label-rules</span>
          <span style={{ fontFamily: "var(--font-code)", fontSize: 10.5, color: "#7FA9FF" }}>402 PAYMENT REQUIRED</span>
        </div>
        <div style={{ padding: "15px 20px", fontFamily: "var(--font-code)", fontSize: 11.5, lineHeight: 1.9 }}>
          {WIRE.map((w) => (
            <div key={w.line} style={{ color: w.fg }}>
              {w.line}
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          marginTop: 12,
          background: "var(--sheet)",
          border: "1px solid var(--rule)",
          borderRadius: 14,
          padding: "16px 18px",
        }}
      >
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>Live capability rails</div>
        <div
          style={{
            marginTop: 12,
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 10,
            fontFamily: "var(--font-code)",
            fontSize: 11,
          }}
          className="sl-split"
        >
          <StatusLine
            label="x402 facilitator"
            value={status?.x402?.facilitatorUrl?.replace("https://", "") ?? "checking…"}
            ok={status?.x402?.supported}
          />
          <StatusLine
            label="x402 payTo"
            value={
              status?.x402?.settlementReady
                ? `${status.x402.payTo?.slice(0, 6)}…${status.x402.payTo?.slice(-4)}`
                : "set X402_PAY_TO to settle"
            }
            ok={status?.x402?.settlementReady}
          />
          <StatusLine
            label="RFQ parser"
            value={status?.parser.llm ? "LLM + Zod" : "rules + Zod fallback"}
            ok
          />
          <StatusLine label="Label rules" value={status?.labelRules.pack ?? "statute pack"} ok />
          <StatusLine
            label="Print preflight"
            value={
              status?.printCheck.enfocus
                ? "Enfocus PitStop + local"
                : "local PDF/PNG/JPEG inspector"
            }
            ok
          />
          <StatusLine
            label="Network"
            value={status?.x402?.network ?? "eip155:84532"}
            ok={status?.x402?.supported}
          />
          <StatusLine
            label="Telegram inbox"
            value={status?.telegram?.inbound ? "webhook armed" : "create a bot, paste token"}
            ok={status?.telegram?.inbound}
          />
        </div>
        {status?.x402?.error && (
          <div style={{ marginTop: 10, color: "var(--flag)", fontSize: 12.5 }}>{status.x402.error}</div>
        )}
      </div>
      <div className="sl-split" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div style={{ background: "var(--sheet)", border: "1px solid var(--rule)", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "15px 18px", borderBottom: "1px solid var(--rule-soft)", fontSize: 13.5, fontWeight: 600 }}>
            Protocol surfaces
          </div>
          <div style={{ padding: "4px 18px 14px" }}>
            {PROTOCOLS.map((p) => (
              <div
                key={p.name}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 0",
                  borderBottom: "1px solid var(--rule-soft)",
                }}
              >
                <span style={{ fontFamily: "var(--font-code)", fontSize: 11, fontWeight: 500 }}>{p.name}</span>
                <span style={{ fontFamily: "var(--font-code)", fontSize: 10.5, color: "var(--ink-3)", textAlign: "right" }}>
                  {p.path}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ background: "var(--sheet)", border: "1px solid var(--rule)", borderRadius: 14, overflow: "hidden" }}>
          <div
            style={{
              padding: "15px 18px",
              borderBottom: "1px solid var(--rule-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>Mandate chain</span>
            <span style={{ fontFamily: "var(--font-code)", fontSize: 9.5, letterSpacing: "0.1em", color: "var(--ink-4)" }}>
              ES256 JWS
            </span>
          </div>
          <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
            {MANDATES.map((m) => (
              <div
                key={m.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontFamily: "var(--font-code)",
                  fontSize: 11,
                  color: m.muted ? "var(--ink-3)" : "var(--ink)",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 4,
                    background: m.signed ? "var(--seal)" : m.open ? "var(--press)" : "var(--ink-4)",
                  }}
                />
                {m.name}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusLine({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ color: "var(--ink-4)", letterSpacing: "0.08em", fontSize: 9.5 }}>{label.toUpperCase()}</span>
      <span style={{ color: ok === false ? "var(--flag)" : "var(--ink)" }}>{value}</span>
    </div>
  );
}
