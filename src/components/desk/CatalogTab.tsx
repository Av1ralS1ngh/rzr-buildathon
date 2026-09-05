"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { readApiJson } from "@/lib/http";
import { formatInr, paiseFromRupeesInput, rupeesInputFromPaise } from "@/lib/inr";

type Pricebook = {
  merchantId: string;
  version: string;
  setupPaise: number;
  materialBasePaise: number;
  printUnitPaise: number;
  petWhiteAddPaise: number;
  ppClearAddPaise: number;
  matteLaminationAddPaise: number;
  oilColdAddPaise: number;
  wastageBps: number;
  verificationPaise: number;
  marginBps: number;
  depositBps: number;
  minMoq: number;
};

type Sku = {
  id: string;
  sku: string;
  name: string;
  category: string;
  description: string;
  unit: string;
  costPaise: number;
  listPricePaise: number;
  targetPricePaise: number;
  floorPricePaise: number;
  minQuantity: number;
  maxQuantity: number;
  quantityStep: number;
  active: boolean;
};

type Policy = {
  id: string;
  version: number;
  maxRounds: number;
  offerTtlSeconds: number;
  concessionBpsPerRound: number;
  maxDiscountBps: number;
  minBundleMarginBps: number;
  depositBps: number;
};

const EMPTY_SKU = {
  sku: "",
  name: "",
  category: "labels",
  description: "",
  unit: "label",
  list: "60.00",
  target: "50.00",
  floor: "35.00",
  cost: "20.00",
  minQuantity: "500",
  maxQuantity: "250000",
  quantityStep: "100",
};

function Sheet({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ background: "var(--sheet)", border: "1px solid var(--rule)", borderRadius: 14, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "16px 20px",
          borderBottom: "1px solid var(--rule-soft)",
        }}
      >
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</span>
        {meta && (
          <span style={{ fontFamily: "var(--font-code)", fontSize: 10, letterSpacing: "0.1em", color: "var(--ink-4)" }}>
            {meta}
          </span>
        )}
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  );
}

