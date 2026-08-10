import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { Pool } from "pg";

const root = fileURLToPath(new URL("../../", import.meta.url));
const databaseUrl = process.env.DATABASE_URL;
const databaseConfigured = Boolean(databaseUrl);
const recoveryRelations = [
  "recovery_workspace_states",
  "recovery_workspace_versions",
  "recovery_submissions",
  "recovery_sources",
  "recovery_commitments",
  "recovery_evidence",
  "recovery_commitment_evidence",
  "recovery_corrections",
  "recovery_decisions",
  "recovery_changes",
  "recovery_idempotency_keys",
] as const;

test("the real migration runner installs and records Recovery v1 on a fresh database", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("recovery_fresh", async (connectionString) => {
    const result = runMigrations(connectionString);
    assert.equal(result.applied.at(-1)?.id, "0023_recovery_v1");

    const pool = createPool(connectionString);
    try {
      const migrations = await pool.query<{ id: string }>(
        `select id from schema_migrations order by id`,
      );
      assert.equal(migrations.rows.at(-1)?.id, "0023_recovery_v1");
      assert.equal(migrations.rows.length, 23);
      await assertRecoveryRelations(pool);
    } finally {
      await pool.end();
    }
  });
});

test("the real migration runner upgrades an existing 0022 database without losing legacy state", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("recovery_upgrade", async (connectionString) => {
    const seedPool = createPool(connectionString);
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const recurringItemId = randomUUID();

    try {
      await seedSchemaThrough0022(seedPool);
      await seedLegacyState(seedPool, { userId, workspaceId, recurringItemId });
    } finally {
      await seedPool.end();
    }

    const result = runMigrations(connectionString);
    assert.deepEqual(result.applied, [{ id: "0023_recovery_v1", mode: "applied-migration" }]);

    const verifyPool = createPool(connectionString);
    try {
      const migration = await verifyPool.query<{ id: string }>(
        `select id from schema_migrations where id = '0023_recovery_v1'`,
      );
      assert.equal(migration.rowCount, 1);
      await assertRecoveryRelations(verifyPool);

      const preserved = await verifyPool.query<{
        users: string;
        workspaces: string;
        recurring_items: string;
        evidence_links: string;
        commitment_decisions: string;
        workspace_states: string;
        retention_runs: string;
      }>(
        `select
           (select count(*)::text from users where id = $1) as users,
           (select count(*)::text from workspaces where id = $2) as workspaces,
           (select count(*)::text from recurring_items where id = $3) as recurring_items,
           (select count(*)::text from evidence_links where recurring_item_id = $3) as evidence_links,
           (select count(*)::text from commitment_decisions where recurring_item_id = $3) as commitment_decisions,
           (select count(*)::text from workspace_states where workspace_id = $2) as workspace_states,
           (select count(*)::text from retention_runs where workspace_id = $2) as retention_runs`,
        [userId, workspaceId, recurringItemId],
      );
      assert.deepEqual(preserved.rows[0], {
        users: "1",
        workspaces: "1",
        recurring_items: "1",
        evidence_links: "1",
        commitment_decisions: "1",
        workspace_states: "1",
        retention_runs: "1",
      });

      await assert.doesNotReject(
        verifyPool.query(
          `update retention_runs
           set counts = counts || '{"recoveryRawEvidenceMinimized": 0}'::jsonb
           where workspace_id = $1`,
          [workspaceId],
        ),
      );
    } finally {
      await verifyPool.end();
    }
  });
});

