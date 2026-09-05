"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatClock, formatInr, paiseFromRupeesInput, rupeesInputFromPaise } from "@/lib/inr";
import { readApiJson } from "@/lib/http";

type OfferItem = {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  source: string;
  costPaise?: number;
  listPaise?: number;
  targetPaise?: number;
  floorPaise?: number;
};

type Offer = {
  id: string;
  round: number;
  actor: "buyer" | "seller";
  status: string;
  totalPaise: number;
  depositPaise: number;
  explanation: string;
  createdAt: number;
  items: OfferItem[];
};

type Message = {
  id: string;
  actor: "buyer" | "seller" | "system";
  kind: string;
  body: string;
  offerId?: string;
  createdAt: number;
};

type Session = {
  id: string;
  status: string;
  currentRound: number;
  waitingFor: "buyer" | "seller" | null;
  buyerAgentId: string;
  deliveryDate?: string | null;
  acceptedOfferId?: string | null;
  policy?: {
    maxRounds: number;
    concessionBpsPerRound: number;
    depositBps: number;
  };
  offers: Offer[];
  messages: Message[];
  mandate?: { maxTotalPaise: number; maxDepositPaise: number | null };
  authority?: {
    products: Array<{
      id: string;
      sku: string;
      name: string;
      unit: string;
      costPaise: number;
      listPricePaise: number;
      targetPricePaise: number;
      floorPricePaise: number;
    }>;
  };
};

type ThreadItem =
  | { type: "offer"; at: number; offer: Offer }
  | { type: "chat"; at: number; message: Message };