export function CatalogTab() {
  const [pricebook, setPricebook] = useState<Pricebook | null>(null);
  const [skus, setSkus] = useState<Sku[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY_SKU);

  const load = useCallback(async () => {
    const [bookRes, catRes, polRes] = await Promise.all([
      fetch("/api/pricebook", { cache: "no-store" }),
      fetch("/api/catalog?view=merchant", { cache: "no-store" }),
      fetch("/api/seller-policy", { cache: "no-store" }),
    ]);
    const book = await readApiJson<Pricebook & { error?: string }>(bookRes);
    const cat = await readApiJson<{ products?: Sku[]; error?: string }>(catRes);
    const pol = await readApiJson<Policy & { error?: string }>(polRes);
    if (!bookRes.ok) throw new Error(book.error ?? "Unable to load pricebook");
    if (!catRes.ok) throw new Error(cat.error ?? "Unable to load catalog");
    if (!polRes.ok) throw new Error(pol.error ?? "Unable to load seller policy");
    setPricebook(book);
    setSkus(cat.products ?? []);
    setPolicy(pol);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Unable to load catalog");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function savePricebook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pricebook) return;
    const form = new FormData(event.currentTarget);
    setBusy("pricebook");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/pricebook", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setupPaise: paiseFromRupeesInput(String(form.get("setupPaise") ?? "")),
          materialBasePaise: Number(form.get("materialBasePaise")),
          printUnitPaise: Number(form.get("printUnitPaise")),
          petWhiteAddPaise: Number(form.get("petWhiteAddPaise")),
          ppClearAddPaise: Number(form.get("ppClearAddPaise")),
          matteLaminationAddPaise: Number(form.get("matteLaminationAddPaise")),
          oilColdAddPaise: Number(form.get("oilColdAddPaise")),
          wastageBps: Math.round(Number(form.get("wastagePct")) * 100),
          verificationPaise: paiseFromRupeesInput(String(form.get("verificationPaise") ?? "")),
          marginBps: Math.round(Number(form.get("marginPct")) * 100),
          depositBps: Math.round(Number(form.get("depositPct")) * 100),
          minMoq: Number(form.get("minMoq")),
        }),
      });
      const body = await readApiJson<Pricebook & { error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? "Pricebook save failed");
      setPricebook(body);
      setNotice(`Pricebook saved as ${body.version}. Flow quotes use this rate card immediately.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pricebook save failed");
    } finally {
      setBusy(null);
    }
  }

  async function saveSku(event: FormEvent) {
    event.preventDefault();
    setBusy("sku");
    setError(null);
    setNotice(null);
    try {
      const payload = {
        sku: draft.sku,
        name: draft.name,
        category: draft.category,
        description: draft.description,
        unit: draft.unit,
        listPricePaise: paiseFromRupeesInput(draft.list),
        targetPricePaise: paiseFromRupeesInput(draft.target),
        floorPricePaise: paiseFromRupeesInput(draft.floor),
        costPaise: paiseFromRupeesInput(draft.cost),
        minQuantity: Number(draft.minQuantity),
        maxQuantity: Number(draft.maxQuantity),
        quantityStep: Number(draft.quantityStep),
        active: true,
      };
      const res = await fetch(editingId ? `/api/catalog/${editingId}` : "/api/catalog", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await readApiJson<Sku & { error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? "SKU save failed");
      setEditingId(null);
      setDraft(EMPTY_SKU);
      await load();
      setNotice(editingId ? `Updated ${body.sku}.` : `Created ${body.sku}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "SKU save failed");
    } finally {
      setBusy(null);
    }
  }

  async function toggleSku(sku: Sku) {
    setError(null);
    const res = await fetch(`/api/catalog/${sku.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !sku.active }),
    });
    const body = await readApiJson<{ error?: string }>(res);
    if (!res.ok) {
      setError(body.error ?? "Unable to update SKU");
      return;
    }
    await load();
  }

  async function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("policy");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/seller-policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxRounds: Number(form.get("maxRounds")),
          offerTtlSeconds: Number(form.get("offerTtlSeconds")),
          concessionBpsPerRound: Number(form.get("concessionBpsPerRound")),
          maxDiscountBps: Number(form.get("maxDiscountBps")),
          minBundleMarginBps: Number(form.get("minBundleMarginBps")),
          depositBps: Number(form.get("depositBps")),
        }),
      });
      const body = await readApiJson<Policy & { error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? "Policy save failed");
      setPolicy(body);
      setNotice(`Seller policy v${body.version} is now active. New negotiations use it; open sessions keep their snapshot.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Policy save failed");
    } finally {
      setBusy(null);
    }
  }

  function editSku(sku: Sku) {
    setEditingId(sku.id);
    setDraft({
      sku: sku.sku,
      name: sku.name,
      category: sku.category,
      description: sku.description,
      unit: sku.unit,
      list: rupeesInputFromPaise(sku.listPricePaise),
      target: rupeesInputFromPaise(sku.targetPricePaise),
      floor: rupeesInputFromPaise(sku.floorPricePaise),
      cost: rupeesInputFromPaise(sku.costPaise),
      minQuantity: String(sku.minQuantity),
      maxQuantity: String(sku.maxQuantity),
      quantityStep: String(sku.quantityStep),
    });
  }

  return (
    <div style={{ width: "min(100% - 56px, 1040px)", margin: "0 auto", padding: "34px 0 120px" }}>
      <div style={{ fontFamily: "var(--font-code)", fontSize: 11, letterSpacing: "0.14em", color: "var(--ink-3)" }}>
        LIVE RATE CARD · NOT LLM
      </div>
      <h1 style={{ margin: "6px 0 0", fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em" }}>
        Pricebook and SKUs
      </h1>
      <p style={{ margin: "10px 0 0", maxWidth: 640, color: "var(--ink-2)", fontSize: 14 }}>
        Flow quotes custom jobs from this rate card. Negotiation rooms bargain against catalog SKUs. Changing a SKU here updates the database; the seed file is only the first insert.
      </p>
      {error && <p style={{ marginTop: 14, color: "var(--flag)", fontSize: 13 }}>{error}</p>}
      {notice && <p style={{ marginTop: 14, color: "var(--seal)", fontSize: 13 }}>{notice}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24 }}>
        {pricebook && (
          <Sheet title="Pricebook" meta={pricebook.version}>
            <form onSubmit={(event) => void savePricebook(event)}>
              <div className="sl-field-grid">
                {[
                  ["setupPaise", "Setup ₹", rupeesInputFromPaise(pricebook.setupPaise), "0.01"],
                  ["materialBasePaise", "Material base paise", String(pricebook.materialBasePaise), "1"],
                  ["printUnitPaise", "Print paise / unit", String(pricebook.printUnitPaise), "1"],
                  ["petWhiteAddPaise", "PET white add paise", String(pricebook.petWhiteAddPaise), "1"],
                  ["ppClearAddPaise", "PP clear add paise", String(pricebook.ppClearAddPaise), "1"],
                  ["matteLaminationAddPaise", "Matte lam add paise", String(pricebook.matteLaminationAddPaise), "1"],
                  ["oilColdAddPaise", "Oil + cold add paise", String(pricebook.oilColdAddPaise), "1"],
                  ["wastagePct", "Wastage %", (pricebook.wastageBps / 100).toFixed(2), "0.01"],
                  ["verificationPaise", "Verification ₹", rupeesInputFromPaise(pricebook.verificationPaise), "0.01"],
                  ["marginPct", "Margin %", (pricebook.marginBps / 100).toFixed(2), "0.01"],
                  ["depositPct", "Deposit %", (pricebook.depositBps / 100).toFixed(2), "0.01"],
                  ["minMoq", "MOQ units", String(pricebook.minMoq), "1"],
                ].map(([name, label, value, step]) => (
                  <label key={name}>
                    <span className="sl-label">{label}</span>
                    <input className="sl-input" name={name} defaultValue={value} step={step} required />
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                <button type="submit" className="sl-btn sl-btn-primary" disabled={busy === "pricebook"}>
                  {busy === "pricebook" ? "Saving…" : "Save rate card"}
                </button>
              </div>
            </form>
          </Sheet>
        )}

        <Sheet title="Catalog SKUs" meta={`${skus.length} PRODUCTS`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
            <div
              className="sl-sku-grid"
              style={{ fontFamily: "var(--font-code)", fontSize: 9.5, letterSpacing: "0.08em", color: "var(--ink-4)" }}
            >
              <span>SKU</span>
              <span>NAME</span>
              <span>LIST</span>
              <span>TARGET</span>
              <span>FLOOR</span>
              <span>COST</span>
              <span />
            </div>
            {skus.map((sku) => (
              <div
                key={sku.id}
                className="sl-sku-grid"
                style={{
                  padding: "10px 0",
                  borderBottom: "1px solid var(--rule-soft)",
                  opacity: sku.active ? 1 : 0.55,
                }}
              >
                <span style={{ fontFamily: "var(--font-code)", fontSize: 12 }}>{sku.sku}</span>
                <span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{sku.name}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)" }}>
                    {sku.category} · {sku.unit} · {sku.minQuantity.toLocaleString("en-IN")}–{sku.maxQuantity.toLocaleString("en-IN")}
                  </span>
                </span>
                <span className="sl-nums" style={{ fontFamily: "var(--font-code)", fontSize: 12 }}>{formatInr(sku.listPricePaise)}</span>
                <span className="sl-nums" style={{ fontFamily: "var(--font-code)", fontSize: 12 }}>{formatInr(sku.targetPricePaise)}</span>
                <span className="sl-nums" style={{ fontFamily: "var(--font-code)", fontSize: 12 }}>{formatInr(sku.floorPricePaise)}</span>
                <span className="sl-nums" style={{ fontFamily: "var(--font-code)", fontSize: 12 }}>{formatInr(sku.costPaise)}</span>
                <span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button type="button" className="sl-btn sl-btn-chip" onClick={() => editSku(sku)}>EDIT</button>
                  <button type="button" className="sl-btn sl-btn-chip" onClick={() => void toggleSku(sku)}>
                    {sku.active ? "OFF" : "ON"}
                  </button>
                </span>
              </div>
            ))}
          </div>
          <form onSubmit={(event) => void saveSku(event)} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="sl-field-grid">
              {(
                [
                  ["sku", "SKU", draft.sku],
                  ["name", "Name", draft.name],
                  ["category", "Category", draft.category],
                  ["unit", "Unit", draft.unit],
                  ["list", "List ₹", draft.list],
                  ["target", "Target ₹", draft.target],
                  ["floor", "Floor ₹", draft.floor],
                  ["cost", "Cost ₹", draft.cost],
                  ["minQuantity", "Min qty", draft.minQuantity],
                  ["maxQuantity", "Max qty", draft.maxQuantity],
                  ["quantityStep", "Step", draft.quantityStep],
                ] as const
              ).map(([key, label, value]) => (
                <label key={key}>
                  <span className="sl-label">{label}</span>
                  <input
                    className="sl-input"
                    value={value}
                    onChange={(event) => setDraft((cur) => ({ ...cur, [key]: event.target.value }))}
                    required
                  />
                </label>
              ))}
            </div>
            <label>
              <span className="sl-label">Description</span>
              <textarea
                className="sl-textarea"
                rows={2}
                value={draft.description}
                onChange={(event) => setDraft((cur) => ({ ...cur, description: event.target.value }))}
                required
              />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              {editingId && (
                <button
                  type="button"
                  className="sl-btn sl-btn-ghost"
                  onClick={() => {
                    setEditingId(null);
                    setDraft(EMPTY_SKU);
                  }}
                >
                  Cancel
                </button>
              )}
              <button type="submit" className="sl-btn sl-btn-primary" disabled={busy === "sku"}>
                {busy === "sku" ? "Saving…" : editingId ? "Update SKU" : "Add SKU"}
              </button>
            </div>
          </form>
        </Sheet>

        {policy && (
          <Sheet title="Seller negotiation policy" meta={`v${policy.version} · ${policy.id}`}>
            <form onSubmit={(event) => void savePolicy(event)}>
              <div className="sl-field-grid">
                {[
                  ["maxRounds", "Max rounds", String(policy.maxRounds)],
                  ["offerTtlSeconds", "Offer TTL seconds", String(policy.offerTtlSeconds)],
                  ["concessionBpsPerRound", "Concession bps / round", String(policy.concessionBpsPerRound)],
                  ["maxDiscountBps", "Max discount bps", String(policy.maxDiscountBps)],
                  ["minBundleMarginBps", "Min bundle margin bps", String(policy.minBundleMarginBps)],
                  ["depositBps", "Deposit bps", String(policy.depositBps)],
                ].map(([name, label, value]) => (
                  <label key={name}>
                    <span className="sl-label">{label}</span>
                    <input className="sl-input" name={name} defaultValue={value} required />
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                <button type="submit" className="sl-btn sl-btn-primary" disabled={busy === "policy"}>
                  {busy === "policy" ? "Saving…" : "Publish policy"}
                </button>
              </div>
            </form>
          </Sheet>
        )}
      </div>
    </div>
  );
}
