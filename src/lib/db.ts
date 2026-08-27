import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.SPELOCK_DB_PATH ?? path.join(dataDir, "speclock.db");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS rfqs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    spec_json TEXT,
    artwork_hash TEXT,
    artwork_name TEXT,
    artwork_mime TEXT,
    artwork_size INTEGER,
    clarification_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY,
    rfq_id TEXT NOT NULL,
    line_items_json TEXT NOT NULL,
    total_paise INTEGER NOT NULL,
    deposit_paise INTEGER NOT NULL,
    spec_hash TEXT NOT NULL,
    artwork_hash TEXT,
    pricebook_version TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    requires_approval INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS commitments (
    id TEXT PRIMARY KEY,
    rfq_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    spec_hash TEXT NOT NULL,
    artwork_hash TEXT,
    quote_id TEXT NOT NULL,
    status TEXT NOT NULL,
    razorpay_order_id TEXT,
    razorpay_payment_id TEXT,
    previous_commitment_id TEXT,
    created_at INTEGER NOT NULL,
    commitment_hash TEXT,
    amount_paise INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS capability_receipts (
    id TEXT PRIMARY KEY,
    rfq_id TEXT NOT NULL,
    capability TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    payment_mode TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    rfq_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS webhook_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL DEFAULT 'unknown',
    processed_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS revisions (
    id TEXT PRIMARY KEY,
    rfq_id TEXT NOT NULL,
    base_commitment_id TEXT NOT NULL,
    quote_id TEXT NOT NULL UNIQUE,
    spec_json TEXT NOT NULL,
    status TEXT NOT NULL,
    delta_paise INTEGER NOT NULL,
    requires_approval INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (currency = 'INR'),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS merchant_products (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    unit TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (currency = 'INR'),
    cost_paise INTEGER NOT NULL CHECK (cost_paise >= 0),
    list_price_paise INTEGER NOT NULL,
    target_price_paise INTEGER NOT NULL,
    floor_price_paise INTEGER NOT NULL,
    min_quantity INTEGER NOT NULL CHECK (min_quantity > 0),
    max_quantity INTEGER NOT NULL CHECK (max_quantity >= min_quantity),
    quantity_step INTEGER NOT NULL DEFAULT 1 CHECK (quantity_step > 0),
    active INTEGER NOT NULL DEFAULT 1,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (merchant_id, sku),
    CHECK (
      list_price_paise >= target_price_paise
      AND target_price_paise >= floor_price_paise
      AND floor_price_paise >= cost_paise
    )
  );

  CREATE TABLE IF NOT EXISTS seller_policies (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'superseded')),
    max_rounds INTEGER NOT NULL CHECK (max_rounds BETWEEN 1 AND 20),
    offer_ttl_seconds INTEGER NOT NULL CHECK (offer_ttl_seconds BETWEEN 60 AND 604800),
    concession_bps_per_round INTEGER NOT NULL CHECK (concession_bps_per_round BETWEEN 0 AND 5000),
    max_discount_bps INTEGER NOT NULL CHECK (max_discount_bps BETWEEN 0 AND 9000),
    min_bundle_margin_bps INTEGER NOT NULL CHECK (min_bundle_margin_bps BETWEEN 0 AND 9000),
    deposit_bps INTEGER NOT NULL CHECK (deposit_bps BETWEEN 0 AND 10000),
    created_at INTEGER NOT NULL,
    UNIQUE (merchant_id, version)
  );

  CREATE TABLE IF NOT EXISTS negotiation_sessions (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    buyer_agent_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('open', 'agreed', 'rejected', 'expired', 'cancelled')
    ),
    currency TEXT NOT NULL CHECK (currency = 'INR'),
    seller_policy_id TEXT NOT NULL REFERENCES seller_policies(id),
    current_round INTEGER NOT NULL DEFAULT 0,
    accepted_offer_id TEXT,
    delivery_date TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS negotiation_private_terms (
    session_id TEXT PRIMARY KEY REFERENCES negotiation_sessions(id) ON DELETE CASCADE,
    buyer_max_total_paise INTEGER NOT NULL CHECK (buyer_max_total_paise > 0),
    buyer_max_deposit_paise INTEGER,
    allow_cross_sell INTEGER NOT NULL DEFAULT 0,
    cross_sell_budget_paise INTEGER,
    allowed_cross_sell_json TEXT NOT NULL DEFAULT '[]',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS negotiation_requirements (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES negotiation_sessions(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES merchant_products(id),
    min_quantity INTEGER NOT NULL CHECK (min_quantity >= 0),
    target_quantity INTEGER NOT NULL CHECK (target_quantity >= min_quantity),
    max_quantity INTEGER NOT NULL CHECK (max_quantity >= target_quantity),
    required INTEGER NOT NULL DEFAULT 1,
    substitutions_allowed INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
    created_at INTEGER NOT NULL,
    UNIQUE (session_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS negotiation_offers (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES negotiation_sessions(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    round INTEGER NOT NULL,
    actor TEXT NOT NULL CHECK (actor IN ('buyer', 'seller')),
    parent_offer_id TEXT REFERENCES negotiation_offers(id),
    status TEXT NOT NULL CHECK (
      status IN ('active', 'countered', 'accepted', 'rejected', 'expired')
    ),
    total_paise INTEGER NOT NULL CHECK (total_paise >= 0),
    delivery_date TEXT,
    deposit_bps INTEGER NOT NULL CHECK (deposit_bps BETWEEN 0 AND 10000),
    explanation TEXT NOT NULL,
    terms_json TEXT NOT NULL DEFAULT '{}',
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (session_id, sequence)
  );

  CREATE TABLE IF NOT EXISTS negotiation_offer_items (
    id TEXT PRIMARY KEY,
    offer_id TEXT NOT NULL REFERENCES negotiation_offers(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES merchant_products(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise >= 0),
    cost_snapshot_paise INTEGER NOT NULL CHECK (cost_snapshot_paise >= 0),
    list_snapshot_paise INTEGER NOT NULL CHECK (list_snapshot_paise >= cost_snapshot_paise),
    target_snapshot_paise INTEGER NOT NULL CHECK (target_snapshot_paise >= floor_snapshot_paise),
    floor_snapshot_paise INTEGER NOT NULL CHECK (floor_snapshot_paise >= cost_snapshot_paise),
    source TEXT NOT NULL CHECK (source IN ('requested', 'cross_sell', 'substitute')),
    created_at INTEGER NOT NULL,
    UNIQUE (offer_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS negotiation_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES negotiation_sessions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS product_relationships (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    source_product_id TEXT NOT NULL REFERENCES merchant_products(id) ON DELETE CASCADE,
    target_product_id TEXT NOT NULL REFERENCES merchant_products(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL CHECK (
      relationship_type IN ('complement', 'substitute')
    ),
    relevance_score INTEGER NOT NULL CHECK (relevance_score BETWEEN 0 AND 100),
    bundle_discount_bps INTEGER NOT NULL CHECK (bundle_discount_bps BETWEEN 0 AND 9000),
    attach_quantity INTEGER NOT NULL CHECK (attach_quantity > 0),
    active INTEGER NOT NULL DEFAULT 1,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    UNIQUE (source_product_id, target_product_id, relationship_type)
  );

  CREATE TABLE IF NOT EXISTS bundle_options (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES negotiation_sessions(id) ON DELETE CASCADE,
    parent_offer_id TEXT NOT NULL REFERENCES negotiation_offers(id),
    status TEXT NOT NULL CHECK (
      status IN ('active', 'selected', 'expired', 'dismissed')
    ),
    strategy TEXT NOT NULL CHECK (
      strategy IN ('add_on', 'mix_shift', 'substitute')
    ),
    total_paise INTEGER NOT NULL CHECK (total_paise >= 0),
    explanation TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bundle_option_items (
    id TEXT PRIMARY KEY,
    bundle_id TEXT NOT NULL REFERENCES bundle_options(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES merchant_products(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise >= 0),
    source TEXT NOT NULL CHECK (source IN ('requested', 'cross_sell', 'substitute')),
    created_at INTEGER NOT NULL,
    UNIQUE (bundle_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS mandate_artifacts (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES negotiation_sessions(id) ON DELETE CASCADE,
    mandate_type TEXT NOT NULL,
    vct TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('open', 'closed', 'receipt', 'revoked')),
    visibility TEXT NOT NULL CHECK (
      visibility IN ('buyer', 'seller', 'processor', 'shared')
    ),
    issuer TEXT NOT NULL,
    audience TEXT NOT NULL,
    parent_mandate_id TEXT REFERENCES mandate_artifacts(id),
    payload_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    compact_jws TEXT NOT NULL,
    algorithm TEXT NOT NULL CHECK (algorithm = 'ES256'),
    key_id TEXT NOT NULL,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    verified_at INTEGER,
    created_at INTEGER NOT NULL,
    UNIQUE (session_id, mandate_type, state)
  );

  CREATE TABLE IF NOT EXISTS commerce_orders (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE REFERENCES negotiation_sessions(id),
    accepted_offer_id TEXT NOT NULL REFERENCES negotiation_offers(id),
    checkout_mandate_id TEXT NOT NULL REFERENCES mandate_artifacts(id),
    payment_mandate_id TEXT NOT NULL REFERENCES mandate_artifacts(id),
    status TEXT NOT NULL CHECK (
      status IN ('preparing', 'payment_pending', 'paid', 'failed', 'refunded')
    ),
    currency TEXT NOT NULL CHECK (currency = 'INR'),
    amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
    commitment_hash TEXT NOT NULL,
    razorpay_order_id TEXT UNIQUE,
    razorpay_payment_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS idempotency_keys (
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    request_hash TEXT,
    response_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (scope, key)
  );

  CREATE INDEX IF NOT EXISTS idx_quotes_rfq_created ON quotes(rfq_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_commitments_rfq_version ON commitments(rfq_id, version DESC);
  CREATE INDEX IF NOT EXISTS idx_receipts_rfq_created ON capability_receipts(rfq_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_rfq_created ON audit_events(rfq_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_revisions_rfq_created ON revisions(rfq_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_products_merchant_category
    ON merchant_products(merchant_id, category, active);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_policy_active
    ON seller_policies(merchant_id) WHERE status = 'active';
  CREATE INDEX IF NOT EXISTS idx_negotiations_merchant_status
    ON negotiation_sessions(merchant_id, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_negotiation_offers_session
    ON negotiation_offers(session_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_negotiation_events_session
    ON negotiation_events(session_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_relationships_source
    ON product_relationships(source_product_id, relationship_type, relevance_score DESC);
  CREATE INDEX IF NOT EXISTS idx_bundle_options_session
    ON bundle_options(session_id, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_mandates_session
    ON mandate_artifacts(session_id, issued_at);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_mandates_payload_hash
    ON mandate_artifacts(payload_hash, mandate_type);
  CREATE INDEX IF NOT EXISTS idx_commerce_orders_status
    ON commerce_orders(status, created_at);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_commitments_order
    ON commitments(razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;
`);

// Additive migrations keep databases created by earlier hackathon builds usable.
const migrations = [
  `ALTER TABLE rfqs ADD COLUMN artwork_name TEXT`,
  `ALTER TABLE rfqs ADD COLUMN artwork_mime TEXT`,
  `ALTER TABLE rfqs ADD COLUMN artwork_size INTEGER`,
  `ALTER TABLE rfqs ADD COLUMN updated_at INTEGER`,
  `ALTER TABLE quotes ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`,
  `ALTER TABLE quotes ADD COLUMN requires_approval INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE quotes ADD COLUMN artwork_hash TEXT`,
  `ALTER TABLE commitments ADD COLUMN commitment_hash TEXT`,
  `ALTER TABLE commitments ADD COLUMN amount_paise INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE webhook_events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'unknown'`,
  `ALTER TABLE negotiation_offer_items ADD COLUMN list_snapshot_paise INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE negotiation_offer_items ADD COLUMN target_snapshot_paise INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE negotiation_private_terms ADD COLUMN allow_cross_sell INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE negotiation_private_terms ADD COLUMN cross_sell_budget_paise INTEGER`,
  `ALTER TABLE negotiation_private_terms ADD COLUMN allowed_cross_sell_json TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE idempotency_keys ADD COLUMN request_hash TEXT`,
];

for (const migration of migrations) {
  try {
    db.exec(migration);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("duplicate column name")) {
      throw error;
    }
  }
}

db.prepare(`UPDATE rfqs SET updated_at = created_at WHERE updated_at IS NULL`).run();

// Earlier builds could create more than one checkout commitment per quote.
// Keep a locked commitment when one exists, otherwise keep the newest attempt.
db.exec(`
  WITH ranked AS (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY quote_id
        ORDER BY CASE WHEN status = 'locked' THEN 0 ELSE 1 END, created_at DESC, id DESC
      ) AS position
    FROM commitments
  )
  UPDATE commitments
  SET status = 'superseded'
  WHERE id IN (SELECT id FROM ranked WHERE position > 1);

  DROP INDEX IF EXISTS idx_commitments_quote;
  CREATE UNIQUE INDEX idx_commitments_quote
    ON commitments(quote_id) WHERE status <> 'superseded';
`);

export default db;
