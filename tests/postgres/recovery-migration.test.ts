import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { Pool } from "pg";

import {
  countLegacyLedgerRows,
  LegacyCutoverBlockedError,
  migrateLegacyRecovery,
  reconcileMigratedRecoveryRecords,
  type LegacyEvidence,
  type LegacyItem,
  type LegacyLedgerBlockerCounts,
} from "../../scripts/lib/migrate-legacy-recovery";

const zeroLegacyBlockers: LegacyLedgerBlockerCounts = {
  unsupportedSources: 0,
  incompleteEvidence: 0,
  itemsWithoutEvidence: 0,
  unsupportedActions: 0,
  transactions: 0,
  connectorEvidence: 0,
  legacyConnectedAccounts: 0,
  actionCases: 0,
  partialRecoveryRows: 0,
  orphanedLegacyRows: 0,
  crossWorkspaceDecisions: 0,
  crossWorkspaceEvidence: 0,
};

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
    assert.equal(result.applied.at(-1)?.id, "0030_legacy_tenant_ownership_immutable");

    const pool = createPool(connectionString);
    try {
      const migrations = await pool.query<{ id: string }>(
        `select id from schema_migrations order by id`,
      );
      assert.equal(migrations.rows.at(-1)?.id, "0030_legacy_tenant_ownership_immutable");
      assert.equal(migrations.rows.length, 30);
      await assertRecoveryRelations(pool);
      const integrity = await pool.query<{ conname: string | null; trigger: string | null }>(
        `select
           (select conname from pg_constraint where conname = 'commitment_decisions_workspace_recurring_item_fkey') as conname,
           (select tgname from pg_trigger where tgname = 'evidence_links_tenant_workspace_guard') as trigger`,
      );
      assert.deepEqual(integrity.rows[0], {
        conname: "commitment_decisions_workspace_recurring_item_fkey",
        trigger: "evidence_links_tenant_workspace_guard",
      });
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

      const before = await countLegacyLedgerRows(pool);
      assert.equal(before.status, "safely-migratable");
      assert.equal(before.migratable.workspaces, 1);
      assert.equal(before.migratable.commitments, 1);
      assert.equal(before.blocked.connectorEvidence, 0);

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
      const after = await countLegacyLedgerRows(pool);
      assert.equal(after.status, "clean");
      assert.equal(after.legacyRows, 0);
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
      { id: "0028_recovery_gmail_oauth_source", mode: "applied-migration" },
      { id: "0029_legacy_tenant_integrity", mode: "applied-migration" },
      { id: "0030_legacy_tenant_ownership_immutable", mode: "applied-migration" },
    ]);

    const verifyPool = createPool(connectionString);
    try {
      const migration = await verifyPool.query<{ id: string }>(
        `select id from schema_migrations where id in ('0023_recovery_v1', '0024_recovery_inbound_receipts', '0025_recovery_renewal_alerts', '0026_recovery_inbound_retention', '0027_gmail_forwarding_verification', '0028_recovery_gmail_oauth_source', '0029_legacy_tenant_integrity', '0030_legacy_tenant_ownership_immutable')`,
      );
      assert.equal(migration.rowCount, 8);
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

test("a fresh Recovery install reports a clean legacy ledger", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("legacy_report_clean", async (connectionString) => {
    runMigrations(connectionString);
    const pool = createPool(connectionString);
    try {
      const report = await countLegacyLedgerRows(pool);
      assert.equal(report.status, "clean");
      assert.equal(report.legacyRows, 0);
      assert.deepEqual(report.blocked, zeroLegacyBlockers);
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
      await pool.end();
    }
  });
});

test("the real migration runner upgrades 0027 through 0028 without dropping Recovery tables", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("recovery_0027_to_0028", async (connectionString) => {
    const seedPool = createPool(connectionString);
    try {
      await seedSchemaThrough0022(seedPool);
    } finally {
      await seedPool.end();
    }
    const through0027 = runMigrations(connectionString, ["--through=0027_gmail_forwarding_verification"]);
    assert.equal(through0027.applied.at(-1)?.id, "0027_gmail_forwarding_verification");
    const mid = createPool(connectionString);
    try {
      const constraint = await mid.query<{ def: string }>(
        `select pg_get_constraintdef(oid) as def
         from pg_constraint
         where conname = 'recovery_submissions_source_type_check'`,
      );
      assert.doesNotMatch(constraint.rows[0]?.def ?? "", /GMAIL_OAUTH/);
    } finally {
      await mid.end();
    }
    const rest = runMigrations(connectionString);
    assert.deepEqual(rest.applied, [
      { id: "0028_recovery_gmail_oauth_source", mode: "applied-migration" },
      { id: "0029_legacy_tenant_integrity", mode: "applied-migration" },
      { id: "0030_legacy_tenant_ownership_immutable", mode: "applied-migration" },
    ]);
    const pool = createPool(connectionString);
    try {
      const constraint = await pool.query<{ def: string }>(
        `select pg_get_constraintdef(oid) as def
         from pg_constraint
         where conname = 'recovery_submissions_source_type_check'`,
      );
      assert.match(constraint.rows[0]?.def ?? "", /GMAIL_OAUTH/);
      await assertRecoveryRelations(pool);
    } finally {
      await pool.end();
    }
  });
});

