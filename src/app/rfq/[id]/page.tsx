"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { SpecEditor, type EditableSpec } from "@/components/spec-editor";
import { readApiJson } from "@/lib/http";

type RfqDetail = {
  rfq: {
    id: string;
    status: string;
    rawText: string;
    spec: Record<string, unknown> | null;
    clarification: { questions?: string[]; missingFields?: string[] } | null;
    artwork: {
      hash: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
    } | null;
  };
  quote: {
    id: string;
    lineItems: Array<{ code: string; label: string; amountPaise: number }>;
    totalPaise: number;
    depositPaise: number;
    specHash: string;
    expired: boolean;
    requiresApproval: boolean;
  } | null;
  revision: {
    id: string;
    spec: EditableSpec;
    status: string;
    deltaPaise: number;
    requiresApproval: boolean;
  } | null;
  commitment: {
    id: string;
    status: string;
    razorpayOrderId: string;
  } | null;
  receipts: Array<{
    capability: string;
    status: string;
    receiptId: string;
  }>;
  audit: Array<{ action: string; actor: string; detail: Record<string, unknown> }>;
};

export default function RfqPage({ params }: { params: Promise<{ id: string }> }) {
  const [rfqId, setRfqId] = useState<string>("");
  const [data, setData] = useState<RfqDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [specDraft, setSpecDraft] = useState<EditableSpec>({});

  useEffect(() => {
    params.then((p) => setRfqId(p.id));
  }, [params]);

  const load = useCallback(async () => {
    if (!rfqId) return;
    const res = await fetch(`/api/rfq/${rfqId}`, { cache: "no-store" });
    const body = await readApiJson<RfqDetail & { error?: string }>(res);
    if (!res.ok) throw new Error(body.error ?? "Unable to load RFQ");
    setData(body);
    setSpecDraft(body.revision?.status === "proposed" ? body.revision.spec : body.rfq.spec ?? {});
  }, [rfqId]);

  useEffect(() => {
    // Loading from the RFQ API is the synchronization performed by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch((cause) =>
      setError(cause instanceof Error ? cause.message : "Unable to load RFQ")
    );
  }, [load]);

  async function request(path: string, init: RequestInit) {
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(path, init);
      const body = await readApiJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? "Request failed");
      await load();
      return body;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed");
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function orchestrate() {
    const result = await request(`/api/rfq/${rfqId}/orchestrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (result) setMessage("Agent verification completed and the quote is ready.");
  }

  async function saveSpec() {
    const result = await request(`/api/rfq/${rfqId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spec: specDraft }),
    });
    if (result) setMessage("Specification saved. Run verification to refresh the quote.");
  }

  async function uploadArtwork(file: File) {
    const form = new FormData();
    form.set("artwork", file);
    const result = await request(`/api/rfq/${rfqId}/artwork`, {
      method: "POST",
      body: form,
    });
    if (result) setMessage("Artwork fingerprint saved. Run verification to refresh checks.");
  }

  async function proposeRevision() {
    if (!data?.rfq.spec) return;
    const current = data.rfq.spec;
    const changes = Object.fromEntries(
      Object.entries(specDraft).filter(([key, value]) => current[key] !== value)
    );
    const result = await request(`/api/rfq/${rfqId}/revision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes, reason: "Buyer requested specification update" }),
    });
    if (result) setMessage("Revision quoted. Any required incremental deposit is shown below.");
  }

  async function cancelRevision() {
    const result = await request(`/api/rfq/${rfqId}/revision`, { method: "DELETE" });
    if (result) setMessage("Revision cancelled. The previous locked specification remains active.");
  }

  async function payDeposit() {
    setLoading(true);
    setMessage(null);
    setError(null);
    const checkoutRes = await fetch(`/api/rfq/${rfqId}/checkout`, {
      method: "POST",
    });
    const checkout = await readApiJson<{
      error?: string;
      noPaymentRequired?: boolean;
      mock?: boolean;
      orderId?: string;
      keyId?: string;
      amountPaise?: number;
    }>(checkoutRes);
    if (!checkoutRes.ok) {
      setError(checkout.error ?? "Checkout failed");
      setLoading(false);
      return;
    }

    if (checkout.noPaymentRequired) {
      await load();
      setMessage("Revision accepted; no additional deposit was required.");
      setLoading(false);
      return;
    }

    if (checkout.mock) {
      await fetch("/api/razorpay/webhook", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: checkout.orderId,
        }),
      });
      await load();
      setMessage("Mock deposit captured (Razorpay test keys not configured).");
      setLoading(false);
      return;
    }

    const RazorpayCtor = (window as unknown as { Razorpay: new (o: unknown) => { open: () => void } }).Razorpay;
    const options = {
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
        const confirmation = await fetch("/api/razorpay/webhook", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: response.razorpay_order_id,
            paymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature,
          }),
        });
        if (!confirmation.ok) {
          const body = await readApiJson<{ error?: string }>(confirmation);
          setError(body.error ?? "Payment confirmation failed");
          setLoading(false);
          return;
        }
        await load();
        setMessage("Deposit paid via Razorpay.");
        setLoading(false);
      },
      theme: { color: "#047857" },
    };
    if (!RazorpayCtor) {
      setError("Razorpay Checkout did not load. Check your connection and try again.");
    } else {
      const rzp = new RazorpayCtor(options);
      rzp.open();
    }
    setLoading(false);
  }

  const rupees = (p: number) => `₹${(p / 100).toFixed(2)}`;

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" />
      <Link href="/" className="text-sm underline">← New RFQ</Link>
      <h1 className="text-2xl font-semibold">Order {rfqId}</h1>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {data && (
        <>
          <section className="rounded-xl border p-4 space-y-2">
            <p className="text-sm">
              Status: <strong>{data.rfq.status}</strong>
            </p>
            <p className="text-sm text-gray-600">{data.rfq.rawText}</p>
            {data.rfq.clarification?.questions?.map((q) => (
              <p key={q} className="text-amber-800 text-sm">⚠ {q}</p>
            ))}
          </section>

          <section className="rounded-xl border p-4 space-y-4">
            <div>
              <h2 className="font-medium">
                {data.rfq.status === "locked" ? "Current specification" : "Specification"}
              </h2>
              <p className="text-xs text-gray-500">
                Prices and commitments are generated from these structured fields.
              </p>
            </div>
            <SpecEditor
              value={specDraft}
              onChange={setSpecDraft}
              disabled={loading || data.rfq.status === "payment_pending" || data.rfq.status === "revision_proposed"}
            />
            {["draft", "needs_clarification", "quoted", "blocked"].includes(data.rfq.status) && (
              <button
                onClick={saveSpec}
                disabled={loading}
                className="rounded-lg border px-4 py-2 text-sm"
              >
                Save specification
              </button>
            )}
            {data.rfq.status === "locked" && (
              <button
                onClick={proposeRevision}
                disabled={loading}
                className="rounded-lg border px-4 py-2 text-sm"
              >
                Quote specification changes
              </button>
            )}
          </section>

          {["draft", "needs_clarification", "quoted", "blocked"].includes(data.rfq.status) && (
            <section className="rounded-xl border p-4 space-y-2">
              <h2 className="font-medium">Artwork</h2>
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                disabled={loading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) uploadArtwork(file);
                }}
              />
              <p className="text-xs text-gray-500">
                {data.rfq.artwork
                  ? `${data.rfq.artwork.filename} · ${(data.rfq.artwork.sizeBytes / 1024).toFixed(1)} KB · ${data.rfq.artwork.hash.slice(0, 12)}…`
                  : "Optional PDF, PNG, or JPEG up to 10 MB. The app stores its fingerprint and metadata."}
              </p>
            </section>
          )}

          <section className="flex flex-wrap gap-3">
            {["draft", "needs_clarification", "quoted", "blocked"].includes(data.rfq.status) && (
              <button
                onClick={orchestrate}
                disabled={loading}
                className="rounded-lg bg-slate-800 text-white px-4 py-2 text-sm"
              >
                Run agent verification
              </button>
            )}
            {data.quote &&
              !data.quote.expired &&
              !data.quote.requiresApproval &&
              ["quoted", "revision_proposed", "payment_pending"].includes(data.rfq.status) && (
              <button
                onClick={payDeposit}
                disabled={loading}
                className="rounded-lg bg-emerald-700 text-white px-4 py-2 text-sm"
              >
                {data.quote.depositPaise > 0
                  ? "Pay deposit (Razorpay)"
                  : "Accept revision"}
              </button>
            )}
            {data.rfq.status === "revision_proposed" && (
                <button
                  onClick={cancelRevision}
                  disabled={loading}
                  className="rounded-lg border px-4 py-2 text-sm"
                >
                  Cancel revision
                </button>
              )}
          </section>

          {message && <p className="text-sm text-emerald-700">{message}</p>}
          {data.quote?.requiresApproval && (
            <p className="text-sm text-amber-700">
              Merchant approval is required before checkout.
            </p>
          )}
          {data.quote?.expired && (
            <p className="text-sm text-amber-700">
              This quote expired. Run agent verification to generate a fresh quote.
            </p>
          )}

          {data.receipts.length > 0 && (
            <section className="rounded-xl border p-4">
              <h2 className="font-medium mb-2">Verified checks</h2>
              <ul className="space-y-1 text-sm">
                {data.receipts.map((r) => (
                  <li key={r.receiptId}>
                    {r.status === "pass" ? "✓" : "⚠"} {r.capability} ({r.receiptId})
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.quote && (
            <section className="rounded-xl border p-4 space-y-2">
              <h2 className="font-medium">Quote</h2>
              {data.quote.lineItems.map((li) => (
                <div key={li.code} className="flex justify-between text-sm">
                  <span>{li.label}</span>
                  <span>{rupees(li.amountPaise)}</span>
                </div>
              ))}
              <div className="flex justify-between font-semibold border-t pt-2">
                <span>Total</span>
                <span>{rupees(data.quote.totalPaise)}</span>
              </div>
              <div className="flex justify-between text-sm text-emerald-800">
                <span>{data.revision?.status === "proposed" ? "Additional deposit due" : "Deposit due"}</span>
                <span>{rupees(data.quote.depositPaise)}</span>
              </div>
              {data.revision?.status === "proposed" && (
                <div className="flex justify-between text-sm">
                  <span>Revision price change</span>
                  <span>{data.revision.deltaPaise >= 0 ? "+" : ""}{rupees(data.revision.deltaPaise)}</span>
                </div>
              )}
            </section>
          )}

          <section className="rounded-xl border p-4">
            <h2 className="font-medium mb-2">Audit trail</h2>
            <ol className="text-xs space-y-1 font-mono max-h-64 overflow-auto">
              {data.audit.map((a, i) => (
                <li key={i}>
                  [{a.actor}] {a.action}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </main>
  );
}
