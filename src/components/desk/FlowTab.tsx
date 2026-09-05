"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import { parseRfqText } from "@/lib/rfq-parser";
import { readApiJson } from "@/lib/http";
import { formatClock, formatInr, shortenHash } from "@/lib/inr";
import type { LabelSpec } from "@/lib/types";
import { CAPABILITY_FEES, stepFromStatus, type RfqDetail } from "./rfq-types";

const SAMPLE =
  "I need 10,000 waterproof mango pickle jar labels 50x30mm, delivery within 10 days to 560001, budget ₹25,000. Labels will be on oil jars in refrigeration.";

type Chip = {
  label: string;
  value: string;
  num: boolean;
  display: string;
  o: number;
  ty: number;
  live?: boolean;
};

type Ticket = {
  key: string;
  label: string;
  amount: string;
  receipt: string;
  pct: number;
  typed: string;
  done: boolean;
  o: number;
  status?: "pass" | "warn" | "fail";
};

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function chipsFromSpec(spec: Partial<LabelSpec>): Chip[] {
  const qty = spec.quantity != null ? spec.quantity.toLocaleString("en-IN") : "—";
  const trim =
    spec.widthMm != null && spec.heightMm != null ? `${spec.widthMm} × ${spec.heightMm} mm` : "—";
  const cap = spec.budgetPaise != null ? formatInr(spec.budgetPaise) : "—";
  return [
    { label: "Quantity", value: qty, num: true, display: qty, o: 0, ty: 6 },
    { label: "Trim", value: trim, num: true, display: trim, o: 0, ty: 6 },
    { label: "Substrate", value: spec.substrate ?? "—", num: false, display: spec.substrate ?? "—", o: 0, ty: 6 },
    { label: "Finish", value: spec.finish ?? "—", num: false, display: spec.finish ?? "—", o: 0, ty: 6 },
    { label: "Oil", value: String(spec.oilExposure ?? false), num: false, display: String(spec.oilExposure ?? false), o: 0, ty: 6 },
    { label: "Cold", value: String(spec.refrigeration ?? false), num: false, display: String(spec.refrigeration ?? false), o: 0, ty: 6 },
    { label: "Deliver by", value: spec.deliveryDate ?? "—", num: true, display: spec.deliveryDate ?? "—", o: 0, ty: 6 },
    { label: "Pincode", value: spec.deliveryPincode ?? "—", num: true, display: spec.deliveryPincode ?? "—", o: 0, ty: 6 },
    { label: "Cap", value: cap, num: true, display: cap, o: 0, ty: 6 },
  ];
}

function productTitle(spec: Record<string, unknown> | null) {
  const type = String(spec?.productType ?? "label");
  if (type.includes("pickle")) return "Mango pickle jar label";
  return type.replaceAll("_", " ");
}