test("unsupported legacy shapes block cutover with exact counts and preserve every row", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("legacy_cutover_blocked", async (connectionString) => {
    runMigrations(connectionString);
    const pool = createPool(connectionString);
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const sourceId = randomUUID();
    const recurringItemId = randomUUID();
    try {
      await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, `${userId}@legacy-blocked.test`]);
      await pool.query(
        `insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Blocked cutover')`,
        [workspaceId, userId],
      );
      await pool.query(
        `insert into data_sources (id, workspace_id, kind, display_name) values ($1, $2, 'gmail_receipt', 'Unsupported Gmail source')`,
        [sourceId, workspaceId],
      );
      await pool.query(
        `insert into recurring_items (
           id, workspace_id, merchant, normalized_merchant, category, frequency,
           currency, amount_min, amount_max, average_amount, monthly_cost,
           annual_cost, confidence_score, status
         ) values ($1, $2, 'Blocked Merchant', 'blocked merchant', 'Software', 'monthly',
           'INR', 100, 100, 100, 100, 1200, 90, 'keep')`,
        [recurringItemId, workspaceId],
      );
      await pool.query(
        `insert into evidence_links (recurring_item_id, source_id, evidence_type, evidence_text, evidence_date, amount)
         values ($1, $2, 'receipt', 'Blocked merchant charged INR 100.', current_date, 100.00)`,
        [recurringItemId, sourceId],
      );
      await pool.query(
        `insert into workspace_states (workspace_id, encrypted_snapshot, updated_by_user_id)
         values ($1, '{}'::jsonb, $2)`,
        [workspaceId, userId],
      );
      const report = await countLegacyLedgerRows(pool);
      assert.equal(report.status, "blocked");
      assert.equal(report.blocked.unsupportedSources, 1);
      await assert.rejects(() => migrateLegacyRecovery(pool), (error: unknown) => {
        assert.ok(error instanceof LegacyCutoverBlockedError);
        assert.equal(error.blocked.unsupportedSources, 1);
        assert.match(error.message, /unsupportedSources=1/);
        assert.match(error.message, /were not deleted/);
        return true;
      });
      const preserved = await pool.query<{ sources: string; items: string; states: string }>(
        `select
           (select count(*)::text from data_sources where id = $1) as sources,
           (select count(*)::text from recurring_items where id = $2) as items,
           (select count(*)::text from workspace_states where workspace_id = $3) as states`,
        [sourceId, recurringItemId, workspaceId],
      );
      assert.deepEqual(preserved.rows[0], { sources: "1", items: "1", states: "1" });
    } finally {
      await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
      await pool.query(`delete from users where id = $1`, [userId]);
      await pool.end();
    }
  });
});

test("record-level reconciliation failure preserves legacy rows", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("legacy_reconcile_fail", async (connectionString) => {
    runMigrations(connectionString);
    const pool = createPool(connectionString);
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const sourceId = randomUUID();
    const recurringItemId = randomUUID();
    const evidenceId = randomUUID();
    try {
      await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, `${userId}@legacy-reconcile.test`]);
      await pool.query(
        `insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Reconcile failure')`,
        [workspaceId, userId],
      );
      await pool.query(
        `insert into data_sources (id, workspace_id, kind, display_name) values ($1, $2, 'manual_entry', 'Legacy receipt')`,
        [sourceId, workspaceId],
      );
      await pool.query(
        `insert into recurring_items (
           id, workspace_id, merchant, normalized_merchant, category, frequency,
           currency, amount_min, amount_max, average_amount, monthly_cost,
           annual_cost, confidence_score, status
         ) values ($1, $2, 'Acme AI', 'acme ai', 'Software', 'monthly',
           'INR', 100, 100, 100, 100, 1200, 92, 'watch')`,
        [recurringItemId, workspaceId],
      );
      await pool.query(
        `insert into evidence_links (
           id, recurring_item_id, source_id, evidence_type, evidence_text, evidence_date, amount
         ) values ($1, $2, $3, 'receipt', 'Acme AI invoice charged INR 100.', current_date, 100.00)`,
        [evidenceId, recurringItemId, sourceId],
      );
      await pool.query(
        `insert into workspace_states (workspace_id, encrypted_snapshot, updated_by_user_id)
         values ($1, '{}'::jsonb, $2)`,
        [workspaceId, userId],
      );
      await pool.query(
        `insert into recovery_commitments (
           id, workspace_id, identity_key, base_status, base_merchant, base_category,
           base_cadence, base_currency, base_amount_minor, base_monthly_minor,
           effective_status, effective_merchant, effective_cadence, effective_amount_minor,
           effective_monthly_minor, confidence_score, confidence_reasons, recommended_decision,
           recommendation_reason, risk_tags
         ) values (
           $1, $2, $3, 'ACTIVE', 'Acme AI', 'Software', 'MONTHLY', 'INR', 1, 1,
           'ACTIVE', 'Acme AI', 'MONTHLY', 1, 1, 92, '[]'::jsonb, 'MONITOR',
           'Wrong copy', array[]::text[]
         )`,
        [randomUUID(), workspaceId, `legacy:${recurringItemId}`],
      );
      const items = (await pool.query<LegacyItem>(
        `select id, workspace_id, merchant, normalized_merchant, category,
                frequency, currency, average_amount::text, monthly_cost::text,
                next_expected_date::text, confidence_score, status,
                recommendation_reason, risk_tags, first_detected_at
         from recurring_items where id = $1`,
        [recurringItemId],
      )).rows;
      const evidence = (await pool.query<LegacyEvidence>(
        `select id, recurring_item_id, source_id, evidence_text, evidence_date::text, amount::text, created_at
         from evidence_links where id = $1`,
        [evidenceId],
      )).rows;
      const client = await pool.connect();
      try {
        await assert.rejects(
          () => reconcileMigratedRecoveryRecords(client, items, evidence),
          /Record-level Recovery reconciliation failed/,
        );
      } finally {
        client.release();
      }
      const preserved = await pool.query<{ items: string }>(
        `select count(*)::text as items from recurring_items where id = $1`,
        [recurringItemId],
      );
      assert.equal(preserved.rows[0]?.items, "1");
      const blocked = await countLegacyLedgerRows(pool);
      assert.equal(blocked.status, "blocked");
      assert.ok(blocked.blocked.partialRecoveryRows > 0);
      await assert.rejects(() => migrateLegacyRecovery(pool), LegacyCutoverBlockedError);
      assert.equal((await pool.query(`select count(*)::text as items from recurring_items where id = $1`, [recurringItemId])).rows[0]?.items, "1");
    } finally {
      await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
      await pool.query(`delete from users where id = $1`, [userId]);
      await pool.end();
    }
  });
});