async function withDisposableDatabase(
  label: string,
  run: (connectionString: string) => Promise<void>,
) {
  assert.ok(databaseUrl);
  const databaseName = `${label}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const adminPool = createPool(databaseUrl);
  try {
    await adminPool.query(`create database ${quoteIdentifier(databaseName)}`);
    await run(databaseConnectionString(databaseUrl, databaseName));
  } finally {
    await adminPool.query(`drop database if exists ${quoteIdentifier(databaseName)} with (force)`);
    await adminPool.end();
  }
}

function runMigrations(connectionString: string) {
  const output = execFileSync(process.execPath, ["scripts/apply-postgres-schema.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
      POSTGRES_SSL: "false",
    },
  });
  return JSON.parse(output) as {
    applied: Array<{ id: string; mode: string }>;
  };
}

async function seedSchemaThrough0022(pool: Pool) {
  const schema = readFileSync(path.join(root, "infra/postgres/schema.sql"), "utf8");
  const recoveryMarker = "\n-- Recovery v1:";
  const markerIndex = schema.indexOf(recoveryMarker);
  assert.ok(markerIndex > 0, "consolidated schema must contain the Recovery v1 boundary");
  const schemaThrough0022 = schema
    .slice(0, markerIndex)
    .replace("      'recoveryRawEvidenceMinimized',\n", "")
    .replace("      and coalesce(jsonb_typeof(counts -> 'recoveryRawEvidenceMinimized') = 'number', true)\n", "");
  assert.equal(
    /recoveryRawEvidenceMinimized|recovery_workspace_states/.test(schemaThrough0022),
    false,
    "the synthetic 0022 schema must not contain Recovery v1 capabilities",
  );

  await pool.query(schemaThrough0022);
  await pool.query(
    `create table schema_migrations (
       id text primary key,
       checksum text not null,
       applied_at timestamptz not null default now()
     )`,
  );
  await pool.query(
    `insert into schema_migrations (id, checksum) values ($1, $2)`,
    ["0001_initial_schema", checksum(schema)],
  );

  const migrationsPath = path.join(root, "infra/postgres/migrations");
  for (const file of readdirSync(migrationsPath).filter((entry) => /^00(?:0[2-9]|1\d|2[0-2])_.+\.sql$/.test(entry)).sort()) {
    const sql = readFileSync(path.join(migrationsPath, file), "utf8");
    await pool.query(
      `insert into schema_migrations (id, checksum) values ($1, $2)`,
      [path.basename(file, ".sql"), checksum(sql)],
    );
  }
}

async function seedLegacyState(
  pool: Pool,
  ids: { userId: string; workspaceId: string; recurringItemId: string },
) {
  await pool.query(
    `insert into users (id, email, display_name) values ($1, $2, 'Migration User')`,
    [ids.userId, `${ids.userId}@migration.test`],
  );
  await pool.query(
    `insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Migration Workspace')`,
    [ids.workspaceId, ids.userId],
  );
  await pool.query(
    `insert into recurring_items (
       id, workspace_id, merchant, normalized_merchant, category, frequency,
       currency, amount_min, amount_max, average_amount, monthly_cost,
       annual_cost, confidence_score, status
     ) values ($1, $2, 'Legacy Merchant', 'legacy merchant', 'Software', 'monthly',
       'INR', 499, 499, 499, 499, 5988, 95, 'keep')`,
    [ids.recurringItemId, ids.workspaceId],
  );
  await pool.query(
    `insert into evidence_links (recurring_item_id, evidence_type, evidence_text, amount)
     values ($1, 'receipt', 'Redacted legacy receipt', 499)`,
    [ids.recurringItemId],
  );
  await pool.query(
    `insert into commitment_decisions (workspace_id, recurring_item_id, decided_by_user_id, action)
     values ($1, $2, $3, 'keep')`,
    [ids.workspaceId, ids.recurringItemId, ids.userId],
  );
  await pool.query(
    `insert into workspace_states (workspace_id, encrypted_snapshot, summary, updated_by_user_id)
     values ($1, '{"ciphertext":"redacted"}'::jsonb, '{"commitments":1}'::jsonb, $2)`,
    [ids.workspaceId, ids.userId],
  );
  await pool.query(
    `insert into retention_runs (workspace_id, invocation, dry_run, status, counts)
     values ($1, 'cron', false, 'completed', '{"connectorEvidencePayloadsMinimized":0}'::jsonb)`,
    [ids.workspaceId],
  );
}

async function assertRecoveryRelations(pool: Pool) {
  const result = await pool.query<{ table_name: string }>(
    `select table_name
     from information_schema.tables
     where table_schema = 'public' and table_name = any($1::text[])
     order by table_name`,
    [[...recoveryRelations]],
  );
  assert.deepEqual(result.rows.map((row) => row.table_name), [...recoveryRelations].sort());
}

function databaseConnectionString(connectionString: string, databaseName: string) {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function createPool(connectionString: string) {
  return new Pool({ connectionString, ssl: false });
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function checksum(value: string) {
  return createHash("sha256").update(value).digest("hex");
}