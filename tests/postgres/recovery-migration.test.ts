import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { Pool } from "pg";

import { migrateLegacyRecovery } from "../../scripts/lib/migrate-legacy-recovery";

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
  "recovery_inbound_aliases",
  "recovery_inbound_events",
] as const;

test("a targeted migration refuses a fresh database before creating schema or ledger state", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("recovery_target_fresh", async (connectionString) => {
    assert.throws(
      () => runMigrations(connectionString, ["--through=0025_recovery_renewal_alerts"]),
      /--through is allowed only on an existing schema/i,
    );
    const pool = createPool(connectionString);
    try {
      const state = await pool.query<{ users: string | null; ledger: string | null }>(
        `select to_regclass('public.users')::text as users,
                to_regclass('public.schema_migrations')::text as ledger`,
      );
      assert.deepEqual(state.rows[0], { users: null, ledger: null });
    } finally {
      await pool.end();
    }
  });
});

test("the real migration runner installs and records the Recovery receipt inbox on a fresh database", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("recovery_fresh", async (connectionString) => {
    const result = runMigrations(connectionString);
    assert.equal(result.applied.at(-1)?.id, "0027_gmail_forwarding_verification");

    const pool = createPool(connectionString);
    try {
      const migrations = await pool.query<{ id: string }>(
        `select id from schema_migrations order by id`,
      );
      assert.equal(migrations.rows.at(-1)?.id, "0027_gmail_forwarding_verification");
      assert.equal(migrations.rows.length, 27);
      await assertRecoveryRelations(pool);
    } finally {
      await pool.end();
    }
  });
});

