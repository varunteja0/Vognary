import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required to apply the Vognary PostgreSQL schema.");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "infra", "postgres", "schema.sql");
const schema = await readFile(schemaPath, "utf8");

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.POSTGRES_SSL === "true" ? {
    ca: process.env.POSTGRES_CA_CERT || undefined,
    rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== "false",
  } : undefined,
});

try {
  await pool.query(schema);
  console.log(JSON.stringify({ status: "ok", schema: schemaPath }, null, 2));
} finally {
  await pool.end();
}