test("a decision workspace that differs from its recurring item blocks cutover without rehoming ownership", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("legacy_decision_workspace_mismatch", async (connectionString) => {
    await installSchemaThrough0028(connectionString);
    const pool = createPool(connectionString);
    const tenants = twoTenants();
    try {
      await seedTenants(pool, tenants);
      await seedManualLedger(pool, {
        userId: tenants.ownerA,
        workspaceId: tenants.workspaceA,
        sourceId: tenants.sourceA,
        itemId: tenants.itemA,
        merchant: "Decision Tenant A",
        decisionWorkspaceId: tenants.workspaceB,
      });
      await seedWorkspaceState(pool, tenants.workspaceB, tenants.ownerB);

      const report = await countLegacyLedgerRows(pool);
      assert.equal(report.status, "blocked");
      assert.equal(report.blocked.crossWorkspaceDecisions, 1);
      assert.equal(report.blocked.crossWorkspaceEvidence, 0);
      await assertCutoverBlockedWithoutRehome(pool, tenants, {
        decisionWorkspaceId: tenants.workspaceB,
        itemWorkspaceId: tenants.workspaceA,
        sourceWorkspaceId: tenants.workspaceA,
        evidenceSourceId: tenants.sourceA,
      });
    } finally {
      await pool.query(`delete from workspaces where id = any($1::uuid[])`, [[tenants.workspaceA, tenants.workspaceB]]);
      await pool.query(`delete from users where id = any($1::uuid[])`, [[tenants.ownerA, tenants.ownerB]]);
      await pool.end();
    }
  });
});

test("an evidence source workspace that differs from its destination item blocks cutover without rehoming ownership", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("legacy_evidence_workspace_mismatch", async (connectionString) => {
    await installSchemaThrough0028(connectionString);
    const pool = createPool(connectionString);
    const tenants = twoTenants();
    try {
      await seedTenants(pool, tenants);
      await pool.query(
        `insert into data_sources (id, workspace_id, kind, display_name, coverage_start_at, coverage_end_at)
         values ($1, $2, 'manual_entry', 'Evidence Tenant B source', now() - interval '30 days', now())`,
        [tenants.sourceB, tenants.workspaceB],
      );
      await seedManualLedger(pool, {
        userId: tenants.ownerA,
        workspaceId: tenants.workspaceA,
        sourceId: tenants.sourceA,
        itemId: tenants.itemA,
        merchant: "Evidence Tenant A",
        evidenceSourceId: tenants.sourceB,
      });
      await seedWorkspaceState(pool, tenants.workspaceB, tenants.ownerB);

      const report = await countLegacyLedgerRows(pool);
      assert.equal(report.status, "blocked");
      assert.equal(report.blocked.crossWorkspaceEvidence, 1);
      assert.equal(report.blocked.crossWorkspaceDecisions, 0);
      await assertCutoverBlockedWithoutRehome(pool, tenants, {
        decisionWorkspaceId: tenants.workspaceA,
        itemWorkspaceId: tenants.workspaceA,
        sourceWorkspaceId: tenants.workspaceB,
        evidenceSourceId: tenants.sourceB,
      });
    } finally {
      await pool.query(`delete from workspaces where id = any($1::uuid[])`, [[tenants.workspaceA, tenants.workspaceB]]);
      await pool.query(`delete from users where id = any($1::uuid[])`, [[tenants.ownerA, tenants.ownerB]]);
      await pool.end();
    }
  });
});

