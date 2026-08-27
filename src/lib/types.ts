export type RfqStatus =
  | "draft"
  | "needs_clarification"
  | "orchestrating"
  | "quoted"
  | "awaiting_approval"
  | "payment_pending"
  | "deposit_paid"
  | "locked"
  | "revision_proposed"
  | "blocked"
  | "cancelled";

export interface LabelSpec {
  productType: string;
  quantity: number;
  widthMm: number;
  heightMm: number;
  substrate: "pp_white" | "pp_clear" | "pet_white";
  finish: "matte" | "gloss" | "matte_lamination";
  oilExposure: boolean;
  refrigeration: boolean;
  deliveryDate: string;
  deliveryPincode: string;
  budgetPaise: number;
  fssaiLicense?: string;
}

export interface LineItem {
  code: string;
  label: string;
  amountPaise: number;
}

export interface QuoteResult {
  lineItems: LineItem[];
  subtotalPaise: number;
  verificationFeePaise: number;
  totalPaise: number;
  depositPaise: number;
  upsell?: { code: string; label: string; deltaPaise: number; reason: string };
}

export interface CapabilityReceipt {
  capability: "label_rules" | "print_check" | "capacity";
  status: "pass" | "warn" | "fail";
  receiptId: string;
  specHash: string;
  artworkHash?: string;
  payload: Record<string, unknown>;
  paymentMode: "x402" | "internal" | "demo";
  paidAt: string;
}

export interface ArtworkMetadata {
  filename: string;
  mimeType: "application/pdf" | "image/png" | "image/jpeg";
  sizeBytes: number;
  hash: string;
}

export interface AuditEvent {
  id: string;
  rfqId: string;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
  createdAt: number;
}
