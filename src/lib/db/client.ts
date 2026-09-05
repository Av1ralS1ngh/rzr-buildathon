import { AsyncLocalStorage } from "async_hooks";
import {
  neonConfig,
  Pool,
  types,
  type PoolClient,
} from "@neondatabase/serverless";
import fs from "fs";
import path from "path";
import { SCHEMA_SQL } from "./schema";

type RunResult = { changes: number };

type Statement = {
  run: (...params: unknown[]) => Promise<RunResult>;
  get: <T = Record<string, unknown>>(
    ...params: unknown[]
  ) => Promise<T | undefined>;
  all: <T = Record<string, unknown>>(
    ...params: unknown[]
  ) => Promise<T[]>;
};

type SqliteDatabase = {
  pragma: (value: string) => unknown;
  exec: (sql: string) => unknown;
  prepare: (sql: string) => {
    run: (...params: unknown[]) => { changes: number };
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
  };
};

const SQLITE_MIGRATIONS = [
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
  `ALTER TABLE rfqs ADD COLUMN artwork_preflight_json TEXT`,
  `ALTER TABLE rfqs ADD COLUMN product_id TEXT`,
];

types.setTypeParser(20, (value) => Number(value));
types.setTypeParser(23, (value) => Number(value));
if (typeof globalThis.WebSocket !== "undefined") {
  neonConfig.webSocketConstructor = globalThis.WebSocket;
}
neonConfig.poolQueryViaFetch = true;

function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL?.trim() || undefined;
}

function postgresEnabled(): boolean {
  return Boolean(databaseUrl());
}

function requirePostgresInProduction(): void {
  if (
    !databaseUrl() &&
    (process.env.VERCEL === "1" || process.env.NODE_ENV === "production")
  ) {
    throw new Error(
      "DATABASE_URL is required in production. SpecLock cannot use SQLite on Vercel."
    );
  }
}

function toPg(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function adaptSql(sql: string): string {
  return postgresEnabled() ? toPg(sql) : sql;
}

function schemaStatements(): string[] {
  return SCHEMA_SQL.split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => `${statement};`);
}

function coerceRow<T>(row: T): T {
  if (!row || typeof row !== "object") return row;
  const next = { ...(row as Record<string, unknown>) };
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === "string" && /^-?\d+$/.test(value)) {
      if (
        key.endsWith("_paise") ||
        key.endsWith("_at") ||
        key.endsWith("_bps") ||
        key.endsWith("_seconds") ||
        [
          "version",
          "current_round",
          "quantity",
          "min_quantity",
          "max_quantity",
          "quantity_step",
          "active",
          "required",
          "requires_approval",
          "artwork_size",
          "priority",
          "sequence",
          "round",
          "relevance_score",
          "attach_quantity",
          "max_rounds",
          "substitutions_allowed",
          "min_moq",
        ].includes(key)
      ) {
        next[key] = Number(value);
      }
    }
  }
  return next as T;
}

class DatabaseClient {
  private sqlite: SqliteDatabase | null = null;
  private pool: Pool | null = null;
  private schemaReady: Promise<void> | null = null;
  private readonly pgTxStore = new AsyncLocalStorage<PoolClient>();
  private readonly sqliteTxStore = new AsyncLocalStorage<boolean>();

  private async getSqlite(): Promise<SqliteDatabase> {
    if (!this.sqlite) {
      const { default: Database } = await import("better-sqlite3");
      const dataDir = path.join(process.cwd(), "data");
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const dbPath =
        process.env.SPELOCK_DB_PATH ?? path.join(dataDir, "speclock.db");
      const sqlite = new Database(dbPath) as unknown as SqliteDatabase;
      sqlite.pragma("journal_mode = WAL");
      sqlite.pragma("foreign_keys = ON");
      sqlite.pragma("busy_timeout = 5000");
      this.sqlite = sqlite;
    }
    return this.sqlite;
  }

