"use client";

import { use, useEffect, useState } from "react";
import { DealDesk } from "@/components/desk/DealDesk";

export default function RfqPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return null;
  return <DealDesk initialRfqId={id} skipIntro />;
}
