"use client";

const WIRE = [
  { line: "→ POST /api/capabilities/label-rules", fg: "#7FA9FF" },
  { line: "← 402 Payment Required", fg: "rgba(255,255,255,.92)" },
  { line: "  PAYMENT-REQUIRED: x402/2; amount=12000; asset=INR-test", fg: "rgba(255,255,255,.62)" },
  { line: "→ PAYMENT-SIGNATURE: eyJhbGciOiJFUzI1NiJ9…", fg: "#7FA9FF" },
  { line: "  // presence alone is never trusted — verify, then settle", fg: "rgba(255,255,255,.45)" },
  { line: "← 200 OK  PAYMENT-RESPONSE: settled", fg: "#4FD1A5" },
  { line: '  { status: "pass", receiptId: "rcpt_rules_4b81c0d7" }', fg: "rgba(255,255,255,.8)" },
];

const PROTOCOLS = [
  { name: "A2A 1.0", path: "/.well-known/agent-card.json" },
  { name: "UCP 2026-04-08", path: "/ucp/v1/checkout-sessions/*" },
  { name: "AP2 COMPAT", path: "/api/ap2/mandates/:sessionId" },
  { name: "ACP 2026-04-17", path: "/checkout_sessions/*" },
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

export function AgentMeshTab() {
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
