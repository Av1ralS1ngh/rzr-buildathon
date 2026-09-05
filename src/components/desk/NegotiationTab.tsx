"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { readApiJson } from "@/lib/http";
import { formatInr, paiseFromRupeesInput } from "@/lib/inr";

type PublicProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  description: string;
  unit: string;
  listPricePaise: number;
  minQuantity: number;
  maxQuantity: number;
  quantityStep: number;
};

type MerchantProduct = PublicProduct & {
  costPaise: number;
  targetPricePaise: number;
  floorPricePaise: number;
  active?: boolean;
};

type Offer = {
  id: string;
  round: number;
  actor: "buyer" | "seller";
  status: string;
  totalPaise: number;
  depositPaise: number;
  explanation: string;
  items: Array<{ unitPricePaise: number; quantity: number; sku: string; productId: string }>;
};

type Bundle = {
  id: string;
  explanation: string;
  totalPaise: number;
  strategy: string;
  items?: Array<{ name: string; quantity: number; unitPricePaise: number; sku?: string }>;
};

type Session = {
  id: string;
  status: string;
  currentRound: number;
  waitingFor?: "buyer" | "seller" | null;
  acceptedOfferId?: string | null;
  policy?: {
    maxRounds: number;
    concessionBpsPerRound: number;
    maxDiscountBps: number;
    minBundleMarginBps: number;
    depositBps: number;
  };
  offers: Offer[];
};

