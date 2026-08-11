import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { assertInitialSchemaBaseline } from "./lib/postgres-schema-baseline.mjs";
import { parseMigrationTarget, selectMigrationFiles } from "./lib/migration-target.mjs";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const throughMigrationId = parseMigrationTarget(process.argv.slice(2));

if (!databaseUrl) {
  console.error("DATABASE_URL is required to apply the Vognary PostgreSQL schema.");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "infra", "postgres", "schema.sql");
const migrationsPath = path.join(root, "infra", "postgres", "migrations");
const schema = await readFile(schemaPath, "utf8");
const migrationFiles = selectMigrationFiles(await listMigrationFiles(), throughMigrationId);
const migrationLockId = 8_668_642_791;

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
    await assertTargetedRunUsesExistingSchema(client);
    await ensureMigrationLedger(client);
    const lock = await client.query("select pg_try_advisory_lock($1) as acquired", [migrationLockId]);
    if (lock.rows[0]?.acquired !== true) {
      throw new Error("Another schema migration runner already holds the Vognary migration lock.");
    }
    try {
      await applyInitialSchema(client);
      await applyPendingMigrations(client);
    } finally {
      await client.query("select pg_advisory_unlock($1)", [migrationLockId]);
    }
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
  // The consolidated schema is intentionally mutable for fresh databases, so
  // its baseline checksum is recorded but not compared on later runs. Forward
  // migration files are immutable and are verified below.
  if (await getMigrationChecksum(client, migrationId)) {
    await assertInitialSchemaBaseline(client);
    return;
  }

  const existingUsers = await client.query("select to_regclass('public.users') as table_name");
  if (existingUsers.rows[0]?.table_name) {
    await assertInitialSchemaBaseline(client);
    await recordMigration(client, migrationId, schema);
    applied.push({ id: migrationId, mode: "baseline-existing-schema" });
    return;
  }

  await client.query("begin");
  try {
    await client.query(schema);
    await assertInitialSchemaBaseline(client);
    await recordMigration(client, migrationId, schema);
    await client.query("commit");
    applied.push({ id: migrationId, mode: "applied-schema" });
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function applyPendingMigrations(client) {
  for (const file of migrationFiles) {
    const id = path.basename(file, ".sql");
    const sql = await readFile(path.join(migrationsPath, file), "utf8");
    const expectedChecksum = checksum(sql);
    const recordedChecksum = await getMigrationChecksum(client, id);
    if (recordedChecksum) {
      if (recordedChecksum !== expectedChecksum) {
        throw new Error(`Migration checksum mismatch for ${id}. Applied migrations are immutable; create a new forward migration.`);
      }
      continue;
    }

    await client.query("begin");
    try {
      await client.query("set local lock_timeout = '10s'");
      await client.query("set local statement_timeout = '120s'");
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

async function assertTargetedRunUsesExistingSchema(client) {
  if (!throughMigrationId) return;
  const result = await client.query("select to_regclass('public.users') as users");
  if (!result.rows[0]?.users) {
    throw new Error("--through is allowed only on an existing schema. Fresh databases must install the complete consolidated schema.");
  }
}

async function getMigrationChecksum(client, id) {
  const result = await client.query("select checksum from schema_migrations where id = $1", [id]);
  return result.rows[0]?.checksum ?? null;
}

async function recordMigration(client, id, sql) {
  await client.query(
    `insert into schema_migrations (id, checksum)
     values ($1, $2)`,
    [id, checksum(sql)],
  );
}

function checksum(value) {
  return createHash("sha256").update(value).digest("hex");
}
