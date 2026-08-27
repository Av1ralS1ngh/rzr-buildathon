"use client";

import { useState } from "react";
import Link from "next/link";

const SAMPLE_RFQ =
  "I need 10,000 waterproof mango pickle jar labels 50x30mm, delivery within 10 days to 560001, budget ₹25,000. Labels will be on oil jars in refrigeration.";

export default function HomePage() {
  const [rawText, setRawText] = useState(SAMPLE_RFQ);
  const [loading, setLoading] = useState(false);
  const [rfqId, setRfqId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitRfq() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rfq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setRfqId(data.id);
      window.location.href = `/rfq/${data.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <header className="space-y-2">
        <p className="text-sm font-medium text-emerald-700">SpecLock</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Checkout for custom labels
        </h1>
        <p className="text-muted-foreground text-sm max-w-2xl">
          Your AI agent handles verification in the background. You only see the
          quote and pay in rupees via Razorpay.
        </p>
        <nav className="flex gap-4 text-sm">
          <Link href="/merchant" className="underline">Merchant dashboard</Link>
        </nav>
      </header>

      <section className="rounded-xl border p-4 space-y-3 bg-white shadow-sm">
        <label className="text-sm font-medium">Describe your label order</label>
        <textarea
          className="w-full min-h-[120px] rounded-lg border p-3 text-sm"
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
        />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button
          onClick={submitRfq}
          disabled={loading}
          className="rounded-lg bg-emerald-700 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Submitting…" : "Submit RFQ"}
        </button>
      </section>

      {rfqId && (
        <p className="text-sm">
          RFQ created.{" "}
          <Link className="underline font-medium" href={`/rfq/${rfqId}`}>
            View quote flow →
          </Link>
        </p>
      )}
    </main>
  );
}