function futureDate(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function NegotiationTab() {
  const [products, setProducts] = useState<MerchantProduct[]>([]);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("2000");
  const [budget, setBudget] = useState("108000.00");
  const [crossSell, setCrossSell] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authorityVisible, setAuthorityVisible] = useState(false);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [bundle, setBundle] = useState<string | null>(null);

  const selected = products.find((product) => product.id === productId) ?? products[0];

  const loadCatalog = useCallback(async () => {
    const res = await fetch("/api/catalog?view=merchant", { cache: "no-store" });
    const body = await readApiJson<{ products?: MerchantProduct[]; error?: string }>(res);
    if (!res.ok) throw new Error(body.error ?? "Unable to load catalog");
    const next = (body.products ?? []).filter((product) => product.active !== false);
    setProducts(next);
    setProductId((current) => current || next[0]?.id || "");
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCatalog().catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Unable to load catalog");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCatalog]);

  const refresh = useCallback(async (id: string) => {
    const res = await fetch(`/api/negotiations/${id}?role=seller`, { cache: "no-store" });
    const body = await readApiJson<Session & { error?: string }>(res);
    if (!res.ok) throw new Error(body.error ?? "Unable to load negotiation");
    setSession(body);
    return body;
  }, []);

  async function startSession() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const qty = Math.min(
        selected.maxQuantity,
        Math.max(selected.minQuantity, Number(quantity) || selected.minQuantity)
      );
      const maxBudgetPaise = paiseFromRupeesInput(budget);
      const others = products.filter((product) => product.id !== selected.id).map((product) => product.id);
      const res = await fetch("/api/negotiations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId: "merchant_abc_labels",
          buyerAgentId: "buyer_web_desk",
          maxBudgetPaise,
          maxDepositPaise: Math.round(maxBudgetPaise * 0.3),
          deliveryDate: futureDate(14),
          requirements: [
            {
              productId: selected.id,
              minQuantity: selected.minQuantity,
              targetQuantity: qty,
              maxQuantity: selected.maxQuantity,
              required: true,
              substitutionsAllowed: false,
              priority: 100,
            },
          ],
          crossSellPolicy: {
            allowed: crossSell,
            maxAdditionalSpendPaise: Math.round(maxBudgetPaise * 0.2),
            allowedProductIds: others,
          },
          idempotencyKey: `desk-${selected.id}-${qty}-${Date.now()}`,
        }),
      });
      const body = await readApiJson<Session & { error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? "Unable to open negotiation");
      setSession(body);
      const bundleRes = await fetch(`/api/negotiations/${body.id}/bundles`);
      const bundleBody = await readApiJson<{ bundles?: Bundle[]; error?: string }>(bundleRes);
      if (bundleRes.ok) setBundles(bundleBody.bundles ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Negotiation failed to start");
    } finally {
      setBusy(false);
    }
  }

  function openRooms() {
    if (!session) return;
    window.open(`/agent/buyer/${session.id}`, "speclock-buyer", "noopener,noreferrer");
    window.open(`/agent/seller/${session.id}`, "speclock-seller", "noopener,noreferrer");
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
  const offers = session?.offers ?? [];
  const agreed = session?.status === "agreed";
  const unitHint = selected ? formatInr(selected.listPricePaise) : "—";

  const authorityRows = useMemo(() => {
    if (!selected) return [];
    return [
      { k: "LIST PRICE", v: formatInr(selected.listPricePaise), hide: false },
      { k: "TARGET", v: formatInr(selected.targetPricePaise), hide: true },
      { k: "ABSOLUTE FLOOR", v: formatInr(selected.floorPricePaise), hide: true },
      { k: "UNIT COST", v: formatInr(selected.costPaise), hide: true },
      { k: "MIN BUNDLE MARGIN", v: `${session?.policy?.minBundleMarginBps ?? 2500} bps`, hide: false },
      { k: "DEPOSIT", v: `${session?.policy?.depositBps ?? 3000} bps`, hide: false },
    ];
  }, [selected, session]);

  return (
    <div style={{ width: "min(100% - 56px, 940px)", margin: "0 auto", padding: "34px 0 120px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
        <div>
          <div style={{ fontFamily: "var(--font-code)", fontSize: 11, letterSpacing: "0.14em", color: "var(--ink-3)" }}>
            {session ? `SESSION ${session.id}` : "NO SESSION"} · ANY SKU
          </div>
          <h1 style={{ margin: "6px 0 0", fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em" }}>
            Two agents, separate rooms
          </h1>
        </div>
        {session && (
          <button
            type="button"
            className="sl-btn sl-btn-chip"
            onClick={() => setAuthorityVisible((v) => !v)}
            style={{ background: av ? "var(--sunken)" : "var(--sheet)", padding: "9px 12px", borderRadius: 8 }}
          >
            {av ? "MERCHANT VIEW" : "BUYER VIEW"}
          </button>
        )}
      </div>
      {error && <p style={{ marginTop: 14, color: "var(--flag)", fontSize: 13 }}>{error}</p>}

      <div style={{ marginTop: 24, background: "var(--sheet)", border: "1px solid var(--rule)", borderRadius: 14, padding: 20 }}>
        <div className="sl-field-grid">
          <label>
            <span className="sl-label">SKU</span>
            <select className="sl-select" value={productId} onChange={(event) => setProductId(event.target.value)}>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.sku} · {product.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sl-label">Quantity</span>
            <input className="sl-input" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          </label>
          <label>
            <span className="sl-label">Buyer ceiling ₹</span>
            <input className="sl-input" value={budget} onChange={(event) => setBudget(event.target.value)} />
          </label>
        </div>
        <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>
          {selected
            ? `${selected.name}. List ${unitHint} / ${selected.unit}. Qty ${selected.minQuantity.toLocaleString("en-IN")}–${selected.maxQuantity.toLocaleString("en-IN")}.`
            : "Load a SKU from Catalog first."}
        </p>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 13 }}>
          <input type="checkbox" checked={crossSell} onChange={(event) => setCrossSell(event.target.checked)} />
          Permit cross-sell of other catalog SKUs
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
          <button type="button" className="sl-btn sl-btn-primary" disabled={busy || !selected} onClick={() => void startSession()}>
            {busy ? "Opening…" : "Start negotiation"}
          </button>
          <button type="button" className="sl-btn sl-btn-ghost" disabled={!session} onClick={openRooms}>
            Open buyer + seller rooms
          </button>
        </div>
      </div>

      {session && (
        <div style={{ marginTop: 12, background: "var(--sheet)", border: "1px solid var(--rule)", borderRadius: 14, overflow: "hidden" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px 20px",
              borderBottom: "1px solid var(--rule-soft)",
            }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>
              Offer ledger · {selected?.sku ?? "SKU"} · {Number(quantity).toLocaleString("en-IN")} {selected?.unit ?? "units"}
            </span>
            <span style={{ fontFamily: "var(--font-code)", fontSize: 10, letterSpacing: "0.1em", color: "var(--ink-4)" }}>
              {session.waitingFor ? `WAITING ${session.waitingFor.toUpperCase()}` : session.status.toUpperCase()}
            </span>
          </div>
          <div style={{ padding: "6px 20px 18px" }}>
            {offers.map((o, i) => {
              const unit = o.items[0]?.unitPricePaise ?? 0;
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
                    {o.actor.toUpperCase()} R{o.round}
                  </span>
                  <span style={{ fontSize: 12.5, color: "var(--ink-2)", textWrap: "pretty" }}>{o.explanation}</span>
                  <span className="sl-nums" style={{ fontFamily: "var(--font-code)", fontSize: 12, textAlign: "right", color: "var(--ink-3)" }}>
                    {formatInr(unit)}
                  </span>
                  <span className="sl-nums" style={{ fontFamily: "var(--font-code)", fontSize: 12.5, textAlign: "right", color: o.status === "accepted" || agreed ? "var(--seal)" : "var(--ink)" }}>
                    {formatInr(o.totalPaise)}
                  </span>
                </div>
              );
            })}
            <p style={{ margin: "14px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>
              Bargaining happens in the two agent rooms. This ledger is the shared record. LLM still cannot authorize a price.
            </p>
          </div>
        </div>
      )}

      {session && (
        <div className="sl-split" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <div style={{ background: "var(--sheet)", border: "1px solid var(--rule)", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 18px", borderBottom: "1px solid var(--rule-soft)" }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>Seller authority</span>
              <span style={{ fontFamily: "var(--font-code)", fontSize: 9.5, letterSpacing: "0.1em", color: "var(--ink-4)" }}>
                {av ? "INTERNAL" : "REDACTED"}
              </span>
            </div>
            <div style={{ padding: "4px 18px 14px" }}>
              {authorityRows.map((a) => {
                const redacted = a.hide && !av;
                return (
                  <div key={a.k} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--rule-soft)" }}>
                    <span style={{ fontFamily: "var(--font-code)", fontSize: 9.5, letterSpacing: "0.08em", color: "var(--ink-3)" }}>{a.k}</span>
                    <span className="sl-nums" style={{ fontFamily: "var(--font-code)", fontSize: 12, color: redacted ? "var(--ink-4)" : "var(--ink)" }}>
                      {redacted ? "₹••.••" : a.v}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ background: "var(--sheet)", border: "1px solid var(--rule)", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 18px", borderBottom: "1px solid var(--rule-soft)" }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>Cross-sell bundles</span>
              <span style={{ fontFamily: "var(--font-code)", fontSize: 9.5, letterSpacing: "0.1em", color: "var(--press)" }}>
                {crossSell ? "PERMITTED" : "OFF"}
              </span>
            </div>
            <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
              {bundles.length === 0 && (
                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                  Bundles appear after the session opens, and only if other SKUs exist as complements.
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
                    onClick={() => void selectBundle(b.id)}
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
                    <span style={{ display: "block", fontSize: 12, color: "var(--ink-3)", marginTop: 5 }}>{b.explanation}</span>
                    <span className="sl-nums" style={{ display: "flex", marginTop: 9, fontFamily: "var(--font-code)", fontSize: 11.5 }}>
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
      )}
    </div>
  );
}
