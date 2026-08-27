import { AsyncLocalStorage } from "async_hooks";
import Database from "better-sqlite3";
import { Pool, type PoolClient } from "@neondatabase/serverless";
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
];

function usePostgres(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function toPg(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function adaptSql(sql: string): string {
  if (!usePostgres()) return sql;
  return toPg(sql);
}

class DatabaseClient {
  private sqlite: Database.Database | null = null;
  private pool: Pool | null = null;
  private schemaReady: Promise<void> | null = null;
  private readonly pgTxStore = new AsyncLocalStorage<PoolClient>();
  private readonly sqliteTxStore = new AsyncLocalStorage<boolean>();

  private getSqlite(): Database.Database {
    if (!this.sqlite) {
      const dataDir = path.join(process.cwd(), "data");
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const dbPath =
        process.env.SPELOCK_DB_PATH ?? path.join(dataDir, "speclock.db");
      this.sqlite = new Database(dbPath);
      this.sqlite.pragma("journal_mode = WAL");
      this.sqlite.pragma("foreign_keys = ON");
      this.sqlite.pragma("busy_timeout = 5000");
    }
    return this.sqlite;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
    }
    return this.pool;
  }

  private async initSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.bootstrapSchema();
    }
    await this.schemaReady;
  }

  private async bootstrapSchema(): Promise<void> {
    if (usePostgres()) {
      const pool = this.getPool();
      await pool.query(SCHEMA_SQL);
      return;
    }

    const sqlite = this.getSqlite();
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
    if (usePostgres()) {
      const client = this.pgTxStore.getStore() ?? this.getPool();
      await client.query(adaptSql(sql));
      return;
    }
    this.getSqlite().exec(sql);
  }

  prepare(sql: string): Statement {
    const adapted = adaptSql(sql);
    return {
      run: async (...params: unknown[]) => {
        await this.initSchema();
        if (usePostgres()) {
          const client = this.pgTxStore.getStore() ?? this.getPool();
          const result = await client.query(adapted, params);
          return { changes: result.rowCount ?? 0 };
        }
        const result = this.getSqlite().prepare(sql).run(...params);
        return { changes: result.changes };
      },
      get: async <T = Record<string, unknown>>(...params: unknown[]) => {
        await this.initSchema();
        if (usePostgres()) {
          const client = this.pgTxStore.getStore() ?? this.getPool();
          const result = await client.query(adapted, params);
          return result.rows[0] as T | undefined;
        }
        return this.getSqlite().prepare(sql).get(...params) as T | undefined;
      },
      all: async <T = Record<string, unknown>>(...params: unknown[]) => {
        await this.initSchema();
        if (usePostgres()) {
          const client = this.pgTxStore.getStore() ?? this.getPool();
          const result = await client.query(adapted, params);
          return result.rows as T[];
        }
        return this.getSqlite().prepare(sql).all(...params) as T[];
      },
    };
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.initSchema();
    if (usePostgres()) {
      if (this.pgTxStore.getStore()) {
        return await fn();
      }

      const pool = this.getPool();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        return await this.pgTxStore.run(client, async () => {
          const result = await fn();
          await client.query("COMMIT");
          return result;
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    if (this.sqliteTxStore.getStore()) {
      return await fn();
    }

    const sqlite = this.getSqlite();
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
