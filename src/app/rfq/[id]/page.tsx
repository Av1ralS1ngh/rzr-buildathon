"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Script from "next/script";

type RfqDetail = {
  rfq: {
    id: string;
    status: string;
    rawText: string;
    spec: Record<string, unknown> | null;
    clarification: { questions?: string[]; missingFields?: string[] } | null;
  };
  quote: {
    id: string;
    lineItems: Array<{ code: string; label: string; amountPaise: number }>;
    totalPaise: number;
    depositPaise: number;
    specHash: string;
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

  useEffect(() => {
    params.then((p) => setRfqId(p.id));
  }, [params]);

  const load = useCallback(async () => {
    if (!rfqId) return;
    const res = await fetch(`/api/rfq/${rfqId}`);
    setData(await res.json());
  }, [rfqId]);

  useEffect(() => {
    load();
  }, [load]);

  async function orchestrate() {
    setLoading(true);
    setMessage(null);
    await fetch(`/api/rfq/${rfqId}/orchestrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artworkFilename: "artwork.pdf" }),
    });
    await load();
    setLoading(false);
    setMessage("Agent purchased verification capabilities (hidden from you).");
  }

  async function payDeposit() {
    setLoading(true);
    const checkoutRes = await fetch(`/api/rfq/${rfqId}/checkout`, {
      method: "POST",
    });
    const checkout = await checkoutRes.json();
    if (!checkoutRes.ok) {
      setMessage(checkout.error);
      setLoading(false);
      return;
    }

    if (checkout.mock) {
      await fetch("/api/razorpay/webhook", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: checkout.orderId,
          rfqId,
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
        await fetch("/api/razorpay/webhook", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: response.razorpay_order_id,
            paymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature,
            rfqId,
          }),
        });
        await load();
        setMessage("Deposit paid via Razorpay.");
        setLoading(false);
      },
      theme: { color: "#047857" },
    };
    const rzp = new RazorpayCtor(options);
    rzp.open();
    setLoading(false);
  }

  const rupees = (p: number) => `₹${(p / 100).toFixed(2)}`;

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" />
      <Link href="/" className="text-sm underline">← New RFQ</Link>
      <h1 className="text-2xl font-semibold">Order {rfqId}</h1>

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

          <section className="flex flex-wrap gap-3">
            <button
              onClick={orchestrate}
              disabled={loading}
              className="rounded-lg bg-slate-800 text-white px-4 py-2 text-sm"
            >
              Run agent verification
            </button>
            {data.quote && data.rfq.status !== "locked" && (
              <button
                onClick={payDeposit}
                disabled={loading}
                className="rounded-lg bg-emerald-700 text-white px-4 py-2 text-sm"
              >
                Pay deposit (Razorpay)
              </button>
            )}
          </section>

          {message && <p className="text-sm text-emerald-700">{message}</p>}

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
                <span>Deposit due</span>
                <span>{rupees(data.quote.depositPaise)}</span>
              </div>
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
