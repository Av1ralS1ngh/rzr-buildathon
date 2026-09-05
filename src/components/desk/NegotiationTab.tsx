"use client";

import { useCallback, useEffect, useState } from "react";
import { readApiJson } from "@/lib/http";
import { formatInr } from "@/lib/inr";

type Offer = {
  id: string;
  round: number;
  actor: "buyer" | "seller";
  status: string;
  totalPaise: number;
  depositPaise: number;
  explanation: string;
  items: Array<{ unitPricePaise: number; quantity: number; sku: string }>;
};

type Bundle = {
  id: string;
  explanation: string;
  totalPaise: number;
  strategy: string;
  items?: Array<{ name: string; quantity: number; unitPricePaise: number; sku?: string }>;
  relevance?: number;
};

type Session = {
  id: string;
  status: string;
  currentRound: number;
  acceptedOfferId?: string | null;
  offers: Offer[];
};

const AUTHORITY = {
  list: "₹60.00",
  target: "₹50.00",
  floor: "₹35.00",
  cost: "₹20.00",
};

function futureDate(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function NegotiationTab() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authorityVisible, setAuthorityVisible] = useState(false);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [bundle, setBundle] = useState<string | null>(null);
  const [visibleRounds, setVisibleRounds] = useState(0);

  const refresh = useCallback(async (id: string) => {
    const res = await fetch(`/api/negotiations/${id}`, { cache: "no-store" });
    const body = await readApiJson<Session & { error?: string }>(res);
    if (!res.ok) throw new Error(body.error ?? "Unable to load negotiation");
    setSession(body);
    return body;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/negotiations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            merchantId: "merchant_abc_labels",
            buyerAgentId: "buyer_web_desk",
            maxBudgetPaise: 10_800_000,
            maxDepositPaise: 3_240_000,
            deliveryDate: futureDate(14),
            requirements: [
              {
                productId: "prod_pickle_label",
                minQuantity: 500,
                targetQuantity: 2000,
                maxQuantity: 3000,
                required: true,
                substitutionsAllowed: false,
                priority: 100,
              },
            ],
            crossSellPolicy: {
              allowed: true,
              maxAdditionalSpendPaise: 2_000_000,
              allowedProductIds: ["prod_roti_foil", "prod_meal_box"],
            },
            idempotencyKey: "desk-pickle-2000-v1",
          }),
        });
        const body = await readApiJson<Session & { error?: string }>(res);
        if (!res.ok) throw new Error(body.error ?? "Unable to open negotiation");
        if (cancelled) return;
        setSession(body);
        setVisibleRounds(0);
        const bundleRes = await fetch(`/api/negotiations/${body.id}/bundles`);
        const bundleBody = await readApiJson<{ bundles?: Bundle[]; error?: string }>(bundleRes);
        if (bundleRes.ok) setBundles(bundleBody.bundles ?? []);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Negotiation failed to start");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function advance() {
    if (!session || session.status !== "open" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const seller = [...session.offers].reverse().find((o) => o.actor === "seller" && o.status === "active");
      if (!seller) throw new Error("No active seller offer");
      const target = Math.max(7_000_000, Math.round(seller.totalPaise * 0.9));
      const res = await fetch(`/api/negotiations/${session.id}/counter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentOfferId: seller.id,
          targetTotalPaise: target,
          itemQuantities: { prod_pickle_label: 2000 },
          giveBacks: session.currentRound === 0 ? ["flexible_delivery"] : [],
        }),
      });
      const body = await readApiJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? "Counter failed");
      const next = await refresh(session.id);
      setVisibleRounds((r) => Math.min(r + 1, 3));
      if (next.status === "agreed") {
        const mandateRes = await fetch(`/api/negotiations/${session.id}/mandates`);
        void mandateRes;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Counter failed");
    } finally {
      setBusy(false);
    }
  }

  async function selectBundle(id: string) {
    if (!session) return;
    setBundle((cur) => (cur === id ? null : id));
    if (bundle === id) return;
    try {
      const res = await fetch(`/api/negotiations/${session.id}/bundles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundleId: id }),
      });
      const body = await readApiJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? "Bundle select failed");
      await refresh(session.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Bundle select failed");
    }
  }

  const av = authorityVisible;
  const maxRoundShown = visibleRounds;
  const offers = (session?.offers ?? []).filter((o) => o.round <= maxRoundShown);
  const agreed = session?.status === "agreed";

  return (
    <div style={{ width: "min(100% - 56px, 940px)", margin: "0 auto", padding: "34px 0 120px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
        <div>
          <div style={{ fontFamily: "var(--font-code)", fontSize: 11, letterSpacing: "0.14em", color: "var(--ink-3)" }}>
            SESSION {session?.id ?? "opening…"} · POLICY policy_abc_v1
          </div>
          <h1 style={{ margin: "6px 0 0", fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em" }}>
            Two agents, five rounds, one price
          </h1>
        </div>
        <button
          type="button"
          className="sl-btn sl-btn-chip"
          onClick={() => setAuthorityVisible((v) => !v)}
          style={{
            background: av ? "var(--sunken)" : "var(--sheet)",
            padding: "9px 12px",
            borderRadius: 8,
          }}
        >
          {av ? "MERCHANT VIEW" : "BUYER VIEW"}
        </button>
      </div>
      {error && <p style={{ marginTop: 14, color: "var(--flag)", fontSize: 13 }}>{error}</p>}
      <div style={{ marginTop: 24, background: "var(--sheet)", border: "1px solid var(--rule)", borderRadius: 14, overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--rule-soft)",
          }}
        >
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>Offer ledger · LBL-PICKLE-STD · 2,000 labels</span>
          <span style={{ fontFamily: "var(--font-code)", fontSize: 10, letterSpacing: "0.1em", color: "var(--ink-4)" }}>
            IMMUTABLE · TTL 30M
          </span>
        </div>
        <div style={{ padding: "6px 20px 18px" }}>
          {offers.map((o, i) => {
            const unit = o.items[0]?.unitPricePaise ?? Math.round(o.totalPaise / 2000);
            const side = `${o.actor.toUpperCase()} R${o.round}`;
            const ok = o.status === "accepted" || agreed;
            return (
              <div
                key={o.id}
                className="sl-offer-grid"
                style={{
                  alignItems: "baseline",
                  padding: "12px 0",
                  borderBottom: "1px solid var(--rule-soft)",
                  animation: `printLine 180ms linear ${i * 45}ms both`,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-code)",
                    fontSize: 9.5,
                    letterSpacing: "0.1em",
                    color: o.actor === "buyer" ? "var(--press)" : "var(--ink-3)",
                  }}
                >
                  {side}
                </span>
                <span style={{ fontSize: 12.5, color: "var(--ink-2)", textWrap: "pretty" }}>{o.explanation}</span>
                <span className="sl-nums" style={{ fontFamily: "var(--font-code)", fontSize: 12, textAlign: "right", color: "var(--ink-3)" }}>
                  {formatInr(unit)}
                </span>
                <span
                  className="sl-nums"
                  style={{
                    fontFamily: "var(--font-code)",
                    fontSize: 12.5,
                    textAlign: "right",
                    color: ok ? "var(--seal)" : "var(--ink)",
                  }}
                >
                  {formatInr(o.totalPaise)}
                </span>
              </div>
            );
          })}
          {agreed && (
            <div
              className="sl-offer-grid"
              style={{ alignItems: "baseline", padding: "12px 0", borderBottom: "1px solid var(--rule-soft)" }}
            >
              <span style={{ fontFamily: "var(--font-code)", fontSize: 9.5, letterSpacing: "0.1em", color: "var(--seal)" }}>
                SYSTEM
              </span>
              <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                Mandates signed ES256. Deposit 3,000 bps. Razorpay order created on checkout.
              </span>
              <span style={{ fontFamily: "var(--font-code)", fontSize: 12, textAlign: "right", color: "var(--ink-3)" }}>—</span>
              <span className="sl-nums" style={{ fontFamily: "var(--font-code)", fontSize: 12.5, textAlign: "right", color: "var(--seal)" }}>
                {session?.offers.find((o) => o.id === session.acceptedOfferId)
                  ? formatInr(Math.round(((session.offers.find((o) => o.id === session.acceptedOfferId)?.totalPaise ?? 0) * 3000) / 10_000))
                  : "—"}
              </span>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, marginTop: 16 }}>
            <span style={{ fontFamily: "var(--font-code)", fontSize: 10, letterSpacing: "0.08em", color: "var(--ink-3)" }}>
              ROUND {Math.min(5, (session?.currentRound ?? 0) + 1)} OF 5 · CONCESSION 750 BPS/ROUND · MAX 4500 BPS
            </span>
            <button
              type="button"
              className="sl-btn"
              disabled={busy || !session || agreed}
              onClick={advance}
              style={{
                border: 0,
                fontSize: 13.5,
                fontWeight: 600,
                color: agreed ? "var(--seal)" : "var(--press-on)",
                background: agreed ? "var(--seal-wash)" : "var(--press)",
                padding: "11px 18px",
                cursor: agreed ? "default" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {agreed ? "Agreed · mandates signed" : busy ? "Bargaining…" : "Advance round"}
            </button>
          </div>
        </div>
      </div>
      <div className="sl-split" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div style={{ background: "var(--sheet)", border: "1px solid var(--rule)", borderRadius: 14, overflow: "hidden" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "15px 18px",
              borderBottom: "1px solid var(--rule-soft)",
            }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>Seller authority</span>
            <span style={{ fontFamily: "var(--font-code)", fontSize: 9.5, letterSpacing: "0.1em", color: "var(--ink-4)" }}>
              {av ? "INTERNAL" : "REDACTED"}
            </span>
          </div>
          <div style={{ padding: "4px 18px 14px" }}>
            {[
              { k: "LIST PRICE", v: AUTHORITY.list, hide: false },
              { k: "TARGET", v: AUTHORITY.target, hide: true },
              { k: "ABSOLUTE FLOOR", v: AUTHORITY.floor, hide: true },
              { k: "UNIT COST", v: AUTHORITY.cost, hide: true },
              { k: "MIN BUNDLE MARGIN", v: "2,500 bps", hide: false },
              { k: "DEPOSIT", v: "3,000 bps", hide: false },
            ].map((a) => {
              const redacted = a.hide && !av;
              return (
                <div
                  key={a.k}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "9px 0",
                    borderBottom: "1px solid var(--rule-soft)",
                  }}
                >
                  <span style={{ fontFamily: "var(--font-code)", fontSize: 9.5, letterSpacing: "0.08em", color: "var(--ink-3)" }}>
                    {a.k}
                  </span>
                  <span
                    className="sl-nums"
                    style={{
                      fontFamily: "var(--font-code)",
                      fontSize: 12,
                      color: redacted ? "var(--ink-4)" : "var(--ink)",
                    }}
                  >
                    {redacted ? "₹••.••" : a.v}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ background: "var(--sheet)", border: "1px solid var(--rule)", borderRadius: 14, overflow: "hidden" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "15px 18px",
              borderBottom: "1px solid var(--rule-soft)",
            }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>Cross-sell bundles</span>
            <span style={{ fontFamily: "var(--font-code)", fontSize: 9.5, letterSpacing: "0.1em", color: "var(--press)" }}>
              PERMITTED
            </span>
          </div>
          <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
            {bundles.length === 0 && (
              <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                Bundles appear once the seller opens. Foil wraps and meal boxes attach only when cross-sell is permitted.
              </div>
            )}
            {bundles.map((b) => {
              const name = b.items?.[0]?.name ?? b.strategy;
              const qty = b.items?.[0]?.quantity;
              const listGuess = b.items?.reduce((s, i) => s + i.unitPricePaise * i.quantity, 0) ?? b.totalPaise;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => selectBundle(b.id)}
                  style={{
                    appearance: "none",
                    textAlign: "left",
                    fontFamily: "inherit",
                    color: "var(--ink)",
                    padding: "13px 14px",
                    border: `1px solid ${bundle === b.id ? "var(--press)" : "var(--rule)"}`,
                    background: bundle === b.id ? "var(--press-wash)" : "var(--sheet)",
                    borderRadius: 10,
                    cursor: "pointer",
                    transition: "background 120ms linear, border-color 120ms linear",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      {name}
                      {qty ? ` · ${qty.toLocaleString("en-IN")}` : ""}
                    </span>
                    <span style={{ fontFamily: "var(--font-code)", fontSize: 9.5, letterSpacing: "0.08em", color: "var(--ink-4)" }}>
                      {b.strategy.replaceAll("_", " ").toUpperCase()}
                    </span>
                  </span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--ink-3)", marginTop: 5, textWrap: "pretty" }}>
                    {b.explanation}
                  </span>
                  <span
                    className="sl-nums"
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      marginTop: 9,
                      fontFamily: "var(--font-code)",
                      fontSize: 11.5,
                    }}
                  >
                    {listGuess !== b.totalPaise && (
                      <span style={{ color: "var(--ink-4)", textDecoration: "line-through" }}>{formatInr(listGuess)}</span>
                    )}
                    <span style={{ fontWeight: 500, marginLeft: "auto" }}>{formatInr(b.totalPaise)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
