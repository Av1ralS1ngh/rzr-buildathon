import type { LabelSpec } from "./types";

const MAX_AUTONOMOUS_REVISION_PAISE = 200000; // ₹2,000
const MERCHANT_APPROVAL_THRESHOLD_PAISE = 5_000_000; // ₹50,000

export function policyCheckQuote(spec: LabelSpec, totalPaise: number): {
  allowed: boolean;
  requiresApproval: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (totalPaise > spec.budgetPaise) {
    reasons.push("Exceeds buyer budget cap");
  }
  if (spec.quantity < 1000) {
    reasons.push("Below MOQ policy");
  }
  const requiresApproval = totalPaise > MERCHANT_APPROVAL_THRESHOLD_PAISE;
  return {
    allowed: reasons.length === 0,
    requiresApproval,
    reasons,
  };
}

export function policyCheckRevision(deltaPaise: number): {
  allowed: boolean;
  requiresHumanApproval: boolean;
} {
  if (deltaPaise <= 0) {
    return { allowed: true, requiresHumanApproval: false };
  }
  return {
    allowed: true,
    requiresHumanApproval: deltaPaise > MAX_AUTONOMOUS_REVISION_PAISE,
  };
}

export function validateAgentDemoKey(key: string | null): boolean {
  const expected = process.env.X402_DEMO_AGENT_KEY ?? "speclock-demo-agent";
  return key === expected;
}

export function validateInternalSecret(header: string | null): boolean {
  const secret = process.env.SPELOCK_INTERNAL_SECRET ?? "change-me-in-production";
  return header === secret;
}
