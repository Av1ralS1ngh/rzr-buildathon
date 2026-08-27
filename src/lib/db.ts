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

  CREATE INDEX IF NOT EXISTS idx_quotes_rfq_created ON quotes(rfq_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_commitments_rfq_version ON commitments(rfq_id, version DESC);
  CREATE INDEX IF NOT EXISTS idx_receipts_rfq_created ON capability_receipts(rfq_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_rfq_created ON audit_events(rfq_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_revisions_rfq_created ON revisions(rfq_id, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_commitments_quote ON commitments(quote_id);
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

export default db;
