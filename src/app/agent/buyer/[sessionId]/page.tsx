"use client";

import { use } from "react";
import { AgentRoom } from "@/components/desk/AgentRoom";

export default function BuyerAgentPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  return <AgentRoom role="buyer" sessionId={sessionId} />;
}