function futureDate(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function AgentRoom({
  role,
  sessionId,
}: {
  role: "buyer" | "seller";
  sessionId: string;
}) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [targetRupees, setTargetRupees] = useState("");
  const [quantity, setQuantity] = useState("");

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/negotiations/${sessionId}?role=${role}`, {
      cache: "no-store",
    });
    const body = await readApiJson<Session & { error?: string }>(res);
    if (!res.ok) throw new Error(body.error ?? "Unable to load this agent room");
    setSession(body);
    setTargetRupees((current) => {
      if (current) return current;
      const lastSeller = [...body.offers].reverse().find((offer) => offer.actor === "seller");
      if (!lastSeller) return current;
      const suggested =
        role === "buyer" ? Math.round(lastSeller.totalPaise * 0.9) : lastSeller.totalPaise;
      return rupeesInputFromPaise(suggested);
    });
    setQuantity((current) => {
      if (current) return current;
      const lastSeller = [...body.offers].reverse().find((offer) => offer.actor === "seller");
      return lastSeller?.items[0] ? String(lastSeller.items[0].quantity) : current;
    });
    return body;
  }, [role, sessionId]);

  useEffect(() => {
    const stored = window.localStorage.getItem("speclock-theme");
    if (stored === "dark" || stored === "light") setTheme(stored);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        if (!cancelled) await refresh();
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Unable to load this agent room");
        }
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refresh]);

  const thread = useMemo<ThreadItem[]>(() => {
    if (!session) return [];
    const items: ThreadItem[] = [
      ...session.offers.map((offer) => ({ type: "offer" as const, at: offer.createdAt, offer })),
      ...session.messages.map((message) => ({ type: "chat" as const, at: message.createdAt, message })),
    ];
    return items.sort((a, b) => a.at - b.at);
  }, [session]);

  const lastSeller = [...(session?.offers ?? [])].reverse().find((offer) => offer.actor === "seller" && offer.status === "active");
  const waitingForSeller = session?.waitingFor === "seller";
  const mine = role === "buyer";

  async function sendChat() {
    if (!note.trim() || !session) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/negotiations/${session.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor: role, body: note.trim() }),
      });
      const body = await readApiJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? "Message failed");
      setNote("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Message failed");
    } finally {
      setBusy(false);
    }
  }

  async function sendBuyerOffer() {
    if (!session || !lastSeller) return;
    setBusy(true);
    setError(null);
    try {
      const targetTotalPaise = paiseFromRupeesInput(targetRupees);
      const qty = Number(quantity);
      const itemQuantities = Object.fromEntries(
        lastSeller.items.map((item) => [item.productId, Number.isFinite(qty) && qty > 0 ? qty : item.quantity])
      );
      const res = await fetch(`/api/negotiations/${session.id}/counter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentOfferId: lastSeller.id,
          targetTotalPaise,
          itemQuantities,
          deliveryDate: session.deliveryDate ?? futureDate(14),
          giveBacks: session.currentRound === 0 ? ["flexible_delivery"] : [],
          awaitSeller: true,
          note: note.trim() || undefined,
        }),
      });
      const body = await readApiJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? "Counter failed");
      setNote("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Counter failed");
    } finally {
      setBusy(false);
    }
  }

  async function acceptSeller() {
    if (!session || !lastSeller) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/negotiations/${session.id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerId: lastSeller.id }),
      });
      const body = await readApiJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? "Accept failed");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Accept failed");
    } finally {
      setBusy(false);
    }
  }

  async function runSellerPolicy() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/negotiations/${session.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      const body = await readApiJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? "Seller response failed");
      setNote("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Seller response failed");
    } finally {
      setBusy(false);
    }
  }

  const open = session?.status === "open";

  return (
    <div
      data-theme={theme}
      style={{
        minHeight: "100vh",
        background: "var(--stock)",
        color: "var(--ink)",
        fontFamily: "var(--font-ui)",
      }}
    >
      <header
        style={{
          height: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          background: "var(--sheet)",
          borderBottom: "1px solid var(--rule)",
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>
            {role === "buyer" ? "Buyer agent" : "Seller agent"}
          </div>
          <div style={{ fontFamily: "var(--font-code)", fontSize: 10.5, color: "var(--ink-3)" }}>
            {sessionId} · independent environment
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/" className="sl-btn sl-btn-chip" style={{ textDecoration: "none" }}>
            DESK
          </Link>
          <button
            type="button"
            className="sl-btn sl-btn-chip"
            onClick={() => {
              const next = theme === "dark" ? "light" : "dark";
              setTheme(next);
              window.localStorage.setItem("speclock-theme", next);
            }}
          >
            {theme === "dark" ? "DARK" : "LIGHT"}
          </button>
        </div>
      </header>

      <main style={{ width: "min(100% - 40px, 760px)", margin: "0 auto", padding: "28px 0 80px" }}>
        <div style={{ fontFamily: "var(--font-code)", fontSize: 11, letterSpacing: "0.14em", color: "var(--ink-3)" }}>
          {session?.status?.toUpperCase() ?? "LOADING"} · WAITING {session?.waitingFor?.toUpperCase() ?? "…"}
        </div>
        <h1 style={{ margin: "6px 0 0", fontSize: 26, fontWeight: 600, letterSpacing: "-0.03em" }}>
          {role === "buyer" ? "Your mandate stays private" : "Floors stay on this side"}
        </h1>
        {error && <p style={{ marginTop: 12, color: "var(--flag)", fontSize: 13 }}>{error}</p>}

        {role === "seller" && session?.authority && (
          <div style={{ marginTop: 18, background: "var(--sheet)", border: "1px solid var(--rule)", borderRadius: 14, padding: "14px 18px" }}>
            {session.authority.products.map((product) => (
              <div key={product.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--rule-soft)" }}>
                <span style={{ fontFamily: "var(--font-code)", fontSize: 11 }}>{product.sku}</span>
                <span style={{ fontFamily: "var(--font-code)", fontSize: 11.5 }}>
                  list {formatInr(product.listPricePaise)} · target {formatInr(product.targetPricePaise)} · floor {formatInr(product.floorPricePaise)} · cost {formatInr(product.costPaise)}
                </span>
              </div>
            ))}
          </div>
        )}
        {role === "buyer" && session?.mandate && (
          <div style={{ marginTop: 18, fontFamily: "var(--font-code)", fontSize: 12, color: "var(--ink-2)" }}>
            Ceiling {formatInr(session.mandate.maxTotalPaise)}
            {session.mandate.maxDepositPaise != null ? ` · deposit cap ${formatInr(session.mandate.maxDepositPaise)}` : ""}
          </div>
        )}

        <div className="sl-chat" style={{ marginTop: 22 }}>
          {thread.map((item) => {
            if (item.type === "chat") {
              const mineMsg = item.message.actor === role;
              return (
                <div
                  key={item.message.id}
                  style={{
                    alignSelf: mineMsg ? "flex-end" : "flex-start",
                    maxWidth: "80%",
                    background: mineMsg ? "var(--press-wash)" : "var(--sheet)",
                    border: "1px solid var(--rule)",
                    borderRadius: 14,
                    padding: "12px 14px",
                  }}
                >
                  <div style={{ fontFamily: "var(--font-code)", fontSize: 9.5, letterSpacing: "0.1em", color: "var(--ink-3)" }}>
                    {item.message.actor.toUpperCase()} · {formatClock(item.message.createdAt)}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 13.5 }}>{item.message.body}</div>
                </div>
              );
            }
            const offer = item.offer;
            const mineOffer = offer.actor === role;
            return (
              <div
                key={offer.id}
                style={{
                  alignSelf: mineOffer ? "flex-end" : "flex-start",
                  width: "min(100%, 520px)",
                  background: offer.status === "accepted" ? "var(--seal-wash)" : "var(--sheet)",
                  border: `1px solid ${offer.status === "accepted" ? "var(--seal)" : "var(--rule)"}`,
                  borderRadius: 14,
                  padding: "14px 16px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ fontFamily: "var(--font-code)", fontSize: 9.5, letterSpacing: "0.1em", color: offer.actor === "buyer" ? "var(--press)" : "var(--ink-3)" }}>
                    {offer.actor.toUpperCase()} R{offer.round} · {offer.status.toUpperCase()}
                  </span>
                  <span className="sl-nums" style={{ fontFamily: "var(--font-code)", fontSize: 13 }}>
                    {formatInr(offer.totalPaise)}
                  </span>
                </div>
                <div style={{ marginTop: 8, fontSize: 13, color: "var(--ink-2)" }}>{offer.explanation}</div>
                {offer.items.map((line) => (
                  <div key={`${offer.id}-${line.productId}`} style={{ marginTop: 8, fontFamily: "var(--font-code)", fontSize: 11.5 }}>
                    {line.sku} · {line.quantity.toLocaleString("en-IN")} @ {formatInr(line.unitPricePaise)}
                    {role === "seller" && line.floorPaise != null
                      ? ` · floor ${formatInr(line.floorPaise)}`
                      : ""}
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {open && (
          <div style={{ marginTop: 22, background: "var(--sheet)", border: "1px solid var(--rule)", borderRadius: 14, padding: 16 }}>
            {mine && lastSeller && session?.waitingFor === "buyer" && (
              <div className="sl-field-grid" style={{ marginBottom: 12 }}>
                <label>
                  <span className="sl-label">Target total ₹</span>
                  <input className="sl-input" value={targetRupees} onChange={(event) => setTargetRupees(event.target.value)} />
                </label>
                <label>
                  <span className="sl-label">Quantity</span>
                  <input className="sl-input" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
                </label>
              </div>
            )}
            <label>
              <span className="sl-label">Note to the other agent</span>
              <textarea className="sl-textarea" rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              <button type="button" className="sl-btn sl-btn-ghost" disabled={busy || !note.trim()} onClick={() => void sendChat()}>
                Send note
              </button>
              {mine && lastSeller && session?.waitingFor === "buyer" && (
                <>
                  <button type="button" className="sl-btn sl-btn-primary" disabled={busy} onClick={() => void sendBuyerOffer()}>
                    {busy ? "Sending…" : "Send counter"}
                  </button>
                  <button type="button" className="sl-btn sl-btn-ghost" disabled={busy} onClick={() => void acceptSeller()}>
                    Accept seller offer
                  </button>
                </>
              )}
              {role === "seller" && waitingForSeller && (
                <button type="button" className="sl-btn sl-btn-primary" disabled={busy} onClick={() => void runSellerPolicy()}>
                  {busy ? "Running policy…" : "Run price policy"}
                </button>
              )}
            </div>
          </div>
        )}
        {!open && session && (
          <p style={{ marginTop: 18, color: "var(--seal)", fontSize: 13.5 }}>
            Session {session.status}
            {session.acceptedOfferId ? " · mandates can be issued from checkout." : "."}
          </p>
        )}
      </main>
    </div>
  );
}
