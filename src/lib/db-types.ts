export type QuoteRow = {
  id: string;
  rfq_id: string;
  line_items_json: string;
  total_paise: number;
  deposit_paise: number;
  spec_hash: string;
  pricebook_version: string;
  expires_at: number;
  created_at: number;
};

export type RfqRow = {
  id: string;
  status: string;
  raw_text: string;
  spec_json: string | null;
  artwork_hash: string | null;
  clarification_json: string | null;
  created_at: number;
};

export type CommitmentRow = {
  id: string;
  rfq_id: string;
  version: number;
  spec_hash: string;
  artwork_hash: string | null;
  quote_id: string;
  status: string;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  previous_commitment_id: string | null;
  created_at: number;
};