test("cross-workspace evidence and decision relationships block cutover and preserve every original tenant row", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("legacy_cross_workspace_relations", async (connectionString) => {
    await installSchemaThrough0028(connectionString);
    const pool = createPool(connectionString);
    const tenants = twoTenants();
    try {
      await seedTenants(pool, tenants);
      await pool.query(
        `insert into data_sources (id, workspace_id, kind, display_name, coverage_start_at, coverage_end_at)
         values ($1, $2, 'manual_entry', 'Mixed Tenant B source', now() - interval '30 days', now())`,
        [tenants.sourceB, tenants.workspaceB],
      );
      await seedManualLedger(pool, {
        userId: tenants.ownerA,
        workspaceId: tenants.workspaceA,
        sourceId: tenants.sourceA,
        itemId: tenants.itemA,
        merchant: "Mixed Tenant A",
        decisionWorkspaceId: tenants.workspaceB,
        evidenceSourceId: tenants.sourceB,
      });
      await seedWorkspaceState(pool, tenants.workspaceB, tenants.ownerB);

      const report = await countLegacyLedgerRows(pool);
      assert.equal(report.status, "blocked");
      assert.equal(report.blocked.crossWorkspaceDecisions, 1);
      assert.equal(report.blocked.crossWorkspaceEvidence, 1);
      await assertCutoverBlockedWithoutRehome(pool, tenants, {
        decisionWorkspaceId: tenants.workspaceB,
        itemWorkspaceId: tenants.workspaceA,
        sourceWorkspaceId: tenants.workspaceB,
        evidenceSourceId: tenants.sourceB,
      });
    } finally {
      await pool.query(`delete from workspaces where id = any($1::uuid[])`, [[tenants.workspaceA, tenants.workspaceB]]);
      await pool.query(`delete from users where id = any($1::uuid[])`, [[tenants.ownerA, tenants.ownerB]]);
      await pool.end();
    }
  });
});

test("valid same-workspace evidence and decisions migrate into the original tenant and stay isolated", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("legacy_same_workspace_isolation", async (connectionString) => {
    runMigrations(connectionString);
    const pool = createPool(connectionString);
    const tenants = twoTenants();
    try {
      await seedTenants(pool, tenants);
      await seedManualLedger(pool, {
        userId: tenants.ownerA,
        workspaceId: tenants.workspaceA,
        sourceId: tenants.sourceA,
        itemId: tenants.itemA,
        merchant: "Isolated Tenant A",
      });
      await seedManualLedger(pool, {
        userId: tenants.ownerB,
        workspaceId: tenants.workspaceB,
        sourceId: tenants.sourceB,
        itemId: tenants.itemB,
        merchant: "Isolated Tenant B",
      });

      const before = await countLegacyLedgerRows(pool);
      assert.equal(before.status, "safely-migratable");
      assert.deepEqual(before.blocked, zeroLegacyBlockers);

      const migrated = await migrateLegacyRecovery(pool);
      assert.equal(migrated.status, "migrated");
      assert.equal(migrated.workspacesMigrated, 2);
      assert.equal(migrated.commitmentsMigrated, 2);
      assert.equal(migrated.evidenceMigrated, 2);
      assert.equal(migrated.decisionsMigrated, 2);

      const isolated = await pool.query<{
        a_commitments: string;
        b_commitments: string;
        crossed_evidence: string;
        crossed_decisions: string;
        a_decision: string;
        b_decision: string;
      }>(
        `select
           (select count(*)::text from recovery_commitments where workspace_id = $1) as a_commitments,
           (select count(*)::text from recovery_commitments where workspace_id = $2) as b_commitments,
           (select count(*)::text
            from recovery_evidence evidence
            join recovery_sources source on source.id = evidence.source_id
            where evidence.workspace_id <> source.workspace_id) as crossed_evidence,
           (select count(*)::text
            from recovery_decisions decision
            join recovery_commitments commitment
              on commitment.id = decision.commitment_id
             and commitment.workspace_id <> decision.workspace_id) as crossed_decisions,
           (select decision.workspace_id::text
            from recovery_decisions decision
            join recovery_commitments commitment on commitment.id = decision.commitment_id
            where commitment.identity_key = $3) as a_decision,
           (select decision.workspace_id::text
            from recovery_decisions decision
            join recovery_commitments commitment on commitment.id = decision.commitment_id
            where commitment.identity_key = $4) as b_decision`,
        [tenants.workspaceA, tenants.workspaceB, `legacy:${tenants.itemA}`, `legacy:${tenants.itemB}`],
      );
      assert.deepEqual(isolated.rows[0], {
        a_commitments: "1",
        b_commitments: "1",
        crossed_evidence: "0",
        crossed_decisions: "0",
        a_decision: tenants.workspaceA,
        b_decision: tenants.workspaceB,
      });
    } finally {
      await pool.query(`delete from workspaces where id = any($1::uuid[])`, [[tenants.workspaceA, tenants.workspaceB]]);
      await pool.query(`delete from users where id = any($1::uuid[])`, [[tenants.ownerA, tenants.ownerB]]);
      await pool.end();
    }
  });
});

