# SpecLock architecture

## Rails

| Rail | Audience | Technology |
|---|---|---|
| Human checkout | Brand founder | Razorpay Orders + Standard Checkout (INR) |
| Agent capabilities | Buyer agent (hidden) | x402 HTTP 402 + micropayments |
| Core logic | Platform | Deterministic pricebook + Spec Commitment |

## Components

```text
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Buyer UI    │     │ SpecLock API     │     │ Merchant UI     │
└──────┬──────┘     └────────┬─────────┘     └────────┬────────┘
       │                     │                        │
       │              ┌──────┴──────┐                 │
       │              │ Orchestrator│                 │
       │              └──────┬──────┘                 │
       │         ┌───────────┼───────────┐           │
       ▼         ▼           ▼           ▼           ▼
   Razorpay   label-rules  print-check  capacity   SQLite
   (INR)      (x402)       (x402)       (x402)
```

## Spec Commitment

Canonical hash over:

- `spec_hash`
- `artwork_hash`
- line items (code + paise)
- `pricebook_version`
- `total_paise`

Stored in DB; Razorpay `notes` hold `commitment_id`, `spec_hash`, `rfq_id`.

## State machine

```text
needs_clarification → orchestrating → quoted → payment_pending
  → deposit_paid → locked
revision_proposed → (new checkout) → locked
blocked (capability or policy failure)
```

## Data store

SQLite (`data/speclock.db`) tables: `rfqs`, `quotes`, `commitments`, `capability_receipts`, `audit_events`, `webhook_events`.

## Security notes

- LLM extraction is rules-based in MVP (no API key required).
- Pricing is always `lib/pricebook.ts`.
- Webhook signature validated on raw body when secret configured.
- Capability endpoints reject unauthenticated calls with HTTP 402.

## Production path

1. Replace rules parser with LLM + Zod validation.
2. Wire CDP facilitator for on-chain x402 settlement.
3. Integrate Attestr FSSAI API behind `label-rules`.
4. Integrate print-check-cli / Enfocus for production preflight.
5. Deploy with public URL for Razorpay webhooks.