  private getPool(): Pool {
    const connectionString = databaseUrl();
    if (!connectionString) {
      throw new Error("DATABASE_URL is not configured");
    }
    if (!this.pool) {
      this.pool = new Pool({ connectionString, max: 5 });
    }
    return this.pool;
  }

  private async initSchema(): Promise<void> {
    requirePostgresInProduction();
    if (!this.schemaReady) {
      this.schemaReady = this.bootstrapSchema().catch((error) => {
        this.schemaReady = null;
        throw error;
      });
    }
    await this.schemaReady;
  }

  private async bootstrapSchema(): Promise<void> {
    if (postgresEnabled()) {
      const pool = this.getPool();
      for (const statement of schemaStatements()) {
        await pool.query(statement);
      }
      await pool.query(
        `ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS artwork_preflight_json TEXT`
      );
      await pool.query(
        `ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS product_id TEXT`
      );
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_rfqs_product ON rfqs(product_id)`
      );
      return;
    }

    const sqlite = await this.getSqlite();
    sqlite.exec(SCHEMA_SQL);

    for (const migration of SQLITE_MIGRATIONS) {
      try {
        sqlite.exec(migration);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("duplicate column name")
        ) {
          throw error;
        }
      }
    }

    sqlite
      .prepare(`UPDATE rfqs SET updated_at = created_at WHERE updated_at IS NULL`)
      .run();

    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_rfqs_product ON rfqs(product_id)`);

    sqlite.exec(`
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
      CREATE UNIQUE INDEX IF NOT EXISTS idx_commitments_quote
        ON commitments(quote_id) WHERE status <> 'superseded';
    `);
  }

  async exec(sql: string): Promise<void> {
    await this.initSchema();
    if (postgresEnabled()) {
      const client = this.pgTxStore.getStore() ?? this.getPool();
      for (const statement of sql
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)) {
        await client.query(statement);
      }
      return;
    }
    (await this.getSqlite()).exec(sql);
  }

  prepare(sql: string): Statement {
    const adapted = adaptSql(sql);
    return {
      run: async (...params: unknown[]) => {
        await this.initSchema();
        if (postgresEnabled()) {
          const client = this.pgTxStore.getStore() ?? this.getPool();
          const result = await client.query(adapted, params);
          return { changes: result.rowCount ?? 0 };
        }
        const result = (await this.getSqlite()).prepare(sql).run(...params);
        return { changes: result.changes };
      },
      get: async <T = Record<string, unknown>>(...params: unknown[]) => {
        await this.initSchema();
        if (postgresEnabled()) {
          const client = this.pgTxStore.getStore() ?? this.getPool();
          const result = await client.query(adapted, params);
          return result.rows[0] ? coerceRow(result.rows[0] as T) : undefined;
        }
        return (await this.getSqlite()).prepare(sql).get(...params) as
          | T
          | undefined;
      },
      all: async <T = Record<string, unknown>>(...params: unknown[]) => {
        await this.initSchema();
        if (postgresEnabled()) {
          const client = this.pgTxStore.getStore() ?? this.getPool();
          const result = await client.query(adapted, params);
          return (result.rows as T[]).map((row) => coerceRow(row));
        }
        return (await this.getSqlite()).prepare(sql).all(...params) as T[];
      },
    };
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.initSchema();
    if (postgresEnabled()) {
      if (this.pgTxStore.getStore()) {
        return await fn();
      }

      const pool = this.getPool();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await this.pgTxStore.run(client, async () => {
          const value = await fn();
          await client.query("COMMIT");
          return value;
        });
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The connection may already be closed.
        }
        throw error;
      } finally {
        client.release();
      }
    }

    if (this.sqliteTxStore.getStore()) {
      return await fn();
    }

    const sqlite = await this.getSqlite();
    return await this.sqliteTxStore.run(true, async () => {
      sqlite.exec("BEGIN");
      try {
        const result = await fn();
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    });
  }
}

const db = new DatabaseClient();
export default db;
