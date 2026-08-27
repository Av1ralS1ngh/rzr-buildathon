import type { RfqStatus } from "./types";

const transitions: Record<RfqStatus, readonly RfqStatus[]> = {
  draft: ["needs_clarification", "orchestrating"],
  needs_clarification: ["draft", "orchestrating"],
  orchestrating: ["draft", "quoted", "awaiting_approval", "blocked"],
  quoted: ["orchestrating", "payment_pending", "blocked"],
  awaiting_approval: ["quoted", "blocked"],
  payment_pending: ["quoted", "locked"],
  deposit_paid: ["locked"],
  locked: ["revision_proposed"],
  revision_proposed: ["orchestrating", "payment_pending", "locked", "blocked"],
  blocked: ["draft", "needs_clarification", "orchestrating"],
  cancelled: [],
};

export function isRfqStatus(value: string): value is RfqStatus {
  return Object.prototype.hasOwnProperty.call(transitions, value);
}

export function canTransition(from: RfqStatus, to: RfqStatus): boolean {
  return from === to || transitions[from].includes(to);
}

export function assertTransition(from: string, to: RfqStatus): void {
  if (!isRfqStatus(from) || !canTransition(from, to)) {
    throw new Error(`Cannot move RFQ from '${from}' to '${to}'`);
  }
}

export function checkoutAllowed(status: RfqStatus): boolean {
  return status === "quoted" || status === "revision_proposed" || status === "payment_pending";
}

export function editableBeforePayment(status: RfqStatus): boolean {
  return ["draft", "needs_clarification", "quoted", "blocked"].includes(status);
}