test("the latest schema rejects new cross-workspace decision and evidence writes", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("legacy_tenant_write_guard", async (connectionString) => {
    runMigrations(connectionString);
    const pool = createPool(connectionString);
    const tenants = twoTenants();
    try {
      await seedTenants(pool, tenants);
      await seedManualLedger(pool, {
        userId: tenants.ownerA,
        workspaceId: tenants.workspaceA,
        sourceId: tenants.sourceA,
        itemId: tenants.itemA,
        merchant: "Guarded Tenant A",
      });
      await pool.query(
        `insert into data_sources (id, workspace_id, kind, display_name)
         values ($1, $2, 'manual_entry', 'Guarded Tenant B source')`,
        [tenants.sourceB, tenants.workspaceB],
      );
      await assert.rejects(
        () => pool.query(
          `insert into commitment_decisions (workspace_id, recurring_item_id, decided_by_user_id, action)
           values ($1, $2, $3, 'keep')`,
          [tenants.workspaceB, tenants.itemA, tenants.ownerB],
        ),
        /commitment_decisions_workspace_recurring_item_fkey|violates foreign key constraint/i,
      );
      await assert.rejects(
        () => pool.query(
          `insert into evidence_links (
             recurring_item_id, source_id, evidence_type, evidence_text, evidence_date, amount
           ) values ($1, $2, 'receipt', 'Cross-workspace evidence', current_date, 100.00)`,
          [tenants.itemA, tenants.sourceB],
        ),
        /Evidence source workspace must match the recurring item workspace/i,
      );
      const preserved = await pool.query<{ decisions: string; evidence: string }>(
        `select
           (select count(*)::text from commitment_decisions where recurring_item_id = $1) as decisions,
           (select count(*)::text from evidence_links where recurring_item_id = $1) as evidence`,
        [tenants.itemA],
      );
      assert.deepEqual(preserved.rows[0], { decisions: "1", evidence: "1" });
    } finally {
      await pool.query(`delete from workspaces where id = any($1::uuid[])`, [[tenants.workspaceA, tenants.workspaceB]]);
      await pool.query(`delete from users where id = any($1::uuid[])`, [[tenants.ownerA, tenants.ownerB]]);
      await pool.end();
    }
  });
});

test("0029 installs over historical cross-workspace rows without rewriting ownership", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("legacy_tenant_upgrade_dirty", async (connectionString) => {
    await installSchemaThrough0028(connectionString);
    const pool = createPool(connectionString);
    const tenants = twoTenants();
    try {
      await seedTenants(pool, tenants);
      await seedManualLedger(pool, {
        userId: tenants.ownerA,
        workspaceId: tenants.workspaceA,
        sourceId: tenants.sourceA,
        itemId: tenants.itemA,
        merchant: "Upgrade Tenant A",
        decisionWorkspaceId: tenants.workspaceB,
      });
      await seedWorkspaceState(pool, tenants.workspaceB, tenants.ownerB);

      const applied = runMigrations(connectionString);
      assert.deepEqual(applied.applied, [
        { id: "0029_legacy_tenant_integrity", mode: "applied-migration" },
        { id: "0030_legacy_tenant_ownership_immutable", mode: "applied-migration" },
      ]);

      const ownership = await pool.query<{ decision_workspace: string; item_workspace: string }>(
        `select
           (select workspace_id::text from commitment_decisions where recurring_item_id = $1) as decision_workspace,
           (select workspace_id::text from recurring_items where id = $1) as item_workspace`,
        [tenants.itemA],
      );
      assert.deepEqual(ownership.rows[0], {
        decision_workspace: tenants.workspaceB,
        item_workspace: tenants.workspaceA,
      });
      const report = await countLegacyLedgerRows(pool);
      assert.equal(report.status, "blocked");
      assert.equal(report.blocked.crossWorkspaceDecisions, 1);
      await assertCutoverBlockedWithoutRehome(pool, tenants, {
        decisionWorkspaceId: tenants.workspaceB,
        itemWorkspaceId: tenants.workspaceA,
        sourceWorkspaceId: tenants.workspaceA,
        evidenceSourceId: tenants.sourceA,
      });
    } finally {
      await pool.query(`delete from workspaces where id = any($1::uuid[])`, [[tenants.workspaceA, tenants.workspaceB]]);
      await pool.query(`delete from users where id = any($1::uuid[])`, [[tenants.ownerA, tenants.ownerB]]);
      await pool.end();
    }
  });
});

test("a valid evidence link cannot become cross-workspace by updating data_sources.workspace_id", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("legacy_source_workspace_immutable", async (connectionString) => {
    runMigrations(connectionString);
    const pool = createPool(connectionString);
    const tenants = twoTenants();
    try {
      await seedTenants(pool, tenants);
      await seedManualLedger(pool, {
        userId: tenants.ownerA,
        workspaceId: tenants.workspaceA,
        sourceId: tenants.sourceA,
        itemId: tenants.itemA,
        merchant: "Immutable Source Tenant A",
      });
      await assert.rejects(
        () => pool.query(
          `update data_sources set workspace_id = $1 where id = $2`,
          [tenants.workspaceB, tenants.sourceA],
        ),
        /Legacy workspace ownership is immutable/i,
      );
      assert.equal(await countCrossWorkspaceEvidence(pool), "0");
      const ownership = await pool.query<{ workspace_id: string }>(
        `select workspace_id::text from data_sources where id = $1`,
        [tenants.sourceA],
      );
      assert.equal(ownership.rows[0]?.workspace_id, tenants.workspaceA);
    } finally {
      await pool.query(`delete from workspaces where id = any($1::uuid[])`, [[tenants.workspaceA, tenants.workspaceB]]);
      await pool.query(`delete from users where id = any($1::uuid[])`, [[tenants.ownerA, tenants.ownerB]]);
      await pool.end();
    }
  });
});

