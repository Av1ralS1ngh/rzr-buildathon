"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    fetch("/api/merchant/rfqs")
      .then((r) => r.json())
      .then((d) => setRfqs(d.rfqs ?? []));
  }, []);

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <Link href="/" className="text-sm underline">← Buyer portal</Link>
      <h1 className="text-2xl font-semibold">Merchant — ABC Labels</h1>
      <p className="text-sm text-gray-600">
        RFQs with capability receipts, deterministic quotes, and Razorpay deposits.
      </p>
      <div className="rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-3">RFQ</th>
              <th className="p-3">Status</th>
              <th className="p-3">Quote</th>
              <th className="p-3">Commitment</th>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
