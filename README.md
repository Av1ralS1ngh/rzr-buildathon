# SpecLock

Checkout for custom labels in the agent economy. Humans pay production deposits in INR via Razorpay. Buyer agents pay invisible x402 micropayments for verification capabilities they cannot self-generate.

Built for **Razorpay AI Buildathon — Track 01: AI Growth & Agentic Commerce**.

## Problem

Custom food and cosmetics labels do not have SKUs. Before checkout, someone must clarify specs, check compliance fields, validate artwork, confirm factory capacity, and price deterministically. AI buyers can request quotes all day but cannot safely certify those steps alone.

## Solution

1. Buyer submits messy RFQ (web UI simulates buyer agent).
2. SpecLock parses spec and asks clarifying questions when needed.
3. **Agent orchestrator** purchases three capabilities (x402-gated HTTP APIs):
   - `label-rules` — required declaration field checklist
   - `print-check` — artwork print-readiness heuristics
   - `capacity` — merchant MOQ and ship-date feasibility
4. Deterministic **pricebook** generates quote (LLM never sets price).
5. Human pays **deposit via Razorpay** Standard Checkout (test mode).
6. **Spec Commitment** binds payment to spec hash; production locks.
7. Full **audit trail** for judges and merchants.

Humans never see crypto. x402 is only for machine verification.

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
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Optional* | Test Orders + Checkout |
| `RAZORPAY_WEBHOOK_SECRET` | Optional | Webhook HMAC verification |
| `SPELOCK_INTERNAL_SECRET` | Recommended | Orchestrator → capability internal auth |
| `X402_DEMO_AGENT_KEY` | Optional | Demo agent header for capability APIs |
| `CDP_API_KEY_*` | Optional | Full on-chain x402 settlement |

\*Without Razorpay keys, checkout runs in **mock mode** (still demonstrates idempotent deposit capture).

## Demo flow

1. Home → submit sample pickle label RFQ.
2. Open RFQ → **Run agent verification** (orchestrator + capability receipts).
3. **Pay deposit** → Razorpay test checkout or mock capture.
4. Merchant dashboard → see status and commitment.
5. Audit log shows capability purchases and payment events.

## API overview

| Endpoint | Description |
|---|---|
| `POST /api/rfq` | Create RFQ from raw text |
| `GET /api/rfq/:id` | RFQ, quote, receipts, audit |
| `POST /api/rfq/:id/orchestrate` | Run capability mesh + quote |
| `POST /api/rfq/:id/checkout` | Create Razorpay order for deposit |
| `POST /api/rfq/:id/revision` | Propose priced spec revision |
| `POST /api/capabilities/*` | x402-gated capability providers |
| `POST /api/razorpay/webhook` | Webhook + client confirm |
| `GET /api/merchant/rfqs` | Merchant queue |

## x402 capability APIs

Return `402 Payment Required` with `PAYMENT-REQUIRED` header unless authorized via:

- `PAYMENT-SIGNATURE` (x402 client)
- `X-Demo-Agent-Key` (hackathon demo)
- `X-Speclock-Internal` (orchestrator)

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Track 01 alignment

- **Merchant revenue:** faster quote path, technical upsell, deposit capture, revision deltas.
- **AI buyer end-to-end:** agent orchestration, capability purchases, Razorpay checkout handoff.
- **Explainable / bounded / gated:** pricebook line items, policy checks, approval thresholds.
- **Audit trail:** `audit_events` table + UI.
- **Graceful failure:** duplicate webhook idempotency (`x-razorpay-event-id`).

## License

MIT
