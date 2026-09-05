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

Buyer and seller rooms (`/agent/buyer/:sessionId`, `/agent/seller/:sessionId`)
are independent UIs over the same session. A buyer counter can wait
(`awaitSeller: true`) until the seller room runs price policy. Chat notes are
stored separately from immutable offers. The LLM still cannot authorize a price.

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

Production uses **Neon Postgres** when `DATABASE_URL` is set. Local development
falls back to SQLite (`data/speclock.db` or `SPELOCK_DB_PATH`).

Both backends share the original RFQ tables plus merchant catalog, seller
policy, negotiation, immutable offer, bundle, mandate, commerce order,
event-outbox, and idempotency tables.

SQLite enables WAL mode, foreign-key enforcement, a busy timeout, indexed
lookups, and additive startup migrations. One active commitment is allowed per
quote; legacy duplicate attempts are retained as `superseded`.

## Security notes

- RFQ extraction uses LLM + Zod when an API key is set, otherwise the rules
  parser. Either path is validated; pricing is always `lib/pricebook.ts`.
- `label-rules` is the embedded FSSAI 2011 + Legal Metrology PCR 2011 pack, not
  a live government API and not a legal certificate.
- `print-check` inspects PDF/PNG/JPEG bytes locally. Enfocus PitStop is optional
  via `ENFOCUS_PREFLIGHT_URL`.
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

Shipped: Neon Postgres, public HTTPS on Vercel, Razorpay test checkout, SpecLock
v2 deal-desk UI, public x402.org facilitator client, statutory label-rules pack,
local print preflight, LLM parser with rules fallback.

Still needs **your** secrets (the demo keeps working without them):

1. Funded `X402_PAY_TO` on Base Sepolia so agent payments can settle.
2. `LLM_API_KEY` (or `OPENAI_API_KEY` / `NEON_AI_API_KEY`) for the LLM overlay.
3. `ENFOCUS_PREFLIGHT_URL` + `ENFOCUS_API_KEY` if you have PitStop Server.
4. Merchant/buyer authentication after the hackathon.