test("the guarded legacy cutover preserves evidence in Recovery before retiring duplicate authority", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("legacy_recovery_cutover", async (connectionString) => {
    runMigrations(connectionString);
    const pool = createPool(connectionString);
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const sourceId = randomUUID();
    const unlinkedSourceId = randomUUID();
    const recurringItemId = randomUUID();

    try {
      await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, `${userId}@legacy-cutover.test`]);
      await pool.query(
        `insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Legacy Recovery cutover')`,
        [workspaceId, userId],
      );
      await pool.query(
        `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`,
        [workspaceId, userId],
      );
      await pool.query(
        `insert into data_sources (
           id, workspace_id, kind, display_name, coverage_start_at, coverage_end_at
         ) values ($1, $2, 'manual_entry', 'Legacy receipt', now() - interval '30 days', now())`,
        [sourceId, workspaceId],
      );
      await pool.query(
        `insert into data_sources (
           id, workspace_id, kind, display_name, coverage_start_at, coverage_end_at
         ) values ($1, $2, 'manual_entry', 'Legacy empty source', null, null)`,
        [unlinkedSourceId, workspaceId],
      );
      await pool.query(
        `insert into recurring_items (
           id, workspace_id, merchant, normalized_merchant, category, frequency,
           currency, amount_min, amount_max, average_amount, monthly_cost,
           annual_cost, last_charge_date, next_expected_date, confidence_score,
           status, recommendation_reason, risk_tags
         ) values (
           $1, $2, 'Acme AI', 'acme ai', 'Software', 'monthly', 'INR',
           100.00, 100.00, 100.00, 100.00, 1200.00,
           current_date - 10, current_date + 20, 92, 'watch',
           'Review before renewal.', array['renewal-soon']::text[]
         )`,
        [recurringItemId, workspaceId],
      );
      await pool.query(
        `insert into evidence_links (
           recurring_item_id, source_id, evidence_type, evidence_text,
           evidence_date, amount
         ) values ($1, $2, 'receipt', 'Acme AI invoice charged INR 100.', current_date - 10, 100.00)`,
        [recurringItemId, sourceId],
      );
      await pool.query(
        `insert into commitment_decisions (
           workspace_id, recurring_item_id, decided_by_user_id, action
         ) values ($1, $2, $3, 'watch')`,
        [workspaceId, recurringItemId, userId],
      );
      await pool.query(
        `insert into workspace_states (workspace_id, encrypted_snapshot, updated_by_user_id)
         values ($1, '{}'::jsonb, $2)`,
        [workspaceId, userId],
      );

      const migrated = await migrateLegacyRecovery(pool);
      assert.deepEqual(migrated, {
        status: "migrated",
        workspacesMigrated: 1,
        sourcesMigrated: 2,
        commitmentsMigrated: 1,
        evidenceMigrated: 1,
        decisionsMigrated: 1,
        remindersScheduled: 0,
      });

      const state = await pool.query<{
        legacy_rows: string;
        recovery_workspaces: string;
        recovery_sources: string;
        recovery_commitments: string;
        recovery_evidence: string;
        recovery_decisions: string;
        amount_minor: string;
        monthly_minor: string;
        cadence: string;
        decision: string;
        snapshot_version: string;
      }>(
        `select
           ((select count(*) from workspace_states)
             + (select count(*) from recurring_items)
             + (select count(*) from evidence_links)
             + (select count(*) from commitment_decisions)
             + (select count(*) from data_sources))::text as legacy_rows,
           (select count(*)::text from recovery_workspace_states where workspace_id = $1) as recovery_workspaces,
           (select count(*)::text from recovery_sources where workspace_id = $1) as recovery_sources,
           (select count(*)::text from recovery_commitments where workspace_id = $1) as recovery_commitments,
           (select count(*)::text from recovery_evidence where workspace_id = $1) as recovery_evidence,
           (select count(*)::text from recovery_decisions where workspace_id = $1) as recovery_decisions,
           (select effective_amount_minor::text from recovery_commitments where workspace_id = $1) as amount_minor,
           (select effective_monthly_minor::text from recovery_commitments where workspace_id = $1) as monthly_minor,
           (select effective_cadence from recovery_commitments where workspace_id = $1) as cadence,
           (select decision from recovery_decisions where workspace_id = $1) as decision,
           (select snapshot ->> 'version' from recovery_workspace_versions where workspace_id = $1 and version = 1) as snapshot_version`,
        [workspaceId],
      );
      assert.deepEqual(state.rows[0], {
        legacy_rows: "0",
        recovery_workspaces: "1",
        recovery_sources: "2",
        recovery_commitments: "1",
        recovery_evidence: "1",
        recovery_decisions: "1",
        amount_minor: "10000",
        monthly_minor: "10000",
        cadence: "MONTHLY",
        decision: "MONITOR",
        snapshot_version: "1",
      });
      assert.deepEqual(await migrateLegacyRecovery(pool), {
        status: "already-clean",
        workspacesMigrated: 0,
        sourcesMigrated: 0,
        commitmentsMigrated: 0,
        evidenceMigrated: 0,
        decisionsMigrated: 0,
        remindersScheduled: 0,
      });
    } finally {
      await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
      await pool.query(`delete from users where id = $1`, [userId]);
      await pool.end();
    }
  });
});

