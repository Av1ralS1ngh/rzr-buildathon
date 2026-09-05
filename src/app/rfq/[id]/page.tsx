"use client";

import { use } from "react";
import { DealDesk } from "@/components/desk/DealDesk";

export default function RfqPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <DealDesk initialRfqId={id} skipIntro />;
}
