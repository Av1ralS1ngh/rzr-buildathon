# SpecLock negotiation architecture

## Invariants

The negotiation engine is deterministic. Language models and external agents may
request or explain offers, but cannot authorize them.

1. Buyer budget and seller floors are stored separately from public offers.
2. Seller offers never fall below per-product floors or the bundle margin policy.
3. Buyer agents cannot submit or accept an offer outside their delegated budget.
4. Required quantities remain inside the buyer-authorized minimum and maximum.
5. Cross-sells are disabled unless the buyer explicitly permits them.
6. Every offer is immutable; only its lifecycle status changes.
7. Every counter references its parent offer and has a bounded expiry.
8. Negotiations stop after the seller policy's maximum round count.
9. Agreement creates signed checkout and payment mandates.
10. Payment amount, mandate hashes, accepted offer, and Razorpay order are bound
    by one commitment hash.

Buyer and seller agent rooms are separate environments over the same session.
`POST /api/negotiations/:id/counter` with `awaitSeller: true` records the buyer
offer and waits. `POST /api/negotiations/:id/respond` is the seller turn.
Default combined counters remain available for automated tests.

## Pricing authority

Each catalog product snapshots four values into every offer:

- manufacturing cost
- list price (opening anchor)
- target price
- absolute seller floor

The active seller policy adds maximum rounds, concession rate, maximum discount,
minimum bundle margin, offer expiry, and deposit percentage. Concessions increase
gradually per round. Commercial give-backs such as flexible delivery or a larger
deposit can unlock a small additional concession, but never bypass a floor.

## Cross-selling

Product relationships declare complements and substitutes. The bundle optimizer
only runs when the buyer's private policy allows cross-selling. It can generate:

- `add_on`: preserve requested quantities and add a complement
- `mix_shift`: reduce a requested item only to its authorized minimum and add a
  complementary product
- `substitute`: reserved for explicit substitution authority

Options are filtered by buyer budget, optional cross-sell budget, merchant
quantity rules, and minimum bundle margin. Selecting a bundle creates a new
immutable seller offer.

## Mandates

SpecLock currently creates ES256-signed, AP2-shaped mandate artifacts:

- `mandate.checkout.open.1`
- `mandate.payment.open.1`
- `speclock.seller-authority.1`
- `mandate.checkout.1`
- `mandate.payment.1`
- `speclock.payment-receipt.1`

Private payment limits are only returned to the processor audience. Seller
authority documents include floors and costs and are only available through the
internal authenticated endpoint. Public mandate endpoints expose shared checkout
artifacts.

The current profile follows AP2 v0.2 field names, `vct` values, checkout hash,
payment transaction reference, and ES256 signing. It uses compact ES256 JWS with
no selectively disclosed claims or delegated key-binding chain. It is therefore
an AP2 compatibility layer, not a claim of full AP2 conformance. Full AP2
requires the pinned canonical schemas, RFC 9901 disclosures, and delegated
SD-JWT key-binding conformance.

## Protocol surfaces

| Protocol | Endpoint | Role |
|---|---|---|
| A2A 1.0 | `/.well-known/agent-card.json`, `/a2a/v1/message:send` | Structured buyer/seller agent commands |
| UCP 2026-04-08 | `/.well-known/ucp`, `/ucp/v1/checkout-sessions/*` | Discovery and checkout |
| AP2 compatibility | `/api/ap2/mandates/:sessionId` | Signed mandate chain |
| ACP 2026-04-17 | `/.well-known/acp.json`, `/checkout_sessions/*` | OpenAI/Stripe checkout mapping |
| Razorpay | `/api/razorpay/webhook` | INR deposit settlement |
| x402 | `/api/capabilities/*` | Machine-paid verification services |

ACP capability negotiation is not price haggling. SpecLock exposes negotiation
as a namespaced ACP extension. Stripe Shared Payment Tokens are deliberately
rejected by the Razorpay handler because they cannot be charged across PSPs.

## Atomicity and idempotency

Each negotiation turn is one database transaction:

1. Validate active session and parent offer.
2. Validate buyer mandate constraints.
3. Insert immutable buyer offer.
4. Evaluate seller authority.
5. Accept, reject, or insert the seller counter.
6. Advance session state and append an event.
7. Store idempotency result.

Checkout creates one commerce order per agreed session. Repeated requests reuse
the same Razorpay order. Payment capture uses a conditional state transition and
creates a signed receipt in the same transaction.

## Postgres migration

The domain layer is isolated under `src/lib/commerce`. SQLite remains the local
runtime until the linked Neon project provides `DATABASE_URL`. The next storage
step is to implement the same transactional boundaries with Drizzle and
Lakebase Postgres, using the pooled URL at runtime and the direct URL for
migrations.