test("the real migration runner upgrades an existing 0022 database through Recovery inbound without losing legacy state", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("recovery_upgrade", async (connectionString) => {
    const seedPool = createPool(connectionString);
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const recurringItemId = randomUUID();
    let legacySyncRunId = "";
    let legacyEvidenceId = "";

    try {
      await seedSchemaThrough0022(seedPool);
      const legacy = await seedLegacyState(seedPool, { userId, workspaceId, recurringItemId });
      legacySyncRunId = legacy.syncRunId;
      legacyEvidenceId = legacy.evidenceId;
    } finally {
      await seedPool.end();
    }

    const expanded = runMigrations(connectionString, ["--through=0025_recovery_renewal_alerts"]);
    assert.deepEqual(expanded.applied, [
      { id: "0023_recovery_v1", mode: "applied-migration" },
      { id: "0024_recovery_inbound_receipts", mode: "applied-migration" },
      { id: "0025_recovery_renewal_alerts", mode: "applied-migration" },
    ]);
    const expandedPool = createPool(connectionString);
    try {
      const expandedState = await expandedPool.query<{ job_status: string; reminder_status: string; has_recovery_target: boolean }>(
        `select
           (select status::text from connector_sync_jobs where workspace_id = $1 limit 1) as job_status,
           (select status::text from renewal_alert_deliveries where workspace_id = $1 limit 1) as reminder_status,
           exists (
             select 1 from information_schema.columns
             where table_schema = 'public'
               and table_name = 'renewal_alert_deliveries'
               and column_name = 'recovery_commitment_id'
           ) as has_recovery_target`,
        [workspaceId],
      );
      assert.deepEqual(expandedState.rows[0], {
        job_status: "running",
        reminder_status: "scheduled",
        has_recovery_target: true,
      });
      await assert.doesNotReject(
        expandedPool.query(
          `update retention_runs
           set counts = counts || '{"recoveryInboundEventsDeleted":0}'::jsonb
           where workspace_id = $1`,
          [workspaceId],
        ),
      );
    } finally {
      await expandedPool.end();
    }

    const result = runMigrations(connectionString);
    assert.deepEqual(result.applied, [
      { id: "0026_recovery_inbound_retention", mode: "applied-migration" },
      { id: "0027_gmail_forwarding_verification", mode: "applied-migration" },
    ]);

    const verifyPool = createPool(connectionString);
    try {
      const migration = await verifyPool.query<{ id: string }>(
        `select id from schema_migrations where id in ('0023_recovery_v1', '0024_recovery_inbound_receipts', '0025_recovery_renewal_alerts', '0026_recovery_inbound_retention', '0027_gmail_forwarding_verification')`,
      );
      assert.equal(migration.rowCount, 5);
      await assertRecoveryRelations(verifyPool);

      const preserved = await verifyPool.query<{
        users: string;
        workspaces: string;
        recurring_items: string;
        evidence_links: string;
        commitment_decisions: string;
        workspace_states: string;
        retention_runs: string;
        sync_job_status: string;
        sync_run_status: string;
        sync_run_finished: boolean;
        legacy_reminder_status: string;
      }>(
        `select
           (select count(*)::text from users where id = $1) as users,
           (select count(*)::text from workspaces where id = $2) as workspaces,
           (select count(*)::text from recurring_items where id = $3) as recurring_items,
           (select count(*)::text from evidence_links where recurring_item_id = $3) as evidence_links,
           (select count(*)::text from commitment_decisions where recurring_item_id = $3) as commitment_decisions,
           (select count(*)::text from workspace_states where workspace_id = $2) as workspace_states,
           (select count(*)::text from retention_runs where workspace_id = $2) as retention_runs,
           (select status::text from connector_sync_jobs where workspace_id = $2 limit 1) as sync_job_status,
            (select status::text from connector_sync_runs where id = $4) as sync_run_status,
            (select finished_at is not null from connector_sync_runs where id = $4) as sync_run_finished,
           (select status::text from renewal_alert_deliveries where workspace_id = $2 limit 1) as legacy_reminder_status`,
          [userId, workspaceId, recurringItemId, legacySyncRunId],
      );
      assert.deepEqual(preserved.rows[0], {
        users: "1",
        workspaces: "1",
        recurring_items: "1",
        evidence_links: "1",
        commitment_decisions: "1",
        workspace_states: "1",
        retention_runs: "1",
        sync_job_status: "blocked",
        sync_run_status: "blocked",
        sync_run_finished: true,
        legacy_reminder_status: "cancelled",
      });

      await assert.doesNotReject(
        verifyPool.query(
          `update retention_runs
           set counts = counts || '{"recoveryRawEvidenceMinimized": 0}'::jsonb
           where workspace_id = $1`,
          [workspaceId],
        ),
      );
      await assert.doesNotReject(
        verifyPool.query(
          `update connector_evidence
           set payload = '{}'::jsonb, payload_minimized_at = now()
           where id = $1`,
          [legacyEvidenceId],
        ),
      );
      await assert.rejects(
        verifyPool.query(
          `update connector_evidence set merchant_raw = 'Changed legacy merchant' where id = $1`,
          [legacyEvidenceId],
        ),
        /connector evidence writes are retired/i,
      );
      await assert.rejects(
        verifyPool.query(
          `insert into connector_evidence (
             workspace_id, sync_run_id, connector_id, provider, evidence_type,
             observed_at, confidence_score, payload_hash
           ) values ($1, $2, 'openai-costs', 'openai', 'cost', now(), 90, $3)`,
          [workspaceId, legacySyncRunId, "f".repeat(64)],
        ),
        /connector evidence writes are retired/i,
      );
      await assert.rejects(
        verifyPool.query(
          `insert into connector_evidence (
             workspace_id, connector_id, provider, evidence_type,
             observed_at, confidence_score, payload_hash
           ) values ($1, 'openai-costs', 'openai', 'cost', now(), 90, $2)`,
          [workspaceId, "e".repeat(64)],
        ),
        /connector evidence writes are retired/i,
      );
      await assert.rejects(
        verifyPool.query(
          `insert into connector_sync_jobs (workspace_id, connector_id, job_type, status, next_run_at)
           values ($1, 'openai-costs', 'incremental_sync', 'queued', now())`,
          [workspaceId],
        ),
        /legacy connector synchronization is retired/i,
      );
      await assert.rejects(
        verifyPool.query(
          `insert into renewal_alert_deliveries (
             workspace_id, user_id, preference_id, consent_grant_id, recurring_item_id,
             alert_window, renewal_date, scheduled_for, status
           )
           select $1, $2, preference.id, preference.consent_grant_id, $3,
                  '7_day', current_date + 14, now() + interval '7 days', 'scheduled'
           from renewal_alert_preferences preference
           where preference.workspace_id = $1 and preference.user_id = $2`,
          [workspaceId, userId, recurringItemId],
        ),
        /legacy renewal deliveries are retired/i,
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
    await adminPool.query(`drop database if exists ${quoteIdentifier(databaseName)}`);
    await adminPool.end();
  }
}

function runMigrations(connectionString: string, args: string[] = []) {
  const output = execFileSync(process.execPath, ["scripts/apply-postgres-schema.mjs", ...args], {
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
  const syncJob = await pool.query<{ id: string }>(
    `insert into connector_sync_jobs (workspace_id, connector_id, job_type, status, next_run_at)
     values ($1, 'openai-costs', 'incremental_sync', 'running', null)
     returning id`,
    [ids.workspaceId],
  );
  const syncRunId = randomUUID();
  await pool.query(
    `insert into connector_sync_runs (id, sync_job_id, workspace_id, connector_id, invocation, status)
     values ($1, $2, $3, 'openai-costs', 'cron', 'running')`,
    [syncRunId, syncJob.rows[0]!.id, ids.workspaceId],
  );
  const evidence = await pool.query<{ id: string }>(
    `insert into connector_evidence (
       workspace_id, sync_run_id, connector_id, provider, evidence_type,
       observed_at, merchant_raw, confidence_score, payload_hash, payload
     ) values ($1, $2, 'openai-costs', 'openai', 'cost', now(), 'Legacy merchant', 90, $3, '{"raw":"private"}'::jsonb)
     returning id`,
    [ids.workspaceId, syncRunId, "d".repeat(64)],
  );
  await pool.query(
    `with consent as (
       insert into consent_grants (workspace_id, user_id, subject_email, purpose, notice_version, source)
       values ($1, $2, $3, 'renewal-alerts', 'migration-test', 'migration-test')
       returning id
     ), preference as (
       insert into renewal_alert_preferences (workspace_id, user_id, consent_grant_id, enabled)
       select $1, $2, id, true from consent
       returning id, consent_grant_id
     )
     insert into renewal_alert_deliveries (
       workspace_id, user_id, preference_id, consent_grant_id, recurring_item_id,
       alert_window, renewal_date, scheduled_for, status
     )
     select $1, $2, id, consent_grant_id, $4, '7_day', current_date + 7, now() + interval '1 day', 'scheduled'
     from preference`,
    [ids.workspaceId, ids.userId, `${ids.userId}@migration.test`, ids.recurringItemId],
  );
  return { syncRunId, evidenceId: evidence.rows[0]!.id };
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