test("a valid evidence link cannot become cross-workspace by updating recurring_items.workspace_id", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("legacy_item_workspace_immutable", async (connectionString) => {
    runMigrations(connectionString);
    const pool = createPool(connectionString);
    const tenants = twoTenants();
    try {
      await seedTenants(pool, tenants);
      await seedManualLedger(pool, {
        userId: tenants.ownerA,
        workspaceId: tenants.workspaceA,
        sourceId: tenants.sourceA,
        itemId: tenants.itemA,
        merchant: "Immutable Item Tenant A",
      });
      await assert.rejects(
        () => pool.query(
          `update recurring_items set workspace_id = $1 where id = $2`,
          [tenants.workspaceB, tenants.itemA],
        ),
        /Legacy workspace ownership is immutable/i,
      );
      assert.equal(await countCrossWorkspaceEvidence(pool), "0");
      const ownership = await pool.query<{ workspace_id: string }>(
        `select workspace_id::text from recurring_items where id = $1`,
        [tenants.itemA],
      );
      assert.equal(ownership.rows[0]?.workspace_id, tenants.workspaceA);
    } finally {
      await pool.query(`delete from workspaces where id = any($1::uuid[])`, [[tenants.workspaceA, tenants.workspaceB]]);
      await pool.query(`delete from users where id = any($1::uuid[])`, [[tenants.ownerA, tenants.ownerB]]);
      await pool.end();
    }
  });
});

test("a no-op workspace_id update on frozen legacy tables remains permitted", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("legacy_workspace_noop_update", async (connectionString) => {
    runMigrations(connectionString);
    const pool = createPool(connectionString);
    const tenants = twoTenants();
    try {
      await seedTenants(pool, tenants);
      await seedManualLedger(pool, {
        userId: tenants.ownerA,
        workspaceId: tenants.workspaceA,
        sourceId: tenants.sourceA,
        itemId: tenants.itemA,
        merchant: "No-op Tenant A",
      });
      await pool.query(
        `update data_sources set workspace_id = $1, display_name = display_name where id = $2`,
        [tenants.workspaceA, tenants.sourceA],
      );
      await pool.query(
        `update recurring_items set workspace_id = $1, merchant = merchant where id = $2`,
        [tenants.workspaceA, tenants.itemA],
      );
      assert.equal(await countCrossWorkspaceEvidence(pool), "0");
      const ownership = await pool.query<{ source_workspace: string; item_workspace: string }>(
        `select
           (select workspace_id::text from data_sources where id = $1) as source_workspace,
           (select workspace_id::text from recurring_items where id = $2) as item_workspace`,
        [tenants.sourceA, tenants.itemA],
      );
      assert.deepEqual(ownership.rows[0], {
        source_workspace: tenants.workspaceA,
        item_workspace: tenants.workspaceA,
      });
    } finally {
      await pool.query(`delete from workspaces where id = any($1::uuid[])`, [[tenants.workspaceA, tenants.workspaceB]]);
      await pool.query(`delete from users where id = any($1::uuid[])`, [[tenants.ownerA, tenants.ownerB]]);
      await pool.end();
    }
  });
});

test("0030 leaves historical cross-workspace rows untouched and they remain cutover blockers", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("legacy_ownership_upgrade_dirty", async (connectionString) => {
    await installSchemaThrough0028(connectionString);
    const pool = createPool(connectionString);
    const tenants = twoTenants();
    try {
      await seedTenants(pool, tenants);
      await pool.query(
        `insert into data_sources (id, workspace_id, kind, display_name, coverage_start_at, coverage_end_at)
         values ($1, $2, 'manual_entry', 'Historical Tenant B source', now() - interval '30 days', now())`,
        [tenants.sourceB, tenants.workspaceB],
      );
      await seedManualLedger(pool, {
        userId: tenants.ownerA,
        workspaceId: tenants.workspaceA,
        sourceId: tenants.sourceA,
        itemId: tenants.itemA,
        merchant: "Historical Tenant A",
        decisionWorkspaceId: tenants.workspaceB,
        evidenceSourceId: tenants.sourceB,
      });
      await seedWorkspaceState(pool, tenants.workspaceB, tenants.ownerB);

      const applied = runMigrations(connectionString);
      assert.deepEqual(applied.applied, [
        { id: "0029_legacy_tenant_integrity", mode: "applied-migration" },
        { id: "0030_legacy_tenant_ownership_immutable", mode: "applied-migration" },
      ]);

      const ownership = await pool.query<{
        decision_workspace: string;
        item_workspace: string;
        source_workspace: string;
      }>(
        `select
           (select workspace_id::text from commitment_decisions where recurring_item_id = $1) as decision_workspace,
           (select workspace_id::text from recurring_items where id = $1) as item_workspace,
           (select workspace_id::text from data_sources where id = $2) as source_workspace`,
        [tenants.itemA, tenants.sourceB],
      );
      assert.deepEqual(ownership.rows[0], {
        decision_workspace: tenants.workspaceB,
        item_workspace: tenants.workspaceA,
        source_workspace: tenants.workspaceB,
      });
      assert.equal(await countCrossWorkspaceEvidence(pool), "1");
      const report = await countLegacyLedgerRows(pool);
      assert.equal(report.status, "blocked");
      assert.equal(report.blocked.crossWorkspaceDecisions, 1);
      assert.equal(report.blocked.crossWorkspaceEvidence, 1);
      await assertCutoverBlockedWithoutRehome(pool, tenants, {
        decisionWorkspaceId: tenants.workspaceB,
        itemWorkspaceId: tenants.workspaceA,
        sourceWorkspaceId: tenants.workspaceB,
        evidenceSourceId: tenants.sourceB,
      });
    } finally {
      await pool.query(`delete from workspaces where id = any($1::uuid[])`, [[tenants.workspaceA, tenants.workspaceB]]);
      await pool.query(`delete from users where id = any($1::uuid[])`, [[tenants.ownerA, tenants.ownerB]]);
      await pool.end();
    }
  });
});

