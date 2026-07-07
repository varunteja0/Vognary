import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
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
const migrationsPath = path.join(root, "infra", "postgres", "migrations");
const schema = await readFile(schemaPath, "utf8");

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.POSTGRES_SSL === "true" ? {
    ca: process.env.POSTGRES_CA_CERT || undefined,
    rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== "false",
  } : undefined,
});

const applied = [];

try {
  const client = await pool.connect();
  try {
    await ensureMigrationLedger(client);
    await applyInitialSchema(client);
    await applyPendingMigrations(client);
  } finally {
    client.release();
  }

  console.log(JSON.stringify({ status: "ok", schema: schemaPath, migrationsPath, applied }, null, 2));
} finally {
  await pool.end();
}

async function ensureMigrationLedger(client) {
  await client.query(
    `create table if not exists schema_migrations (
       id text primary key,
       checksum text not null,
       applied_at timestamptz not null default now()
     )`,
  );
}

async function applyInitialSchema(client) {
  const migrationId = "0001_initial_schema";
  if (await hasMigration(client, migrationId)) return;

  const existingUsers = await client.query("select to_regclass('public.users') as table_name");
  if (existingUsers.rows[0]?.table_name) {
    await recordMigration(client, migrationId, schema);
    applied.push({ id: migrationId, mode: "baseline-existing-schema" });
    return;
  }

  await client.query("begin");
  try {
    await client.query(schema);
    await recordMigration(client, migrationId, schema);
    await client.query("commit");
    applied.push({ id: migrationId, mode: "applied-schema" });
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function applyPendingMigrations(client) {
  const files = await listMigrationFiles();

  for (const file of files) {
    const id = path.basename(file, ".sql");
    if (await hasMigration(client, id)) continue;

    const sql = await readFile(path.join(migrationsPath, file), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await recordMigration(client, id, sql);
      await client.query("commit");
      applied.push({ id, mode: "applied-migration" });
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
}

async function listMigrationFiles() {
  try {
    const entries = await readdir(migrationsPath);
    return entries.filter((entry) => /^\d{4}_.+\.sql$/.test(entry)).sort();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function hasMigration(client, id) {
  const result = await client.query("select 1 from schema_migrations where id = $1", [id]);
  return Boolean(result.rowCount);
}

async function recordMigration(client, id, sql) {
  await client.query(
    `insert into schema_migrations (id, checksum)
     values ($1, $2)
     on conflict (id) do nothing`,
    [id, checksum(sql)],
  );
}

function checksum(value) {
  return createHash("sha256").update(value).digest("hex");
}
