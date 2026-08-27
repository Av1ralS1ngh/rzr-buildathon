import { Pool } from "@neondatabase/serverless";
import { SCHEMA_SQL } from "../src/lib/db/schema.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({ connectionString });
await pool.query(SCHEMA_SQL);
await pool.end();
console.log("Database schema initialized");
