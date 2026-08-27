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

## Agentic deal plane

```text
Buyer mandate (private ceiling + quantity authority)
          │
          ▼
  Negotiation session ◀──────── Seller authority (costs + private floors)
          │       immutable offers / bounded concessions
          ├──────────────► Bundle optimizer ──► permissioned cross-sells
          │
          ▼
 Accepted offer
          ├──► closed checkout mandate
          ├──► closed payment mandate
          └──► commitment hash ──► Razorpay INR deposit
```

The domain logic lives in `src/lib/commerce` and is independent of A2A, UCP,
AP2, and ACP transports. Protocol routes are adapters over one transaction and
policy model, so no transport can bypass private buyer or seller limits.

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

SQLite (`data/speclock.db`) includes the original RFQ tables plus merchant
catalog, seller policy, negotiation, immutable offer, bundle, mandate, commerce
order, event-outbox, and idempotency tables.

The database enables WAL mode, foreign-key enforcement, a busy timeout, indexed
lookups, and additive startup migrations. One active commitment is allowed per
quote; legacy duplicate attempts are retained as `superseded`.

## Security notes

- LLM extraction is rules-based in MVP (no API key required).
- Pricing is always `lib/pricebook.ts`.
- Webhook signature validated on raw body when secret configured.
- Live payment confirmations require all Razorpay signature fields.
- Webhook events and checkout creation are idempotent.
- Payment amount and currency must match the commitment.
- Capability endpoints reject unauthenticated calls with HTTP 402.
- x402 payment payloads are verified and settled by the configured facilitator;
  header presence alone never grants access.
- Locked specs are immutable. A proposed revision is stored separately and only
  replaces the active spec after approval/payment.
- Artwork is size/type/magic-byte validated and stored as a SHA-256 fingerprint;
  source files are not retained by this MVP.

## Production path

1. Replace rules parser with LLM + Zod validation.
2. Configure an x402 facilitator and funded `X402_PAY_TO` address.
3. Integrate a statutory data provider behind `label-rules`.
4. Integrate print-check-cli / Enfocus for production preflight.
5. Move SQLite to managed Postgres and add merchant/buyer authentication.
6. Deploy with a public HTTPS URL for Razorpay webhooks.