test("fresh same-workspace ledger rows continue to write and remain migratable after ownership is frozen", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("legacy_fresh_same_workspace", async (connectionString) => {
    runMigrations(connectionString);
    const pool = createPool(connectionString);
    const tenants = twoTenants();
    try {
      await seedTenants(pool, tenants);
      await seedManualLedger(pool, {
        userId: tenants.ownerA,
        workspaceId: tenants.workspaceA,
        sourceId: tenants.sourceA,
        itemId: tenants.itemA,
        merchant: "Fresh Tenant A",
      });
      await pool.query(
        `update data_sources set display_name = 'Fresh Tenant A source renamed' where id = $1`,
        [tenants.sourceA],
      );
      await pool.query(
        `insert into evidence_links (
           recurring_item_id, source_id, evidence_type, evidence_text, evidence_date, amount
         ) values ($1, $2, 'receipt', 'Second same-workspace receipt', current_date, 100.00)`,
        [tenants.itemA, tenants.sourceA],
      );
      assert.equal(await countCrossWorkspaceEvidence(pool), "0");
      const report = await countLegacyLedgerRows(pool);
      assert.equal(report.status, "safely-migratable");
      assert.deepEqual(report.blocked, zeroLegacyBlockers);
    } finally {
      await pool.query(`delete from workspaces where id = any($1::uuid[])`, [[tenants.workspaceA, tenants.workspaceB]]);
      await pool.query(`delete from users where id = any($1::uuid[])`, [[tenants.ownerA, tenants.ownerB]]);
      await pool.end();
    }
  });
});

