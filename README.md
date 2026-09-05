# SpecLock

A mandate-aware agentic deal desk for specification-heavy B2B commerce. Buyer
and seller agents negotiate price, quantity, delivery, and permissioned bundles
inside private commercial boundaries. Humans pay production deposits in INR via
Razorpay; agents use x402 for invisible verification capabilities.

Built for **Razorpay AI Buildathon — Track 01: AI Growth & Agentic Commerce**.

## Problem

Custom food and cosmetics labels do not have SKUs. Before checkout, someone must clarify specs, check compliance fields, validate artwork, confirm factory capacity, and price deterministically. AI buyers can request quotes all day but cannot safely certify those steps alone.

## Solution

1. Buyer submits messy RFQ (web UI simulates buyer agent).
2. SpecLock parses the spec with an **LLM + Zod overlay** when `LLM_API_KEY` is set, otherwise a deterministic rules extractor. Clarifying questions fire when fields are missing. The LLM never sets price.
3. **Agent orchestrator** obtains three capabilities (also exposed as x402-gated HTTP APIs):
   - `label-rules` — FSSAI 2011 + Legal Metrology PCR 2011 statutory pack
   - `print-check` — local PDF/PNG/JPEG byte inspector, plus Enfocus if configured
   - `capacity` — merchant MOQ and ship-date feasibility
4. Deterministic **pricebook** generates quote (LLM never sets price). Merchants edit the live rate card and SKU catalog in the Catalog tab.
5. Human pays **deposit via Razorpay** Standard Checkout (test mode), with an explicit local mock fallback.
6. **Spec Commitment** binds payment to spec hash; production locks.
7. Full **audit trail** for judges and merchants.

Humans never see crypto. x402 is only for machine verification.

## Negotiation and cross-selling

- Seller opens at list price; private floors and costs never appear in offers.
- Buyer ceilings remain private and are evaluated by the buyer-side policy.
- Concessions are deterministic, round-limited, expiring, and may require a
  reciprocal commercial give-back.
- Quantity changes must remain inside the buyer-authorized range.
- Complementary products are proposed only when cross-selling is
  explicitly permitted and those SKUs exist in the catalog.
- Buyer and seller agents can chat in separate rooms (`/agent/buyer/:id`,
  `/agent/seller/:id`); the seller room is the only place floors and costs appear.
- Accepted offers create signed open/closed checkout and payment mandates before
  Razorpay order creation.

See [docs/NEGOTIATION.md](docs/NEGOTIATION.md) for invariants and transaction
boundaries.

## Quick start

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:43123

### Environment

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Production | Neon pooled Postgres connection string |
| `DATABASE_URL_UNPOOLED` | Migrations | Neon direct connection string |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Optional* | Test Orders + Checkout |
| `RAZORPAY_WEBHOOK_SECRET` | Optional | Webhook HMAC verification |
| `ALLOW_MOCK_PAYMENTS` | Optional | Must be `true` to permit mock capture in production |
| `SPELOCK_INTERNAL_SECRET` | Recommended | Orchestrator → capability internal auth |
| `MANDATE_SIGNING_SECRET` | Required in production | Derives issuer-scoped ES256 mandate keys |
| `ACP_API_KEY` | Recommended in production | Protects the ACP checkout adapter |
| `X402_DEMO_AGENT_KEY` | Optional | Demo agent header for capability APIs |
| `X402_FACILITATOR_URL` | Optional | Defaults to `https://x402.org/facilitator` |
| `X402_PAY_TO` | For real x402 settle | Funded Base Sepolia USDC address; without it, capabilities still **402** (demo/internal keys still work) |
| `X402_FACILITATOR_TOKEN` | Optional | Bearer token if the facilitator requires one |
| `LLM_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY` | Optional | LLM RFQ parser; rules extractor is the fallback |
| `LLM_BASE_URL` / `LLM_MODEL` | Optional | Google AI Studio OpenAI-compatible URL + `gemini-3.6-flash` when those env vars are set |
| `ENFOCUS_PREFLIGHT_URL` / `ENFOCUS_API_KEY` | Optional | HTTP PitStop/pdfToolbox; local inspector always runs |
| `TELEGRAM_BOT_TOKEN` | Optional | Free BotFather bot; incoming chats become RFQs |
| `TELEGRAM_WEBHOOK_SECRET` | With Telegram | Shared secret Telegram sends on each webhook |

\*Without Razorpay keys, checkout runs in **mock mode** (still demonstrates idempotent deposit capture).

## Demo flow

The web UI is a five-tab deal desk (Flow, Catalog, Merchant, Negotiation, Agent mesh). On first load an intro film plays; use **SKIP** or **INTRO** to replay. `prefers-reduced-motion` skips the intro.

