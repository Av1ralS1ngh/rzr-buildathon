import type { LabelSpec } from "../types";
import { checkCapacity } from "../pricebook";
import { newId } from "../commitment";

export function runCapacityCheck(spec: LabelSpec, specHash: string): {
  status: "pass" | "warn" | "fail";
  receiptId: string;
  payload: Record<string, unknown>;
} {
  const result = checkCapacity(spec);
  return {
    status: result.feasible ? "pass" : "warn",
    receiptId: newId("rcpt_cap"),
    payload: {
      specHash,
      feasible: result.feasible,
      earliestShipDate: result.earliestShipDate,
      requestedDate: spec.deliveryDate,
      reason: result.reason,
      moq: 1000,
      quantity: spec.quantity,
    },
  };
}
