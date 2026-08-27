import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "speclock.db");

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS rfqs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    spec_json TEXT,
    artwork_hash TEXT,
    clarification_json TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY,
    rfq_id TEXT NOT NULL,
    line_items_json TEXT NOT NULL,
    total_paise INTEGER NOT NULL,
    deposit_paise INTEGER NOT NULL,
    spec_hash TEXT NOT NULL,
    pricebook_version TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
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
    created_at INTEGER NOT NULL
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
    processed_at INTEGER NOT NULL
  );
`);

export default db;
