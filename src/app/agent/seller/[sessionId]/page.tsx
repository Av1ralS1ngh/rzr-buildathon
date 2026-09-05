"use client";

import { use } from "react";
import { AgentRoom } from "@/components/desk/AgentRoom";

export default function SellerAgentPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  return <AgentRoom role="seller" sessionId={sessionId} />;
}
