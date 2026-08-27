"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type MerchantRfq = {
  id: string;
  status: string;
  raw_text: string;
  created_at: number;
  total_paise?: number;
  deposit_paise?: number;
  commitment_status?: string;
};

export default function MerchantPage() {
  const [rfqs, setRfqs] = useState<MerchantRfq[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/merchant/rfqs", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load RFQs");
      setRfqs(body.rfqs ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load RFQs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(id: string) {
    const response = await fetch(`/api/rfq/${id}/approve`, { method: "POST" });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error ?? "Approval failed");
      return;
    }
    await load();
  }

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <Link href="/" className="text-sm underline">← Buyer portal</Link>
      <h1 className="text-2xl font-semibold">Merchant — ABC Labels</h1>
      <p className="text-sm text-gray-600">
        RFQs with capability receipts, deterministic quotes, and Razorpay deposits.
      </p>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-gray-500">Loading RFQs…</p>}
      <div className="rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-3">RFQ</th>
              <th className="p-3">Status</th>
              <th className="p-3">Quote</th>
              <th className="p-3">Commitment</th>
              <th className="p-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {rfqs.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3">
                  <Link href={`/rfq/${r.id}`} className="underline font-mono text-xs">
                    {r.id}
                  </Link>
                  <p className="text-gray-500 truncate max-w-xs">{r.raw_text}</p>
                </td>
                <td className="p-3">{r.status}</td>
                <td className="p-3">
                  {r.total_paise
                    ? `₹${(r.total_paise / 100).toFixed(2)}`
                    : "—"}
                </td>
                <td className="p-3">{r.commitment_status ?? "—"}</td>
                <td className="p-3">
                  {(r.status === "awaiting_approval" ||
                    r.status === "revision_proposed") && (
                    <button
                      className="rounded-md border px-3 py-1 text-xs"
                      onClick={() => approve(r.id)}
                    >
                      Approve quote
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && rfqs.length === 0 && (
              <tr>
                <td className="p-4 text-gray-500" colSpan={5}>No RFQs yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