1. Catalog → inspect and edit the live pricebook, SKUs (list/target/floor/cost), and seller policy.
2. Flow → sample pickle RFQ is prefilled. Leave **Custom job** selected to use the pricebook formula, or bind any SKU. **Raise job** (optional artwork upload).
3. **Run verification** — orchestrator buys label-rules, print-check, and capacity receipts.
4. **Take deposit** → Razorpay test checkout, or mock capture when keys are absent.
5. After lock, **Quote a change** prices a quantity revision; only the delta deposit is charged.
6. Merchant tab lists live jobs; **Approve** for quotes over the ₹50,000 threshold.
7. Negotiation → pick any SKU, start a session, then **Open buyer + seller rooms** (two independent windows).
8. Agent mesh shows the x402 wire log and protocol surfaces.
9. Telegram (optional): message the bot the same pickle sentence; it opens an RFQ and replies with the desk link.

Fonts are Instrument Sans + JetBrains Mono. Light/dark toggle is in the header.

## API overview

| Endpoint | Description |
|---|---|
| `POST /api/rfq` | Create RFQ from raw text |
| `GET /api/rfq/:id` | RFQ, quote, receipts, audit |
| `POST /api/rfq/:id/orchestrate` | Run capability mesh + quote |
| `POST /api/rfq/:id/checkout` | Create Razorpay order for deposit |
| `POST /api/rfq/:id/revision` | Propose priced spec revision |
| `DELETE /api/rfq/:id/revision` | Cancel an unpaid revision |
| `POST /api/rfq/:id/artwork` | Validate and fingerprint artwork (10 MB maximum) |
| `POST /api/rfq/:id/approve` | Merchant quote approval |
| `POST /api/capabilities/*` | x402-gated capability providers |
| `GET /api/x402/status` | Live facilitator, parser, statute pack, Enfocus flags |
| `POST /api/telegram/webhook` | Telegram inbound RFQ (BotFather) |
| `POST /api/telegram/setup` | Register webhook (internal secret) |
| `GET /api/merchant/rfqs` | Merchant queue |
| `GET /api/catalog` | Public merchant catalog (private costs/floors omitted) |
| `GET /api/catalog?view=merchant` | Full SKU book including cost, target, and floor |
| `POST /api/catalog` | Create a SKU |
| `PATCH /api/catalog/:id` | Edit a SKU (including prices) |
| `GET/PUT /api/pricebook` | Live rate card used by Flow quotes |
| `GET/PUT /api/seller-policy` | Active seller negotiation policy |
| `POST /api/negotiations` | Create negotiation and opening offer |
| `POST /api/negotiations/:id/counter` | Submit bounded counteroffer (`awaitSeller: true` waits for the seller room) |
| `POST /api/negotiations/:id/respond` | Seller room runs price policy |
| `GET/POST /api/negotiations/:id/messages` | Independent agent chat notes |
| `POST /api/negotiations/:id/auto` | Run deterministic buyer/seller rounds |
| `GET/POST /api/negotiations/:id/bundles` | Generate/select cross-sell bundles |
| `POST /api/negotiations/:id/checkout` | Create mandate-bound Razorpay order |

## Agentic protocol discovery

| Protocol | Surface |
|---|---|
| A2A 1.0 | `/.well-known/agent-card.json`, `/a2a/v1/message:send` |
| UCP 2026-04-08 | `/.well-known/ucp`, `/ucp/v1/checkout-sessions/*` |
| AP2 compatibility | `/api/ap2/mandates/:sessionId` |
| ACP 2026-04-17 | `/.well-known/acp.json`, `/checkout_sessions/*` |

The AP2 layer uses ES256-signed AP2-shaped artifacts without selective
disclosures; it is intentionally described as a compatibility layer rather than
full protocol conformance. ACP checkout is mapped to Razorpay, so Stripe Shared
Payment Tokens are not accepted across PSPs.

## x402 capability APIs

Return `402 Payment Required` with `PAYMENT-REQUIRED` header unless authorized via:

- `PAYMENT-SIGNATURE` (x402 client)
- `X-Demo-Agent-Key` (hackathon demo)
- `X-Speclock-Internal` (orchestrator)

`PAYMENT-SIGNATURE` is never trusted on presence alone. The server talks to the
configured facilitator (`X402_FACILITATOR_URL`, default `https://x402.org/facilitator`)
to **verify then settle** an x402 v2 payload, and only then returns `PAYMENT-RESPONSE`.

Settlement still needs a non-zero `X402_PAY_TO` (Base Sepolia USDC). Until that
address is set, machine callers without the demo or internal key receive HTTP 402.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Track 01 alignment

- **Merchant revenue:** faster quote path, technical upsell, deposit capture, revision deltas.
- **AI buyer end-to-end:** agent orchestration, capability purchases, Razorpay checkout handoff.
- **Explainable / bounded / gated:** pricebook line items, policy checks, approval thresholds.
- **Audit trail:** `audit_events` table + UI.
- **Graceful failure:** duplicate webhook idempotency (`x-razorpay-event-id`).

## Quality checks

```bash
npm test
npm run lint
npm run build
npm audit
```

The test suite covers parsing, pricing, state transitions, x402 response shape,
idempotent checkout, paid revisions, private-bound negotiation, cross-sell
permissioning, mandate signatures, and A2A/UCP/ACP adapter behavior.

## License

MIT