test("concurrent update and insert ordering cannot produce a cross-workspace evidence relationship", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("legacy_concurrent_workspace_guard", async (connectionString) => {
    runMigrations(connectionString);
    const pool = createPool(connectionString);
    const tenants = twoTenants();
    const inserter = await pool.connect();
    const mover = await pool.connect();
    try {
      await seedTenants(pool, tenants);
      await seedManualLedger(pool, {
        userId: tenants.ownerA,
        workspaceId: tenants.workspaceA,
        sourceId: tenants.sourceA,
        itemId: tenants.itemA,
        merchant: "Concurrent Tenant A",
      });
      await inserter.query("set lock_timeout = '15s'");
      await mover.query("set lock_timeout = '15s'");
      const moverPid = (await mover.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid;
      assert.ok(moverPid);

      await inserter.query("begin");
      await inserter.query(
        `insert into evidence_links (
           recurring_item_id, source_id, evidence_type, evidence_text, evidence_date, amount
         ) values ($1, $2, 'receipt', 'Uncommitted same-workspace evidence', current_date, 100.00)`,
        [tenants.itemA, tenants.sourceA],
      );
      const sourceMove = mover.query(
        `update data_sources set workspace_id = $1 where id = $2`,
        [tenants.workspaceB, tenants.sourceA],
      );
      await waitUntilSessionIsWaiting(pool, moverPid);
      await inserter.query("commit");
      await assert.rejects(() => sourceMove, /Legacy workspace ownership is immutable/i);
      assert.equal(await countCrossWorkspaceEvidence(pool), "0");

      await inserter.query("begin");
      await inserter.query(
        `insert into evidence_links (
           recurring_item_id, source_id, evidence_type, evidence_text, evidence_date, amount
         ) values ($1, $2, 'receipt', 'Uncommitted item-guard evidence', current_date, 100.00)`,
        [tenants.itemA, tenants.sourceA],
      );
      const itemMove = mover.query(
        `update recurring_items set workspace_id = $1 where id = $2`,
        [tenants.workspaceB, tenants.itemA],
      );
      await waitUntilSessionIsWaiting(pool, moverPid);
      await inserter.query("commit");
      await assert.rejects(() => itemMove, /Legacy workspace ownership is immutable/i);
      assert.equal(await countCrossWorkspaceEvidence(pool), "0");
    } finally {
      await inserter.query("rollback").catch(() => undefined);
      await mover.query("rollback").catch(() => undefined);
      inserter.release();
      mover.release();
      await pool.query(`delete from workspaces where id = any($1::uuid[])`, [[tenants.workspaceA, tenants.workspaceB]]);
      await pool.query(`delete from users where id = any($1::uuid[])`, [[tenants.ownerA, tenants.ownerB]]);
      await pool.end();
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

type TenantPair = {
  ownerA: string;
  ownerB: string;
  workspaceA: string;
  workspaceB: string;
  sourceA: string;
  sourceB: string;
  itemA: string;
  itemB: string;
};

function twoTenants(): TenantPair {
  return {
    ownerA: randomUUID(),
    ownerB: randomUUID(),
    workspaceA: randomUUID(),
    workspaceB: randomUUID(),
    sourceA: randomUUID(),
    sourceB: randomUUID(),
    itemA: randomUUID(),
    itemB: randomUUID(),
  };
}

async function installSchemaThrough0028(connectionString: string) {
  const seedPool = createPool(connectionString);
  try {
    await seedSchemaThrough0022(seedPool);
  } finally {
    await seedPool.end();
  }
  runMigrations(connectionString, ["--through=0028_recovery_gmail_oauth_source"]);
}

async function seedTenants(pool: Pool, tenants: TenantPair) {
  await pool.query(
    `insert into users (id, email) values ($1, $2), ($3, $4)`,
    [tenants.ownerA, `${tenants.ownerA}@tenant-a.test`, tenants.ownerB, `${tenants.ownerB}@tenant-b.test`],
  );
  await pool.query(
    `insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Tenant A'), ($3, $4, 'Tenant B')`,
    [tenants.workspaceA, tenants.ownerA, tenants.workspaceB, tenants.ownerB],
  );
}

async function countCrossWorkspaceEvidence(pool: Pool) {
  const result = await pool.query<{ crossed: string }>(
    `select count(*)::text as crossed
     from evidence_links link
     join recurring_items item on item.id = link.recurring_item_id
     join data_sources source on source.id = link.source_id
     where source.workspace_id is distinct from item.workspace_id`,
  );
  return result.rows[0]?.crossed ?? "0";
}

async function waitUntilSessionIsWaiting(pool: Pool, backendPid: number) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const waiting = await pool.query<{ waiting: boolean }>(
      `select coalesce(wait_event_type = 'Lock', false) as waiting
       from pg_stat_activity
       where pid = $1`,
      [backendPid],
    );
    if (waiting.rows[0]?.waiting) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`session ${backendPid} did not wait on a lock`);
}

async function seedWorkspaceState(pool: Pool, workspaceId: string, userId: string) {
  await pool.query(
    `insert into workspace_states (workspace_id, encrypted_snapshot, updated_by_user_id)
     values ($1, '{}'::jsonb, $2)`,
    [workspaceId, userId],
  );
}

async function seedManualLedger(
  pool: Pool,
  seed: {
    userId: string;
    workspaceId: string;
    sourceId: string;
    itemId: string;
    merchant: string;
    decisionWorkspaceId?: string;
    evidenceSourceId?: string;
  },
) {
  await pool.query(
    `insert into data_sources (
       id, workspace_id, kind, display_name, coverage_start_at, coverage_end_at
     ) values ($1, $2, 'manual_entry', $3, now() - interval '30 days', now())`,
    [seed.sourceId, seed.workspaceId, `${seed.merchant} source`],
  );
  await pool.query(
    `insert into recurring_items (
       id, workspace_id, merchant, normalized_merchant, category, frequency,
       currency, amount_min, amount_max, average_amount, monthly_cost,
       annual_cost, last_charge_date, next_expected_date, confidence_score,
       status, recommendation_reason, risk_tags
     ) values (
       $1, $2, $3, $4, 'Software', 'monthly', 'INR',
       100.00, 100.00, 100.00, 100.00, 1200.00,
       current_date - 10, current_date + 20, 92, 'watch',
       'Review before renewal.', array['renewal-soon']::text[]
     )`,
    [seed.itemId, seed.workspaceId, seed.merchant, seed.merchant.toLowerCase()],
  );
  await pool.query(
    `insert into evidence_links (
       recurring_item_id, source_id, evidence_type, evidence_text, evidence_date, amount
     ) values ($1, $2, 'receipt', $3, current_date - 10, 100.00)`,
    [seed.itemId, seed.evidenceSourceId ?? seed.sourceId, `${seed.merchant} charged INR 100.`],
  );
  await pool.query(
    `insert into commitment_decisions (workspace_id, recurring_item_id, decided_by_user_id, action)
     values ($1, $2, $3, 'watch')`,
    [seed.decisionWorkspaceId ?? seed.workspaceId, seed.itemId, seed.userId],
  );
  await seedWorkspaceState(pool, seed.workspaceId, seed.userId);
}

async function assertCutoverBlockedWithoutRehome(
  pool: Pool,
  tenants: TenantPair,
  expected: {
    decisionWorkspaceId: string;
    itemWorkspaceId: string;
    sourceWorkspaceId: string;
    evidenceSourceId: string;
  },
) {
  await assert.rejects(() => migrateLegacyRecovery(pool), (error: unknown) => {
    assert.ok(error instanceof LegacyCutoverBlockedError);
    assert.match(error.message, /were not deleted/);
    assert.ok(
      error.blocked.crossWorkspaceDecisions > 0 || error.blocked.crossWorkspaceEvidence > 0,
      "cutover must name the cross-workspace relationship that blocked it",
    );
    return true;
  });
  const preserved = await pool.query<{
    decision_workspace: string;
    item_workspace: string;
    source_workspace: string;
    recovery_decisions: string;
    recovery_commitments: string;
    recovery_evidence: string;
    items: string;
    evidence_links: string;
  }>(
    `select
       (select workspace_id::text from commitment_decisions where recurring_item_id = $1) as decision_workspace,
       (select workspace_id::text from recurring_items where id = $1) as item_workspace,
       (select workspace_id::text from data_sources where id = $2) as source_workspace,
       (select count(*)::text from recovery_decisions) as recovery_decisions,
       (select count(*)::text from recovery_commitments) as recovery_commitments,
       (select count(*)::text from recovery_evidence) as recovery_evidence,
       (select count(*)::text from recurring_items where id = $1) as items,
       (select count(*)::text from evidence_links where recurring_item_id = $1) as evidence_links`,
    [tenants.itemA, expected.evidenceSourceId],
  );
  assert.deepEqual(preserved.rows[0], {
    decision_workspace: expected.decisionWorkspaceId,
    item_workspace: expected.itemWorkspaceId,
    source_workspace: expected.sourceWorkspaceId,
    recovery_decisions: "0",
    recovery_commitments: "0",
    recovery_evidence: "0",
    items: "1",
    evidence_links: "1",
  });
}
