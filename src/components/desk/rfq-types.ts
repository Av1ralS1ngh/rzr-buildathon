import type { EditableSpec } from "@/components/spec-editor";
import type { CapabilityReceipt } from "@/lib/types";

export type RfqDetail = {
  rfq: {
    id: string;
    status: string;
    rawText: string;
    spec: Record<string, unknown> | null;
    productId?: string | null;
    product?: { id: string; sku: string; name: string; unit: string } | null;
    clarification: {
      questions?: string[];
      missingFields?: string[];
      engine?: "rules" | "llm+zod";
      llmModel?: string | null;
    } | null;
    artwork: {
      hash: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      preflight?: {
        inspection?: {
          engine?: string;
          dpi?: number;
          bleedMm?: number;
          widthMm?: number;
          heightMm?: number;
        };
        print?: { status?: string };
      } | null;
    } | null;
  };
  quote: {
    id: string;
    lineItems: Array<{ code: string; label: string; amountPaise: number }>;
    totalPaise: number;
    depositPaise: number;
    specHash: string;
    expired: boolean;
    requiresApproval: boolean;
    pricebookVersion?: string;
  } | null;
  revision: {
    id: string;
    spec: EditableSpec;
    status: string;
    deltaPaise: number;
    requiresApproval: boolean;
  } | null;
  commitment: {
    id: string;
    status: string;
    specHash?: string;
    razorpayOrderId: string;
    commitmentHash?: string;
  } | null;
  receipts: CapabilityReceipt[];
  audit: Array<{
    action: string;
    actor: string;
    detail: Record<string, unknown>;
    createdAt?: number;
  }>;
};

export function stepFromStatus(status: string, hasRfq: boolean): 1 | 2 | 3 | 4 {
  if (["locked", "revision_proposed", "deposit_paid"].includes(status)) return 4;
  if (["quoted", "awaiting_approval", "payment_pending"].includes(status)) return 3;
  if (["orchestrating", "draft", "needs_clarification", "blocked"].includes(status) && hasRfq) {
    return 2;
  }
  return 1;
}

export const CAPABILITY_FEES: Record<string, { label: string; amountPaise: number }> = {
  label_rules: { label: "Label rules", amountPaise: 12000 },
  print_check: { label: "Print check", amountPaise: 14000 },
  capacity: { label: "Capacity", amountPaise: 9000 },
};