export function FlowTab({
  initialRfqId,
  scrollEl,
}: {
  initialRfqId?: string;
  scrollEl: HTMLDivElement | null;
}) {
  const rm = useRef(false);
  const timers = useRef<number[]>([]);
  const [rawText, setRawText] = useState(SAMPLE);
  const [chips, setChips] = useState<Chip[]>(() => chipsFromSpec(parseRfqText(SAMPLE).spec));
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [rfqId, setRfqId] = useState<string | null>(initialRfqId ?? null);
  const [data, setData] = useState<RfqDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [totalDisplay, setTotalDisplay] = useState("0.00");
  const [dockOpen, setDockOpen] = useState(false);
  const [capturePct, setCapturePct] = useState(0);
  const [captured, setCaptured] = useState(false);
  const [hashTyped, setHashTyped] = useState("");
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [artworkFile, setArtworkFile] = useState<File | null>(null);

  const parsed = useMemo(() => parseRfqText(rawText), [rawText]);

  const after = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, rm.current ? 1 : ms);
    timers.current.push(id);
  }, []);

  const glide = useCallback(
    (y: number) => {
      scrollEl?.scrollTo({ top: y, behavior: rm.current ? "auto" : "smooth" });
    },
    [scrollEl]
  );

  const load = useCallback(async (id: string) => {
    const res = await fetch(`/api/rfq/${id}`, { cache: "no-store" });
    const body = await readApiJson<RfqDetail & { error?: string }>(res);
    if (!res.ok) throw new Error(body.error ?? "Unable to load RFQ");
    setData(body);
    return body;
  }, []);

  useEffect(() => {
    rm.current = prefersReducedMotion();
    return () => {
      timers.current.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    const next = chipsFromSpec(parsed.spec);
    setChips((prev) =>
      next.map((c, i) => ({
        ...c,
        o: prev[i]?.o ?? 0,
        ty: prev[i]?.ty ?? 6,
        display: prev[i]?.display ?? c.value,
      }))
    );
  }, [parsed]);

  const revealChips = useCallback(() => {
    const current = chipsFromSpec(parsed.spec);
    current.forEach((_, i) => {
      after(() => {
        setChips((s) => s.map((c, j) => (j === i ? { ...c, o: 1, ty: 0 } : c)));
        if (!current[i].num || rm.current) return;
        const target = current[i].value;
        let f = 0;
        const scramble = () => {
          f += 1;
          const noisy = target.replace(/\d/g, () => String(Math.floor(Math.random() * 10)));
          setChips((s) =>
            s.map((c, j) => (j === i ? { ...c, display: f > 2 ? target : noisy, live: f <= 2 } : c))
          );
          if (f <= 2) after(scramble, 70);
        };
        scramble();
      }, 120 + i * 50);
    });
  }, [after, parsed.spec]);

  useEffect(() => {
    revealChips();
    // Reveal once on mount for the sample request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initialRfqId) return;
    load(initialRfqId)
      .then((body) => {
        setRfqId(body.rfq.id);
        setRawText(body.rfq.rawText);
        const nextStep = stepFromStatus(body.rfq.status, true);
        setStep(nextStep);
        if (body.quote) setTotalDisplay(formatInr(body.quote.totalPaise, false));
        if (body.commitment?.status === "locked") {
          const hash = body.commitment.commitmentHash ?? body.quote?.specHash ?? "";
          setHashTyped(hash ? `sha256:${hash}` : "");
        }
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load RFQ"));
  }, [initialRfqId, load]);

  const countTo = useCallback(
    (paise: number, dur: number) => {
      if (rm.current) {
        setTotalDisplay(formatInr(paise, false));
        return;
      }
      const t0 = performance.now();
      const run = (now: number) => {
        const t = Math.min(1, (now - t0) / dur);
        setTotalDisplay(formatInr(Math.round(paise * (1 - Math.pow(1 - t, 3))), false));
        if (t < 1) requestAnimationFrame(run);
      };
      requestAnimationFrame(run);
    },
    []
  );

  const typeReceipt = useCallback(
    (index: number, full: string) => {
      if (rm.current) {
        setTickets((s) => s.map((x, j) => (j === index ? { ...x, typed: full } : x)));
        return;
      }
      let n = 0;
      const stepType = () => {
        n += 3;
        setTickets((s) => s.map((x, j) => (j === index ? { ...x, typed: full.slice(0, n) } : x)));
        if (n < full.length) after(stepType, 20);
      };
      stepType();
    },
    [after]
  );

  const typeHash = useCallback(
    (full: string) => {
      if (rm.current) {
        setHashTyped(full);
        return;
      }
      let n = 7;
      const stepType = () => {
        n += 4;
        setHashTyped(full.slice(0, n));
        if (n < full.length) after(stepType, 24);
      };
      stepType();
    },
    [after]
  );

  async function raiseJob() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rfq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText }),
      });
      const body = await readApiJson<{ id: string; error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? "Failed to raise job");
      setRfqId(body.id);
      if (artworkFile) {
        const form = new FormData();
        form.set("artwork", artworkFile);
        await fetch(`/api/rfq/${body.id}/artwork`, { method: "POST", body: form });
      }
      const detail = await load(body.id);
      history.replaceState(null, "", `/rfq/${body.id}`);
      setStep(2);
      after(() => glide(320), 60);
      void detail;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to raise job");
    } finally {
      setBusy(false);
    }
  }

  async function runVerification() {
    if (!rfqId) return;
    setVerifying(true);
    setError(null);
    const seed: Ticket[] = [
      { key: "label_rules", label: "Label rules", amount: "₹120.00", receipt: "", pct: 0, typed: "", done: false, o: 0 },
      { key: "print_check", label: "Print check", amount: "₹140.00", receipt: "", pct: 0, typed: "", done: false, o: 0 },
      { key: "capacity", label: "Capacity", amount: "₹90.00", receipt: "", pct: 0, typed: "", done: false, o: 0 },
    ];
    setTickets(seed);

    const started = performance.now();
    seed.forEach((_, i) => {
      const at = i * 200;
      after(() => setTickets((s) => s.map((x, j) => (j === i ? { ...x, o: 1 } : x))), at);
      after(() => setTickets((s) => s.map((x, j) => (j === i ? { ...x, pct: 100 } : x))), at + 70);
    });

    try {
      const res = await fetch(`/api/rfq/${rfqId}/orchestrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await readApiJson<{ error?: string; receipts?: RfqDetail["receipts"] }>(res);
      if (!res.ok) throw new Error(body.error ?? "Verification failed");
      const detail = await load(rfqId);
      const receipts = detail.receipts;
      receipts.forEach((r, i) => {
        const meta = CAPABILITY_FEES[r.capability];
        after(() => {
          setTickets((s) =>
            s.map((x, j) =>
              j === i
                ? {
                    ...x,
                    key: r.capability,
                    label: meta?.label ?? r.capability,
                    amount: formatInr(meta?.amountPaise ?? 0),
                    receipt: r.receiptId,
                    done: true,
                    o: 1,
                    pct: 100,
                    status: r.status,
                  }
                : x
            )
          );
          typeReceipt(i, r.receiptId);
        }, i * 200 + 430);
      });
      const wait = Math.max(0, 1160 - (performance.now() - started));
      after(() => {
        setStep(3);
        setVerifying(false);
        if (detail.quote) countTo(detail.quote.totalPaise, rm.current ? 1 : 620);
        after(() => glide(560), 80);
      }, wait);
    } catch (cause) {
      setVerifying(false);
      setError(cause instanceof Error ? cause.message : "Verification failed");
    }
  }

  async function confirmPaid(orderId: string, paymentId?: string, signature?: string) {
    const confirmation = await fetch("/api/razorpay/webhook", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId,
        ...(paymentId ? { paymentId } : {}),
        ...(signature ? { signature } : {}),
      }),
    });
    const body = await readApiJson<{ error?: string }>(confirmation);
    if (!confirmation.ok) throw new Error(body.error ?? "Payment confirmation failed");
  }

  async function takeDeposit() {
    if (!rfqId) return;
    setDockOpen(true);
    setCapturePct(0);
    setCaptured(false);
  }

  async function capture() {
    if (!rfqId || captured) return;
    setBusy(true);
    setError(null);
    setCapturePct(100);
    try {
      const checkoutRes = await fetch(`/api/rfq/${rfqId}/checkout`, { method: "POST" });
      const checkout = await readApiJson<{
        error?: string;
        noPaymentRequired?: boolean;
        mock?: boolean;
        orderId?: string;
        keyId?: string;
        amountPaise?: number;
        commitmentHash?: string;
      }>(checkoutRes);
      if (!checkoutRes.ok) throw new Error(checkout.error ?? "Checkout failed");

      if (checkout.noPaymentRequired) {
        setCaptured(true);
        const detail = await load(rfqId);
        finishLock(detail);
        return;
      }

      if (checkout.mock && checkout.orderId) {
        await confirmPaid(checkout.orderId);
        setCaptured(true);
        const detail = await load(rfqId);
        after(() => finishLock(detail), 320);
        return;
      }

      const RazorpayCtor = (window as unknown as {
        Razorpay?: new (o: unknown) => { open: () => void };
      }).Razorpay;
      if (!RazorpayCtor) throw new Error("Razorpay Checkout did not load. Check your connection and try again.");
      const rzp = new RazorpayCtor({
        key: checkout.keyId,
        amount: checkout.amountPaise,
        currency: "INR",
        name: "ABC Labels",
        description: "Label production deposit",
        order_id: checkout.orderId,
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) => {
          try {
            await confirmPaid(
              response.razorpay_order_id,
              response.razorpay_payment_id,
              response.razorpay_signature
            );
            setCaptured(true);
            const detail = await load(rfqId);
            finishLock(detail);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Payment confirmation failed");
            setBusy(false);
          }
        },
        theme: { color: "#1F63E8" },
      });
      rzp.open();
      setBusy(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checkout failed");
      setCapturePct(0);
      setBusy(false);
    }
  }

  function finishLock(detail: RfqDetail) {
    setBusy(false);
    after(() => {
      setDockOpen(false);
      setStep(4);
    }, 200);
    const hash = detail.commitment?.commitmentHash ?? detail.quote?.specHash ?? "";
    after(() => {
      typeHash(hash ? `sha256:${hash}` : "");
      glide(620);
    }, 360);
  }

  async function quoteRevision() {
    if (!rfqId || !data?.rfq.spec) return;
    setBusy(true);
    setError(null);
    try {
      const currentQty = Number(data.rfq.spec.quantity ?? 0);
      const nextQty = currentQty === 10000 ? 12000 : Math.round(currentQty * 1.2);
      const res = await fetch(`/api/rfq/${rfqId}/revision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changes: { quantity: nextQty },
          reason: "Buyer requested specification update",
        }),
      });
      const body = await readApiJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? "Revision failed");
      const detail = await load(rfqId);
      setRevisionOpen(true);
      if (detail.quote) setTotalDisplay(formatInr(detail.quote.totalPaise, false));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Revision failed");
    } finally {
      setBusy(false);
    }
  }

  const spec = (data?.rfq.spec ?? parsed.spec) as Partial<LabelSpec>;
  const quote = data?.quote;
  const locked = step === 4 || data?.rfq.status === "locked" || data?.rfq.status === "revision_proposed";
  const status = (() => {
    if (locked) return { label: "LOCKED", bg: "var(--seal-wash)", fg: "var(--seal)" };
    if (step === 3) return { label: "QUOTED", bg: "var(--press-wash)", fg: "var(--press)" };
    if (step === 2) {
      return verifying
        ? { label: "ORCHESTRATING", bg: "var(--press-wash)", fg: "var(--press)" }
        : { label: "SPEC SET", bg: "var(--press-wash)", fg: "var(--press)" };
    }
    return { label: "DRAFT", bg: "var(--sunken)", fg: "var(--ink-2)" };
  })();
  const titles = {
    1: { k: "DEAL DESK · NEW REQUEST", t: "Raise a job" },
    2: { k: rfqId ? `JOB ${rfqId}` : "JOB", t: "Verify before you price" },
    3: { k: rfqId ? `JOB ${rfqId}` : "JOB", t: "One price, six lines, no model" },
    4: { k: rfqId ? `JOB ${rfqId}` : "JOB", t: "Locked to a spec hash" },
  } as const;
  const spine = [
    { n: "01", label: "Compose" },
    { n: "02", label: "Verify" },
    { n: "03", label: "Quote" },
    { n: "04", label: "Lock" },
  ].map((p, i) => {
    const idx = (i + 1) as 1 | 2 | 3 | 4;
    const active = idx === step;
    const done = idx < step;
    return {
      ...p,
      bar: done ? "var(--seal)" : active ? "var(--press)" : "var(--rule)",
      fg: active ? "var(--ink)" : done ? "var(--ink-2)" : "var(--ink-4)",
      numFg: active ? "var(--press)" : "var(--ink-4)",
      fw: active ? 600 : 500,
    };
  });

  const plateChips = chipsFromSpec(spec).map((c) => ({ label: c.label, display: c.value }));
  const missing = parsed.missingFields.length > 0;
  const questions = data?.rfq.clarification?.questions?.length
    ? data.rfq.clarification.questions
    : parsed.clarificationQuestions;
  const deposit = quote?.depositPaise ?? 0;
  const specHash = quote?.specHash ?? "";
  const orderId = data?.commitment?.razorpayOrderId ?? "pending";
  const canPay =
    Boolean(quote) &&
    !quote?.expired &&
    !quote?.requiresApproval &&
    ["quoted", "revision_proposed", "payment_pending"].includes(data?.rfq.status ?? "") &&
    step === 3;

  return (
    <div style={{ width: "min(100% - 56px, 880px)", margin: "0 auto", padding: "34px 0 200px" }}>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" />
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
        <div>
          <div style={{ fontFamily: "var(--font-code)", fontSize: 11, letterSpacing: "0.14em", color: "var(--ink-3)" }}>
            {titles[step].k}
          </div>
          <h1 style={{ margin: "6px 0 0", fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em", textWrap: "balance" }}>
            {titles[step].t}
          </h1>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 11px",
            borderRadius: 7,
            background: status.bg,
            color: status.fg,
            fontFamily: "var(--font-code)",
            fontSize: 10.5,
            letterSpacing: "0.1em",
            transition: "background 200ms linear, color 200ms linear",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 4, background: "currentColor" }} />
          {status.label}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 24 }}>
        {spine.map((p) => (
          <div key={p.n} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ height: 2, borderRadius: 2, background: p.bar, transition: "background 300ms linear" }} />
            <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
              <span style={{ fontFamily: "var(--font-code)", fontSize: 10, color: p.numFg }}>{p.n}</span>
              <span style={{ fontSize: 12.5, fontWeight: p.fw, color: p.fg, transition: "color 300ms linear" }}>
                {p.label}
              </span>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p style={{ marginTop: 18, fontSize: 13, color: "var(--flag)" }}>{error}</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 26 }}>
        {step > 1 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "15px 20px",
              background: "var(--sheet)",
              border: "1px solid var(--rule)",
              borderRadius: 12,
              animation: "fadeIn 200ms linear both",
            }}
          >
            <Check />
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>Request</span>
            <span
              style={{
                flex: 1,
                fontFamily: "var(--font-code)",
                fontSize: 11.5,
                color: "var(--ink-3)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {spec.quantity?.toLocaleString("en-IN")} · {spec.widthMm}×{spec.heightMm}mm · {spec.substrate} ·{" "}
              {spec.finish} · {spec.deliveryPincode}
            </span>
            <button
              type="button"
              className="sl-btn sl-btn-ghost"
              onClick={() => {
                setStep(1);
                glide(0);
              }}
              style={{ fontSize: 12.5, fontWeight: 500, padding: "6px 12px", borderRadius: 7 }}
            >
              Edit
            </button>
          </div>
        )}

        {step === 1 && (
          <div
            style={{
              background: "var(--sheet)",
              border: "1px solid var(--rule)",
              borderRadius: 14,
              boxShadow: "var(--lift)",
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 0" }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>What does the buyer need?</span>
              <span style={{ fontFamily: "var(--font-code)", fontSize: 10, letterSpacing: "0.1em", color: "var(--ink-4)" }}>
                {rawText.length} CHARS · UNSTRUCTURED
              </span>
            </div>
            <textarea
              value={rawText}
              spellCheck={false}
              onChange={(e) => setRawText(e.target.value)}
              style={{
                display: "block",
                width: "100%",
                boxSizing: "border-box",
                height: 132,
                padding: "14px 20px 16px",
                border: 0,
                outline: "none",
                resize: "none",
                background: "transparent",
                fontFamily: "var(--font-ui)",
                fontSize: 20,
                lineHeight: "31px",
                letterSpacing: "-0.012em",
                color: "var(--ink)",
              }}
            />
            <div style={{ padding: "4px 20px 0", borderTop: "1px solid var(--rule-soft)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0 11px" }}>
                <span style={{ fontFamily: "var(--font-code)", fontSize: 10, letterSpacing: "0.1em", color: "var(--ink-3)" }}>
                  PARSED DETERMINISTICALLY · NO MODEL SETS PRICE
                </span>
                <span style={{ fontFamily: "var(--font-code)", fontSize: 10, letterSpacing: "0.1em", color: "var(--seal)" }}>
                  CONFIDENCE {parsed.confidence.toFixed(2)}
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, paddingBottom: 16 }}>
                {chips.map((c) => (
                  <span
                    key={c.label}
                    style={{
                      display: "inline-flex",
                      alignItems: "baseline",
                      gap: 8,
                      padding: "7px 11px",
                      background: "var(--sunken)",
                      border: "1px solid var(--rule-soft)",
                      borderRadius: 8,
                      opacity: c.o,
                      transform: `translateY(${c.ty}px)`,
                      transition: "opacity 220ms var(--ease), transform 220ms var(--ease)",
                    }}
                  >
                    <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{c.label}</span>
                    <span
                      className="sl-nums"
                      style={{
                        fontFamily: "var(--font-code)",
                        fontSize: 12,
                        color: c.live ? "var(--press)" : "var(--ink)",
                      }}
                    >
                      {c.display}
                    </span>
                  </span>
                ))}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 20,
                padding: "14px 20px",
                background: "var(--sunken)",
                borderTop: "1px solid var(--rule-soft)",
              }}
            >
              <label style={{ fontSize: 12.5, color: "var(--ink-3)", cursor: "pointer" }}>
                {questions.length > 0
                  ? questions[0]
                  : missing
                    ? `Missing ${parsed.missingFields.join(", ")}.`
                    : artworkFile
                      ? `${artworkFile.name} attached.`
                      : "Nothing to clarify. Oil and cold exposure were both stated. Optional artwork: "}
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                  style={{ marginLeft: 8 }}
                  onChange={(e) => setArtworkFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <button type="button" className="sl-btn sl-btn-primary" disabled={busy || rawText.trim().length < 10} onClick={raiseJob}>
                {busy ? "Raising…" : "Raise job"}
              </button>
            </div>
          </div>
        )}

        {step > 1 && (
          <div
            style={{
              position: "relative",
              background: "var(--plate)",
              border: "1px solid var(--plate-edge)",
              borderRadius: 14,
              padding: "20px 22px",
              animation: "riseIn 280ms var(--ease) both",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
              <div>
                <div style={{ fontFamily: "var(--font-code)", fontSize: 10, letterSpacing: "0.14em", color: "var(--plate-ink)" }}>
                  SPEC PLATE · {String(spec.productType ?? "LABEL").toUpperCase()}
                </div>
                <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.028em", marginTop: 6 }}>
                  {productTitle(spec)}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "var(--font-code)", fontSize: 10, letterSpacing: "0.12em", color: "var(--plate-ink)" }}>
                  SPEC SHA256
                </div>
                <div style={{ fontFamily: "var(--font-code)", fontSize: 12, marginTop: 5 }}>
                  {specHash ? shortenHash(specHash) : "pending"}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 16 }}>
              {plateChips.map((c) => (
                <span
                  key={c.label}
                  style={{
                    display: "inline-flex",
                    alignItems: "baseline",
                    gap: 8,
                    padding: "6px 10px",
                    background: "var(--sheet)",
                    border: "1px solid var(--plate-edge)",
                    borderRadius: 7,
                  }}
                >
                  <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{c.label}</span>
                  <span className="sl-nums" style={{ fontFamily: "var(--font-code)", fontSize: 11.5 }}>
                    {c.display}
                  </span>
                </span>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 13,
                marginTop: 16,
                padding: "11px 13px",
                background: "var(--sheet)",
                border: "1px solid var(--plate-edge)",
                borderRadius: 9,
              }}
            >
              <span
                style={{
                  width: 46,
                  height: 31,
                  borderRadius: 5,
                  border: "1px solid var(--plate-edge)",
                  background: "repeating-linear-gradient(135deg, var(--sunken) 0 5px, var(--sheet) 5px 10px)",
                }}
              />
              <span style={{ flex: 1 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 600 }}>
                  {data?.rfq.artwork?.filename ?? artworkFile?.name ?? "no artwork yet"}
                </span>
                <span
                  style={{
                    display: "block",
                    fontFamily: "var(--font-code)",
                    fontSize: 10.5,
                    color: "var(--ink-3)",
                    marginTop: 2,
                  }}
                >
                    {data?.rfq.artwork
                    ? `${(data.rfq.artwork.sizeBytes / 1024).toFixed(1)} KB · ${shortenHash(data.rfq.artwork.hash)}`
                    : "Fingerprint stored after upload"}
                </span>
              </span>
              <span style={{ fontFamily: "var(--font-code)", fontSize: 10, letterSpacing: "0.1em", color: "var(--plate-ink)" }}>
                {data?.rfq.artwork ? "FINGERPRINTED" : "OPTIONAL"}
              </span>
            </div>
          </div>
        )}

        {step === 2 && (
          <div
            style={{
              background: "var(--sheet)",
              border: "1px solid var(--rule)",
              borderRadius: 14,
              boxShadow: "var(--lift)",
              overflow: "hidden",
              animation: "riseIn 280ms var(--ease) 60ms both",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "17px 20px",
                borderBottom: "1px solid var(--rule-soft)",
              }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                {verifying ? "Capturing capabilities" : "Verification"}
              </span>
              <span style={{ fontFamily: "var(--font-code)", fontSize: 10, letterSpacing: "0.1em", color: "var(--ink-4)" }}>
                x402 · PAYMENT-RESPONSE
              </span>
            </div>
            {!verifying ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, padding: 20 }}>
                <span style={{ fontSize: 13.5, color: "var(--ink-2)", maxWidth: 460, textWrap: "pretty" }}>
                  Three capabilities settle over x402 before a price exists. The agent pays ₹350.00 for label rules, print
                  check and capacity, and every verdict comes back with a receipt.
                </span>
                <button type="button" className="sl-btn sl-btn-primary" disabled={busy} onClick={runVerification} style={{ whiteSpace: "nowrap" }}>
                  Run verification
                </button>
              </div>
            ) : (
              <div style={{ padding: "4px 20px 14px" }}>
                {tickets.map((t) => (
                  <div
                    key={t.key}
                    style={{
                      padding: "13px 0",
                      borderBottom: "1px solid var(--rule-soft)",
                      opacity: t.o,
                      transition: "opacity 200ms linear",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
                      <span style={{ display: "flex", alignItems: "baseline", gap: 11 }}>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{t.label}</span>
                        <span style={{ fontFamily: "var(--font-code)", fontSize: 10.5, color: "var(--ink-3)" }}>
                          {t.typed}
                        </span>
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 11 }}>
                        <span className="sl-nums" style={{ fontFamily: "var(--font-code)", fontSize: 11, color: "var(--ink-3)" }}>
                          {t.amount}
                        </span>
                        {t.done && (
                          <span
                            style={{
                              padding: "3px 8px",
                              borderRadius: 5,
                              background:
                                t.status === "fail"
                                  ? "var(--flag-wash)"
                                  : t.status === "warn"
                                    ? "var(--press-wash)"
                                    : "var(--seal-wash)",
                              color:
                                t.status === "fail"
                                  ? "var(--flag)"
                                  : t.status === "warn"
                                    ? "var(--press)"
                                    : "var(--seal)",
                              fontFamily: "var(--font-code)",
                              fontSize: 9.5,
                              letterSpacing: "0.12em",
                              animation: "stampIn 220ms var(--ease) both",
                            }}
                          >
                            {(t.status ?? "pass").toUpperCase()}
                          </span>
                        )}
                      </span>
                    </div>
                    <div
                      style={{
                        height: 2,
                        borderRadius: 2,
                        background: "var(--rule-soft)",
                        marginTop: 11,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${t.pct}%`,
                          background: "var(--press)",
                          transition: "width 340ms var(--ease)",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step > 2 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "15px 20px",
              background: "var(--sheet)",
              border: "1px solid var(--rule)",
              borderRadius: 12,
            }}
          >
            <Check />
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>Verified</span>
            <span style={{ flex: 1, fontFamily: "var(--font-code)", fontSize: 11.5, color: "var(--ink-3)" }}>
              {data?.receipts.length ?? 3} receipts · label_rules · print_check · capacity
            </span>
            <span className="sl-nums" style={{ fontFamily: "var(--font-code)", fontSize: 11.5, color: "var(--ink-3)" }}>
              ₹350.00
            </span>
          </div>
        )}

        {step >= 3 && quote && (
          <div
            style={{
              position: "relative",
              background: "var(--sheet)",
              border: `1px solid ${locked ? "var(--seal)" : "var(--rule)"}`,
              borderRadius: 14,
              boxShadow: "var(--lift)",
              overflow: "hidden",
              transition: "border-color 400ms linear",
              animation: "riseIn 300ms var(--ease) both",
            }}
          >
            {locked && (
              <svg preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
                <rect
                  x="0.75"
                  y="0.75"
                  width="99.8%"
                  height="99.5%"
                  rx="13"
                  fill="none"
                  stroke="var(--seal)"
                  strokeWidth="1.5"
                  pathLength="1"
                  strokeDasharray="1"
                  style={{ strokeDashoffset: 1, animation: "sealDraw 620ms var(--ease) forwards" }}
                />
              </svg>
            )}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "17px 22px",
                borderBottom: "1px solid var(--rule-soft)",
              }}
            >
              <span style={{ display: "flex", alignItems: "baseline", gap: 13 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>Quote</span>
                <span style={{ fontFamily: "var(--font-code)", fontSize: 10, letterSpacing: "0.1em", color: "var(--ink-4)" }}>
                  PRICEBOOK {quote.pricebookVersion ?? "v2"} · EXPIRES IN 48H
                </span>
              </span>
              {locked && (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 11px",
                    borderRadius: 6,
                    background: "var(--seal-wash)",
                    color: "var(--seal)",
                    fontFamily: "var(--font-code)",
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    animation: "stampIn 240ms var(--ease) both",
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: 4, background: "currentColor" }} />
                  PLATE LOCKED
                </span>
              )}
            </div>
            <div className="sl-quote-grid">
              <div style={{ padding: "10px 22px 20px", borderRight: "1px solid var(--rule-soft)" }}>
                {quote.lineItems.map((l) => (
                  <div
                    key={l.code}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 18,
                      padding: "9px 0",
                      borderBottom: "1px solid var(--rule-soft)",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: 13, color: "var(--ink-2)" }}>
                      {l.label}
                      <span style={{ fontFamily: "var(--font-code)", fontSize: 10, letterSpacing: "0.06em", color: "var(--ink-4)" }}>
                        {l.code}
                      </span>
                    </span>
                    <span className="sl-nums" style={{ fontFamily: "var(--font-code)", fontSize: 12.5 }}>
                      {formatInr(l.amountPaise)}
                    </span>
                  </div>
                ))}
                <div style={{ fontFamily: "var(--font-code)", fontSize: 10, letterSpacing: "0.08em", color: "var(--ink-4)", paddingTop: 13 }}>
                  {quote.requiresApproval
                    ? "OVER ₹50,000.00 · MERCHANT APPROVAL NEEDED"
                    : `UNDER BUYER CAP ${formatInr(Number(spec.budgetPaise ?? 0))} · NO APPROVAL NEEDED`}
                </div>
              </div>
              <div
                style={{
                  padding: "20px 22px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  background: "var(--sunken)",
                }}
              >
                <div>
                  <div style={{ fontFamily: "var(--font-code)", fontSize: 10, letterSpacing: "0.14em", color: "var(--ink-3)" }}>
                    TOTAL PAYABLE
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginTop: 7 }}>
                    <span style={{ fontSize: 24, fontWeight: 600 }}>₹</span>
                    <span
                      className="sl-nums"
                      style={{
                        fontFamily: "var(--font-code)",
                        fontSize: 40,
                        fontWeight: 500,
                        letterSpacing: "-0.035em",
                      }}
                    >
                      {totalDisplay}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      marginTop: 18,
                      paddingTop: 14,
                      borderTop: "1px solid var(--rule)",
                    }}
                  >
                    <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                      {locked ? "Deposit captured" : "Deposit due on lock"}
                    </span>
                    <span
                      className="sl-nums"
                      style={{
                        fontFamily: "var(--font-code)",
                        fontSize: 15,
                        color: locked ? "var(--seal)" : "var(--ink)",
                      }}
                    >
                      {formatInr(deposit)}
                    </span>
                  </div>
                </div>
                {step === 3 && canPay && (
                  <button type="button" className="sl-btn sl-btn-primary" onClick={takeDeposit} style={{ width: "100%", marginTop: 20 }}>
                    Take deposit
                  </button>
                )}
                {step === 3 && quote.requiresApproval && (
                  <p style={{ marginTop: 20, fontSize: 12.5, color: "var(--flag)" }}>
                    Merchant approval is required before checkout.
                  </p>
                )}
                {locked && (
                  <div style={{ marginTop: 20, padding: "12px 13px", background: "var(--sheet)", border: "1px solid var(--rule)", borderRadius: 9 }}>
                    <div style={{ fontFamily: "var(--font-code)", fontSize: 9.5, letterSpacing: "0.12em", color: "var(--ink-3)" }}>
                      COMMITMENT HASH
                    </div>
                    <div style={{ fontFamily: "var(--font-code)", fontSize: 11, lineHeight: 1.65, marginTop: 5, wordBreak: "break-all" }}>
                      {hashTyped}
                      <span style={{ animation: "caretBlink 1s steps(1) infinite" }}>▍</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {locked && (
          <div
            style={{
              background: "var(--sheet)",
              border: "1px solid var(--rule)",
              borderRadius: 14,
              padding: "19px 22px",
              animation: "riseIn 280ms var(--ease) 140ms both",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Revision after lock</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 3 }}>
                  {revisionOpen || data?.revision
                    ? "Only the incremental deposit is charged. The lock moves to the new spec hash."
                    : "Buyer wants 12,000 instead of 10,000."}
                </div>
              </div>
              <button
                type="button"
                className="sl-btn sl-btn-ghost"
                disabled={busy}
                onClick={() => {
                  if (!data?.revision && data?.rfq.status === "locked") quoteRevision();
                  else setRevisionOpen((v) => !v);
                }}
                style={{
                  borderColor: "var(--rule-strong)",
                  color: "var(--ink)",
                  fontSize: 13,
                  padding: "10px 16px",
                  whiteSpace: "nowrap",
                }}
              >
                {revisionOpen || data?.revision ? "Hide" : "Quote a change"}
              </button>
            </div>
            {(revisionOpen || data?.revision) && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 16,
                  marginTop: 17,
                  paddingTop: 15,
                  borderTop: "1px solid var(--rule-soft)",
                  animation: "fadeIn 200ms linear both",
                }}
              >
                {[
                  {
                    k: "CHANGE",
                    v: data?.revision
                      ? `${String(data.rfq.spec?.quantity ?? "")} → ${String(data.revision.spec.quantity ?? "")}`
                      : "10,000 → 12,000",
                  },
                  { k: "PRICE DELTA", v: data?.revision ? `+${formatInr(data.revision.deltaPaise)}` : "+₹1,001.38" },
                  {
                    k: "INCREMENTAL DEPOSIT",
                    v: quote && data?.revision ? formatInr(quote.depositPaise) : "₹300.42",
                  },
                ].map((r) => (
                  <div key={r.k}>
                    <div style={{ fontFamily: "var(--font-code)", fontSize: 9.5, letterSpacing: "0.12em", color: "var(--ink-3)" }}>
                      {r.k}
                    </div>
                    <div className="sl-nums" style={{ fontFamily: "var(--font-code)", fontSize: 13, marginTop: 6 }}>
                      {r.v}
                    </div>
                  </div>
                ))}
                <div style={{ gridColumn: "1 / -1", fontFamily: "var(--font-code)", fontSize: 9.5, lineHeight: 1.7, color: "var(--ink-4)" }}>
                  DELTA UNDER ₹2,000 AUTONOMOUS CAP · NO MERCHANT APPROVAL · ONLY THE DELTA IS CHARGED · NEW SPEC HASH
                  REPLACES THE LOCK ON CAPTURE
                </div>
              </div>
            )}
          </div>
        )}

        {(data?.audit.length ?? 0) > 0 && (
          <div style={{ background: "var(--sheet)", border: "1px solid var(--rule)", borderRadius: 14, overflow: "hidden" }}>
            <button
              type="button"
              onClick={() => setAuditOpen((v) => !v)}
              style={{
                appearance: "none",
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                padding: "15px 20px",
                background: "transparent",
                border: 0,
                cursor: "pointer",
                fontFamily: "inherit",
                color: "var(--ink)",
                textAlign: "left",
                transition: "background 120ms linear",
              }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>Audit trail</span>
              <span style={{ fontFamily: "var(--font-code)", fontSize: 10.5, color: "var(--ink-3)", letterSpacing: "0.08em" }}>
                {data?.audit.length} EVENTS · {auditOpen ? "HIDE" : "SHOW"}
              </span>
            </button>
            {auditOpen && (
              <div
                style={{
                  padding: "4px 20px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  borderTop: "1px solid var(--rule-soft)",
                  animation: "fadeIn 180ms linear both",
                }}
              >
                {data?.audit.map((a, i) => (
                  <div
                    key={`${a.action}-${i}`}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 10,
                      fontFamily: "var(--font-code)",
                      fontSize: 11,
                      paddingTop: 8,
                      animation: "printLine 180ms linear both",
                    }}
                  >
                    <span style={{ color: "var(--ink-4)" }}>{a.createdAt ? formatClock(a.createdAt) : "—"}</span>
                    <span
                      style={{
                        color:
                          a.actor === "razorpay" ? "var(--press)" : a.actor === "system" ? "var(--seal)" : "var(--ink-3)",
                      }}
                    >
                      [{a.actor}]
                    </span>
                    <span>{a.action}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {dockOpen && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 60,
            background: "var(--sheet)",
            borderTop: "1px solid var(--rule)",
            boxShadow: "0 -12px 40px -20px rgba(13,19,48,.28)",
            animation: "dockIn 260ms var(--ease) both",
          }}
        >
          <div
            className="sl-dock-inner"
            style={{
              width: "min(100% - 56px, 880px)",
              margin: "0 auto",
              padding: "18px 0",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 32,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
              <div>
                <div style={{ fontFamily: "var(--font-code)", fontSize: 10, letterSpacing: "0.13em", color: "var(--ink-3)" }}>
                  PRODUCTION DEPOSIT · 30% OF {quote ? formatInr(quote.totalPaise) : "—"}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginTop: 5 }}>
                  <span style={{ fontSize: 19, fontWeight: 600 }}>₹</span>
                  <span
                    className="sl-nums"
                    style={{ fontFamily: "var(--font-code)", fontSize: 27, fontWeight: 500, letterSpacing: "-0.03em" }}
                  >
                    {formatInr(deposit, false)}
                  </span>
                </div>
              </div>
              <div
                style={{
                  paddingLeft: 26,
                  borderLeft: "1px solid var(--rule-soft)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  fontFamily: "var(--font-code)",
                  fontSize: 10.5,
                  color: "var(--ink-3)",
                }}
              >
                <span>ORDER {orderId}</span>
                <span>SPEC {specHash ? shortenHash(specHash) : "pending"}</span>
                <span>DEPOSIT VIA RAZORPAY · TEST MODE</span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button type="button" className="sl-btn sl-btn-ghost" onClick={() => setDockOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="sl-btn"
                disabled={captured}
                onClick={capture}
                style={{
                  position: "relative",
                  overflow: "hidden",
                  minWidth: 226,
                  border: 0,
                  fontSize: 14.5,
                  fontWeight: 600,
                  color: captured ? "#FFFFFF" : "var(--press-on)",
                  background: captured ? "var(--seal)" : "var(--press)",
                  padding: "13px 22px",
                  cursor: captured ? "default" : "pointer",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${capturePct}%`,
                    background: "rgba(255,255,255,.2)",
                    transition: "width 860ms var(--ease)",
                  }}
                />
                <span style={{ position: "relative" }}>
                  {captured ? "Captured" : capturePct > 0 ? "Capturing…" : `Pay ${formatInr(deposit)}`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Check() {
  return (
    <span
      style={{
        width: 20,
        height: 20,
        borderRadius: 11,
        background: "var(--seal-wash)",
        color: "var(--seal)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      ✓
    </span>
  );
}
