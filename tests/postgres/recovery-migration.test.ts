import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
import {
  readRecoveryBackupVerification,
  recoveryBackupVerificationMatches,
  requiredAutopilotAuditCountKeys,
} from "../../scripts/lib/recovery-backup-verification.mjs";

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
  "recovery_commitment_context",
  "recovery_decision_cycles",
  "recovery_changes",
  "recovery_idempotency_keys",
  "recovery_inbound_aliases",
  "recovery_inbound_events",
  "recovery_inbound_sender_assessments",
  "recovery_source_health",
  "recovery_standing_mandates",
  "recovery_action_candidates",
  "recovery_covered_windows",
  "recovery_fee_ledger",
  "recovery_execution_attempts",
  "recovery_shadow_gate_snapshots",
  "recovery_notice_delivery_events",
  "recovery_notice_pending_events",
  "recovery_connected_mandate_cohort",
  "recovery_source_disconnections",
  "recovery_autopilot_dead_letters",
  "recovery_billing_year_anchors",
  "recovery_veto_notices",
  "recovery_classification_snapshots",
  "recovery_executions",
  "recovery_standing_mandate_events",
  "recovery_candidate_events",
  "recovery_operator_actions",
  "recovery_provider_disables",
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
    assert.equal(result.applied.at(-1)?.id, "0056_decision_cycle_expected_amount");

    const pool = createPool(connectionString);
    try {
      const migrations = await pool.query<{ id: string }>(
        `select id from schema_migrations order by id`,
      );
      assert.equal(migrations.rows.at(-1)?.id, "0056_decision_cycle_expected_amount");
      assert.equal(migrations.rows.length, 56);
      await assertRecoveryRelations(pool);
      const phaseA = await pool.query<{
        milestone_columns: number;
        immutable_trigger: boolean;
        event_names: string;
        metric_names: string;
      }>(
        `select
           (select count(*)::int
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'recovery_inbound_aliases'
              and column_name = any(array['setup_completed_at', 'forwarding_verified_at', 'backfill_completed_at'])) as milestone_columns,
           exists(select 1 from pg_trigger where tgname = 'recovery_inbound_alias_milestones_immutable') as immutable_trigger,
           (select pg_get_constraintdef(oid) from pg_constraint where conname = 'product_events_event_name_check') as event_names,
           (select pg_get_constraintdef(oid) from pg_constraint where conname = 'product_events_metrics_check1') as metric_names`,
      );
      assert.equal(phaseA.rows[0]?.milestone_columns, 3);
      assert.equal(phaseA.rows[0]?.immutable_trigger, true);
      assert.match(phaseA.rows[0]?.event_names ?? "", /receipt_setup\.completed/);
      assert.match(phaseA.rows[0]?.event_names ?? "", /receipt_backfill\.completed/);
      assert.match(phaseA.rows[0]?.metric_names ?? "", /secondsToTrustworthyPicture/);
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
      { id: "0031_autopilot_loop", mode: "applied-migration" },
      { id: "0032_autopilot_proof_integrity", mode: "applied-migration" },
      { id: "0033_autopilot_integrity", mode: "applied-migration" },
      { id: "0034_autopilot_repair", mode: "applied-migration" },
      { id: "0035_autopilot_codex_repair", mode: "applied-migration" },
      { id: "0036_autopilot_notice_hold", mode: "applied-migration" },
      { id: "0037_autopilot_clock_integrity", mode: "applied-migration" },
      { id: "0038_autopilot_reconcile_integrity", mode: "applied-migration" },
      { id: "0039_autopilot_frozen_notice_integrity", mode: "applied-migration" },
      { id: "0040_autopilot_review_integrity", mode: "applied-migration" },
      { id: "0041_workspace_activation_integrity", mode: "applied-migration" },
      { id: "0042_workspace_activation_semantic_reset", mode: "applied-migration" },
      { id: "0043_workspace_activation_semantic_version", mode: "applied-migration" },
      { id: "0044_autopilot_audit_immutability", mode: "applied-migration" },
      { id: "0045_autopilot_mandate_execution_immutability", mode: "applied-migration" },
      { id: "0046_billed_window_immutability", mode: "applied-migration" },
      { id: "0047_billed_window_insert_immutability", mode: "applied-migration" },
      { id: "0048_receipt_sender_provenance", mode: "applied-migration" },
      { id: "0049_recovery_merchant_identity", mode: "applied-migration" },
      { id: "0050_recovery_commitment_lifecycle", mode: "applied-migration" },
      { id: "0051_recovery_change_signals", mode: "applied-migration" },
      { id: "0052_recovery_correction_learning", mode: "applied-migration" },
      { id: "0053_phase_a_receipt_activation", mode: "applied-migration" },
      { id: "0054_recovery_commitment_context", mode: "applied-migration" },
      { id: "0055_recovery_decision_cycles", mode: "applied-migration" },
      { id: "0056_decision_cycle_expected_amount", mode: "applied-migration" },
    ]);

    const verifyPool = createPool(connectionString);
    try {
      const migration = await verifyPool.query<{ id: string }>(
        `select id from schema_migrations where id in ('0023_recovery_v1', '0024_recovery_inbound_receipts', '0025_recovery_renewal_alerts', '0026_recovery_inbound_retention', '0027_gmail_forwarding_verification', '0028_recovery_gmail_oauth_source', '0029_legacy_tenant_integrity', '0030_legacy_tenant_ownership_immutable', '0031_autopilot_loop', '0032_autopilot_proof_integrity', '0033_autopilot_integrity', '0034_autopilot_repair', '0035_autopilot_codex_repair', '0036_autopilot_notice_hold', '0037_autopilot_clock_integrity', '0038_autopilot_reconcile_integrity', '0039_autopilot_frozen_notice_integrity', '0040_autopilot_review_integrity', '0041_workspace_activation_integrity', '0042_workspace_activation_semantic_reset', '0043_workspace_activation_semantic_version', '0044_autopilot_audit_immutability', '0045_autopilot_mandate_execution_immutability', '0046_billed_window_immutability', '0047_billed_window_insert_immutability', '0048_receipt_sender_provenance', '0049_recovery_merchant_identity', '0050_recovery_commitment_lifecycle', '0051_recovery_change_signals', '0052_recovery_correction_learning', '0053_phase_a_receipt_activation', '0054_recovery_commitment_context', '0055_recovery_decision_cycles', '0056_decision_cycle_expected_amount')`,
      );
      assert.equal(migration.rowCount, 34);
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
      { id: "0031_autopilot_loop", mode: "applied-migration" },
      { id: "0032_autopilot_proof_integrity", mode: "applied-migration" },
      { id: "0033_autopilot_integrity", mode: "applied-migration" },
      { id: "0034_autopilot_repair", mode: "applied-migration" },
      { id: "0035_autopilot_codex_repair", mode: "applied-migration" },
      { id: "0036_autopilot_notice_hold", mode: "applied-migration" },
      { id: "0037_autopilot_clock_integrity", mode: "applied-migration" },
      { id: "0038_autopilot_reconcile_integrity", mode: "applied-migration" },
      { id: "0039_autopilot_frozen_notice_integrity", mode: "applied-migration" },
      { id: "0040_autopilot_review_integrity", mode: "applied-migration" },
      { id: "0041_workspace_activation_integrity", mode: "applied-migration" },
      { id: "0042_workspace_activation_semantic_reset", mode: "applied-migration" },
      { id: "0043_workspace_activation_semantic_version", mode: "applied-migration" },
      { id: "0044_autopilot_audit_immutability", mode: "applied-migration" },
      { id: "0045_autopilot_mandate_execution_immutability", mode: "applied-migration" },
      { id: "0046_billed_window_immutability", mode: "applied-migration" },
      { id: "0047_billed_window_insert_immutability", mode: "applied-migration" },
      { id: "0048_receipt_sender_provenance", mode: "applied-migration" },
      { id: "0049_recovery_merchant_identity", mode: "applied-migration" },
      { id: "0050_recovery_commitment_lifecycle", mode: "applied-migration" },
      { id: "0051_recovery_change_signals", mode: "applied-migration" },
      { id: "0052_recovery_correction_learning", mode: "applied-migration" },
      { id: "0053_phase_a_receipt_activation", mode: "applied-migration" },
      { id: "0054_recovery_commitment_context", mode: "applied-migration" },
      { id: "0055_recovery_decision_cycles", mode: "applied-migration" },
      { id: "0056_decision_cycle_expected_amount", mode: "applied-migration" },
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
        { id: "0031_autopilot_loop", mode: "applied-migration" },
        { id: "0032_autopilot_proof_integrity", mode: "applied-migration" },
        { id: "0033_autopilot_integrity", mode: "applied-migration" },
      { id: "0034_autopilot_repair", mode: "applied-migration" },
      { id: "0035_autopilot_codex_repair", mode: "applied-migration" },
      { id: "0036_autopilot_notice_hold", mode: "applied-migration" },
      { id: "0037_autopilot_clock_integrity", mode: "applied-migration" },
      { id: "0038_autopilot_reconcile_integrity", mode: "applied-migration" },
      { id: "0039_autopilot_frozen_notice_integrity", mode: "applied-migration" },
      { id: "0040_autopilot_review_integrity", mode: "applied-migration" },
      { id: "0041_workspace_activation_integrity", mode: "applied-migration" },
      { id: "0042_workspace_activation_semantic_reset", mode: "applied-migration" },
      { id: "0043_workspace_activation_semantic_version", mode: "applied-migration" },
      { id: "0044_autopilot_audit_immutability", mode: "applied-migration" },
      { id: "0045_autopilot_mandate_execution_immutability", mode: "applied-migration" },
      { id: "0046_billed_window_immutability", mode: "applied-migration" },
      { id: "0047_billed_window_insert_immutability", mode: "applied-migration" },
      { id: "0048_receipt_sender_provenance", mode: "applied-migration" },
      { id: "0049_recovery_merchant_identity", mode: "applied-migration" },
      { id: "0050_recovery_commitment_lifecycle", mode: "applied-migration" },
      { id: "0051_recovery_change_signals", mode: "applied-migration" },
      { id: "0052_recovery_correction_learning", mode: "applied-migration" },
      { id: "0053_phase_a_receipt_activation", mode: "applied-migration" },
      { id: "0054_recovery_commitment_context", mode: "applied-migration" },
      { id: "0055_recovery_decision_cycles", mode: "applied-migration" },
      { id: "0056_decision_cycle_expected_amount", mode: "applied-migration" },
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

test("0029 still lets a no-decision recurring item be reassigned into a cross-workspace evidence link", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("legacy_item_reassign_without_0030", async (connectionString) => {
    const applied = await installSchemaThrough0029(connectionString);
    assert.deepEqual(applied.applied, [{ id: "0029_legacy_tenant_integrity", mode: "applied-migration" }]);
    const pool = createPool(connectionString);
    const tenants = twoTenants();
    try {
      await seedTenants(pool, tenants);
      await seedManualLedger(pool, {
        userId: tenants.ownerA,
        workspaceId: tenants.workspaceA,
        sourceId: tenants.sourceA,
        itemId: tenants.itemA,
        merchant: "No-decision Item Tenant A",
        includeDecision: false,
      });
      await assertNoDecisionChild(pool, tenants.itemA);
      assert.equal(await countCrossWorkspaceEvidence(pool), "0");
      await pool.query(
        `update recurring_items set workspace_id = $1 where id = $2`,
        [tenants.workspaceB, tenants.itemA],
      );
      assert.equal(await countCrossWorkspaceEvidence(pool), "1");
      const ownership = await pool.query<{ item_workspace: string; source_workspace: string }>(
        `select
           (select workspace_id::text from recurring_items where id = $1) as item_workspace,
           (select workspace_id::text from data_sources where id = $2) as source_workspace`,
        [tenants.itemA, tenants.sourceA],
      );
      assert.deepEqual(ownership.rows[0], {
        item_workspace: tenants.workspaceB,
        source_workspace: tenants.workspaceA,
      });
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
        includeDecision: false,
      });
      await assertNoDecisionChild(pool, tenants.itemA);
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
        { id: "0031_autopilot_loop", mode: "applied-migration" },
        { id: "0032_autopilot_proof_integrity", mode: "applied-migration" },
        { id: "0033_autopilot_integrity", mode: "applied-migration" },
      { id: "0034_autopilot_repair", mode: "applied-migration" },
      { id: "0035_autopilot_codex_repair", mode: "applied-migration" },
      { id: "0036_autopilot_notice_hold", mode: "applied-migration" },
      { id: "0037_autopilot_clock_integrity", mode: "applied-migration" },
      { id: "0038_autopilot_reconcile_integrity", mode: "applied-migration" },
      { id: "0039_autopilot_frozen_notice_integrity", mode: "applied-migration" },
      { id: "0040_autopilot_review_integrity", mode: "applied-migration" },
      { id: "0041_workspace_activation_integrity", mode: "applied-migration" },
      { id: "0042_workspace_activation_semantic_reset", mode: "applied-migration" },
      { id: "0043_workspace_activation_semantic_version", mode: "applied-migration" },
      { id: "0044_autopilot_audit_immutability", mode: "applied-migration" },
      { id: "0045_autopilot_mandate_execution_immutability", mode: "applied-migration" },
      { id: "0046_billed_window_immutability", mode: "applied-migration" },
      { id: "0047_billed_window_insert_immutability", mode: "applied-migration" },
      { id: "0048_receipt_sender_provenance", mode: "applied-migration" },
      { id: "0049_recovery_merchant_identity", mode: "applied-migration" },
      { id: "0050_recovery_commitment_lifecycle", mode: "applied-migration" },
      { id: "0051_recovery_change_signals", mode: "applied-migration" },
      { id: "0052_recovery_correction_learning", mode: "applied-migration" },
      { id: "0053_phase_a_receipt_activation", mode: "applied-migration" },
      { id: "0054_recovery_commitment_context", mode: "applied-migration" },
      { id: "0055_recovery_decision_cycles", mode: "applied-migration" },
      { id: "0056_decision_cycle_expected_amount", mode: "applied-migration" },
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
        includeDecision: false,
      });
      await assertNoDecisionChild(pool, tenants.itemA);
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
      const sourceMove = assert.rejects(
        mover.query(
          `update data_sources set workspace_id = $1 where id = $2`,
          [tenants.workspaceB, tenants.sourceA],
        ),
        /Legacy workspace ownership is immutable/i,
      );
      await waitUntilSessionIsWaiting(pool, moverPid);
      await inserter.query("commit");
      await sourceMove;
      assert.equal(await countCrossWorkspaceEvidence(pool), "0");

      await inserter.query("begin");
      await inserter.query(
        `insert into evidence_links (
           recurring_item_id, source_id, evidence_type, evidence_text, evidence_date, amount
         ) values ($1, $2, 'receipt', 'Uncommitted item-guard evidence', current_date, 100.00)`,
        [tenants.itemA, tenants.sourceA],
      );
      const itemMove = assert.rejects(
        mover.query(
          `update recurring_items set workspace_id = $1 where id = $2`,
          [tenants.workspaceB, tenants.itemA],
        ),
        /Legacy workspace ownership is immutable/i,
      );
      await waitUntilSessionIsWaiting(pool, moverPid);
      await inserter.query("commit");
      await itemMove;
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

test("upgrading from 0030 through 0033 cannot insert fee rows until 0034 sets finalized_at default", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("autopilot_fee_upgrade", async (connectionString) => {
    const seedPool = createPool(connectionString);
    try {
      await seedSchemaThrough0022(seedPool);
    } finally {
      await seedPool.end();
    }
    runMigrations(connectionString, ["--through=0030_legacy_tenant_ownership_immutable"]);
    const through0033 = runMigrations(connectionString, ["--through=0033_autopilot_integrity"]);
    assert.equal(through0033.applied.at(-1)?.id, "0033_autopilot_integrity");
    const mid = createPool(connectionString);
    const userId = randomUUID();
    const workspaceId = randomUUID();
    try {
      await mid.query(`insert into users (id, email) values ($1, $2)`, [userId, `${userId}@fee-upgrade.test`]);
      await mid.query(
        `insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Fee upgrade')`,
        [workspaceId, userId],
      );
      await assert.rejects(
        mid.query(
          `insert into recovery_fee_ledger (
             workspace_id, period_start, period_end, currency, monitoring_minor, verified_saving_minor,
             outcome_fee_minor, retained_minor, refund_credit_minor, additional_charge_minor,
             razorpay_charge_status, inputs_hash, year_start
           ) values ($1, '2026-08-01', '2026-08-31', 'INR', 1, 0, 0, 0, 0, 0, 'FAIL_CLOSED', $2, '2026-08-15')`,
          [workspaceId, "b".repeat(64)],
        ),
        /finalized_at/i,
      );
    } finally {
      await mid.end();
    }
    const rest = runMigrations(connectionString);
    assert.deepEqual(rest.applied, [
      { id: "0034_autopilot_repair", mode: "applied-migration" },
      { id: "0035_autopilot_codex_repair", mode: "applied-migration" },
      { id: "0036_autopilot_notice_hold", mode: "applied-migration" },
      { id: "0037_autopilot_clock_integrity", mode: "applied-migration" },
      { id: "0038_autopilot_reconcile_integrity", mode: "applied-migration" },
      { id: "0039_autopilot_frozen_notice_integrity", mode: "applied-migration" },
      { id: "0040_autopilot_review_integrity", mode: "applied-migration" },
      { id: "0041_workspace_activation_integrity", mode: "applied-migration" },
      { id: "0042_workspace_activation_semantic_reset", mode: "applied-migration" },
      { id: "0043_workspace_activation_semantic_version", mode: "applied-migration" },
      { id: "0044_autopilot_audit_immutability", mode: "applied-migration" },
      { id: "0045_autopilot_mandate_execution_immutability", mode: "applied-migration" },
      { id: "0046_billed_window_immutability", mode: "applied-migration" },
      { id: "0047_billed_window_insert_immutability", mode: "applied-migration" },
      { id: "0048_receipt_sender_provenance", mode: "applied-migration" },
      { id: "0049_recovery_merchant_identity", mode: "applied-migration" },
      { id: "0050_recovery_commitment_lifecycle", mode: "applied-migration" },
      { id: "0051_recovery_change_signals", mode: "applied-migration" },
      { id: "0052_recovery_correction_learning", mode: "applied-migration" },
      { id: "0053_phase_a_receipt_activation", mode: "applied-migration" },
      { id: "0054_recovery_commitment_context", mode: "applied-migration" },
      { id: "0055_recovery_decision_cycles", mode: "applied-migration" },
      { id: "0056_decision_cycle_expected_amount", mode: "applied-migration" },
    ]);
    const pool = createPool(connectionString);
    try {
      await pool.query(
        `insert into recovery_fee_ledger (
           workspace_id, period_start, period_end, currency, monitoring_minor, verified_saving_minor,
           outcome_fee_minor, retained_minor, refund_credit_minor, additional_charge_minor,
           razorpay_charge_status, inputs_hash, year_start
         ) values ($1, '2026-08-01', '2026-08-31', 'INR', 1, 0, 0, 0, 0, 0, 'FAIL_CLOSED', $2, '2026-08-15')`,
        [workspaceId, "b".repeat(64)],
      );
      const stored = await pool.query<{ finalized: string | null; default_value: string | null }>(
        `select finalized_at::text as finalized,
                (select column_default from information_schema.columns
                 where table_name = 'recovery_fee_ledger' and column_name = 'finalized_at') as default_value
         from recovery_fee_ledger where workspace_id = $1`,
        [workspaceId],
      );
      assert.ok(stored.rows[0]?.finalized);
      assert.match(stored.rows[0]?.default_value ?? "", /now\(\)/);
      await assert.rejects(
        pool.query(`update recovery_fee_ledger set year_start = '2026-01-01' where workspace_id = $1`, [workspaceId]),
        /cannot be mutated/i,
      );
    } finally {
      await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
      await pool.query(`delete from users where id = $1`, [userId]);
      await pool.end();
    }
  });
});

test("upgrading a genuinely frozen 0037 notice retries through the real store and stays immutable after 0040", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("autopilot_frozen_notice_upgrade", async (connectionString) => {
    const seedPool = createPool(connectionString);
    try {
      await seedSchemaThrough0022(seedPool);
    } finally {
      await seedPool.end();
    }
    runMigrations(connectionString, ["--through=0037_autopilot_clock_integrity"]);
    const mid = createPool(connectionString);
    const ids = {
      userId: randomUUID(),
      workspaceId: randomUUID(),
      submissionId: randomUUID(),
      sourceId: randomUUID(),
      evidenceId: randomUUID(),
      commitmentId: randomUUID(),
      mandateId: randomUUID(),
      snapshotId: randomUUID(),
      candidateId: randomUUID(),
    };
    const fromEmail = "notices@vognary.test";
    const toEmail = "owner@upgrade.test";
    const subject = "Vognary Autopilot notice";
    const text = "OpenAI will be cancelled unless you veto within 48 hours.";
    const bodyHash = createHash("sha256").update(`${fromEmail}\0${toEmail}\0${subject}\0${text}`).digest("hex");
    try {
      await mid.query(`insert into users (id, email) values ($1, $2)`, [ids.userId, `${ids.userId}@frozen-upgrade.test`]);
      await mid.query(
        `insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Frozen notice upgrade')`,
        [ids.workspaceId, ids.userId],
      );
      await mid.query(
        `insert into recovery_submissions (id, workspace_id, source_type, accepted_evidence_count)
         values ($1, $2, 'RECEIPT_PASTE', 1)`,
        [ids.submissionId, ids.workspaceId],
      );
      await mid.query(
        `insert into recovery_sources (
           id, workspace_id, submission_id, source_type, client_ref, label, content_hash, raw_evidence
         ) values ($1, $2, $3, 'RECEIPT_PASTE', 'openai-july', 'Pasted receipt', $4, '{}'::jsonb)`,
        [ids.sourceId, ids.workspaceId, ids.submissionId, "a".repeat(64)],
      );
      await mid.query(
        `insert into recovery_evidence (
           id, workspace_id, source_id, fingerprint, evidence_kind, row_number, excerpt, merchant,
           normalized_merchant, category, provenance_reference, confidence_state
         ) values ($1, $2, $3, $4, 'RECEIPT', 1, 'OpenAI charged INR 1999', 'OpenAI', 'openai',
           'Software', 'paste:openai-july', 'HIGH')`,
        [ids.evidenceId, ids.workspaceId, ids.sourceId, "b".repeat(64)],
      );
      await mid.query(
        `insert into recovery_commitments (
           id, workspace_id, identity_key, base_status, base_merchant, base_category, base_cadence,
           base_currency, base_amount_minor, base_monthly_minor, effective_status, effective_merchant,
           effective_cadence, effective_amount_minor, effective_monthly_minor, confidence_score,
           recommended_decision, recommendation_reason
         ) values ($1, $2, 'openai-upgrade', 'ACTIVE', 'OpenAI', 'Software', 'MONTHLY', 'INR', 1999, 1999,
           'ACTIVE', 'OpenAI', 'MONTHLY', 1999, 1999, 90, 'CANCEL', 'Cited unexpected OpenAI debit.')`,
        [ids.commitmentId, ids.workspaceId],
      );
      await mid.query(
        `insert into recovery_standing_mandates (
           id, workspace_id, version, status, terms_version, signed_text, signed_text_hash,
           per_action_ceiling_minor, rolling_30d_ceiling_minor, signed_by_user_id
         ) values ($1, $2, 1, 'ACTIVE', 'mandate-v1',
           'Standing mandate signed for frozen notice upgrade fixture. Forty plus characters.',
           $3, 500000, 1500000, $4)`,
        [ids.mandateId, ids.workspaceId, "c".repeat(64), ids.userId],
      );
      await mid.query(
        `insert into consent_grants (workspace_id, user_id, subject_email, purpose, notice_version, source)
         values ($1, $2, $3, 'standing-mandate-autopilot', 'frozen-upgrade', 'frozen-upgrade')`,
        [ids.workspaceId, ids.userId, `${ids.userId}@frozen-upgrade.test`],
      );
      await mid.query(
        `insert into recovery_classification_snapshots (
           id, workspace_id, commitment_id, commitment_class, protected_override, cited_category,
           confidence_score, evidence_ids
         ) values ($1, $2, $3, 'discretionary-subscription', false, 'AI tools', 90, ARRAY[$4::uuid])`,
        [ids.snapshotId, ids.workspaceId, ids.commitmentId, ids.evidenceId],
      );
      await mid.query(
        `insert into recovery_action_candidates (
           id, workspace_id, commitment_id, mandate_id, mandate_version, classification_snapshot_id,
           commitment_class, eligibility, status, amount_minor, currency, provider_id
         ) values ($1, $2, $3, $4, 1, $5, 'discretionary-subscription', 'ELIGIBLE', 'NOTICE_QUEUED', 1999, 'INR', 'openai')`,
        [ids.candidateId, ids.workspaceId, ids.commitmentId, ids.mandateId, ids.snapshotId],
      );
      await mid.query(
        `insert into recovery_veto_notices (
           workspace_id, candidate_id, channel, delivery_status, notice_from_email, notice_to_email,
           notice_subject, notice_text, notice_body_hash, veto_token_hash, veto_expires_at, frozen_at
         ) values ($1, $2, 'EMAIL', 'QUEUED', $3, $4, $5, $6, $7, $8, now() + interval '48 hours', now())`,
        [ids.workspaceId, ids.candidateId, fromEmail, toEmail, subject, text, bodyHash, "d".repeat(64)],
      );
      const at0037 = await mid.query<{
        notice_from_email: string;
        notice_subject: string;
        notice_text: string;
      }>(
        `select notice_from_email, notice_subject, notice_text
         from recovery_veto_notices where workspace_id = $1`,
        [ids.workspaceId],
      );
      assert.deepEqual(at0037.rows[0], {
        notice_from_email: fromEmail,
        notice_subject: subject,
        notice_text: text,
      });
    } finally {
      await mid.end();
    }
    const rest = runMigrations(connectionString);
    assert.deepEqual(rest.applied, [
      { id: "0038_autopilot_reconcile_integrity", mode: "applied-migration" },
      { id: "0039_autopilot_frozen_notice_integrity", mode: "applied-migration" },
      { id: "0040_autopilot_review_integrity", mode: "applied-migration" },
      { id: "0041_workspace_activation_integrity", mode: "applied-migration" },
      { id: "0042_workspace_activation_semantic_reset", mode: "applied-migration" },
      { id: "0043_workspace_activation_semantic_version", mode: "applied-migration" },
      { id: "0044_autopilot_audit_immutability", mode: "applied-migration" },
      { id: "0045_autopilot_mandate_execution_immutability", mode: "applied-migration" },
      { id: "0046_billed_window_immutability", mode: "applied-migration" },
      { id: "0047_billed_window_insert_immutability", mode: "applied-migration" },
      { id: "0048_receipt_sender_provenance", mode: "applied-migration" },
      { id: "0049_recovery_merchant_identity", mode: "applied-migration" },
      { id: "0050_recovery_commitment_lifecycle", mode: "applied-migration" },
      { id: "0051_recovery_change_signals", mode: "applied-migration" },
      { id: "0052_recovery_correction_learning", mode: "applied-migration" },
      { id: "0053_phase_a_receipt_activation", mode: "applied-migration" },
      { id: "0054_recovery_commitment_context", mode: "applied-migration" },
      { id: "0055_recovery_decision_cycles", mode: "applied-migration" },
      { id: "0056_decision_cycle_expected_amount", mode: "applied-migration" },
    ]);
    const retryOutput = execFileSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import=tsx",
        "tests/helpers/retry-frozen-autopilot-notice.ts",
        ids.workspaceId,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: connectionString,
          POSTGRES_SSL: "false",
          AUTOPILOT_NOTICE_ENABLED: "true",
          AUTOPILOT_NOTICE_CHANNEL_READY: "true",
          AUTOPILOT_TEST_ADAPTER: "true",
          AUTOPILOT_TEST_PROVEN_PROVIDER_IDS: "openai",
          AUTOPILOT_VETO_TOKEN_SECRET: "upgrade-veto-signing-secret-32bytes!!",
          RESEND_FROM_EMAIL: fromEmail,
        },
      },
    );
    const retried = JSON.parse(retryOutput.trim()) as {
      accepted: number;
    };
    assert.equal(retried.accepted, 1);
    const pool = createPool(connectionString);
    try {
      const upgraded = await pool.query<{
        notice_from_email: string;
        notice_to_email: string;
        notice_subject: string;
        notice_text: string;
        notice_tags: unknown;
        notice_payload_version: number;
      }>(
        `select notice_from_email, notice_to_email, notice_subject, notice_text, notice_tags, notice_payload_version
         from recovery_veto_notices where workspace_id = $1`,
        [ids.workspaceId],
      );
      assert.equal(upgraded.rows[0]?.notice_from_email, fromEmail);
      assert.equal(upgraded.rows[0]?.notice_to_email, toEmail);
      assert.equal(upgraded.rows[0]?.notice_subject, subject);
      assert.equal(upgraded.rows[0]?.notice_text, text);
      assert.equal(upgraded.rows[0]?.notice_payload_version, 1);
      assert.ok(Array.isArray(upgraded.rows[0]?.notice_tags));
      await assert.rejects(
        pool.query(`update recovery_veto_notices set notice_text = 'mutated after 0039' where workspace_id = $1`, [ids.workspaceId]),
        /frozen notice payload cannot be mutated/i,
      );
      await assert.rejects(
        pool.query(
          `update recovery_veto_notices set notice_tags = $2::jsonb where workspace_id = $1`,
          [ids.workspaceId, JSON.stringify([{ name: "vognary", value: "mutated-after-upgrade" }])],
        ),
        /frozen notice payload cannot be mutated/i,
      );
      const afterDelivery = await pool.query<{ notice_text: string; delivery_status: string }>(
        `select notice_text, delivery_status from recovery_veto_notices where workspace_id = $1`,
        [ids.workspaceId],
      );
      assert.equal(afterDelivery.rows[0]?.notice_text, text);
      assert.equal(afterDelivery.rows[0]?.delivery_status, "ACCEPTED");
      await assert.rejects(
        pool.query(`delete from recovery_veto_notices where workspace_id = $1`, [ids.workspaceId]),
        /Frozen notice cannot be deleted directly/i,
      );
    } finally {
      await pool.query(`delete from workspaces where id = $1`, [ids.workspaceId]);
      await pool.query(`delete from users where id = $1`, [ids.userId]);
      await pool.end();
    }
  });
});

test("0042 purges legacy workspace.activated rows that 0041 would have preserved, then a consented cited Home records exactly one", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("workspace_activation_semantic_reset", async (connectionString) => {
    const seedPool = createPool(connectionString);
    try {
      await seedSchemaThrough0022(seedPool);
    } finally {
      await seedPool.end();
    }

    runMigrations(connectionString, ["--through=0040_autopilot_review_integrity"]);
    const mid = createPool(connectionString);
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const email = `activation-reset-${userId.slice(0, 8)}@example.test`;
    const activationCount = async (pool: typeof mid) => Number((await pool.query<{ n: string }>(
      `select count(*)::text as n from product_events where workspace_id = $1 and event_name = 'workspace.activated'`,
      [workspaceId],
    )).rows[0]?.n ?? 0);
    const unrelatedCount = async (pool: typeof mid) => Number((await pool.query<{ n: string }>(
      `select count(*)::text as n from product_events where workspace_id = $1 and event_name = 'ledger.viewed'`,
      [workspaceId],
    )).rows[0]?.n ?? 0);

    try {
      await mid.query(`drop index if exists product_events_workspace_activated_once_idx`);
      await mid.query(`insert into users (id, email) values ($1, $2)`, [userId, email]);
      await mid.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Legacy activation')`, [workspaceId, userId]);
      await mid.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);
      await mid.query(
        `insert into product_events (workspace_id, user_id, event_name, source, status, occurred_at, metrics)
         values
           ($1, $2, 'workspace.activated', 'workspace-api', 'succeeded', '2026-07-01T00:00:00.000Z', '{}'::jsonb),
           ($1, $2, 'workspace.activated', 'workspace-api', 'succeeded', '2026-07-02T00:00:00.000Z', '{}'::jsonb),
           ($1, $2, 'ledger.viewed', 'workspace-api', 'succeeded', '2026-07-03T00:00:00.000Z', '{}'::jsonb)`,
        [workspaceId, userId],
      );
      assert.equal(await activationCount(mid), 2);
      assert.equal(await unrelatedCount(mid), 1);
    } finally {
      await mid.end();
    }

    const through0041 = runMigrations(connectionString, ["--through=0041_workspace_activation_integrity"]);
    assert.deepEqual(through0041.applied, [{ id: "0041_workspace_activation_integrity", mode: "applied-migration" }]);
    const after0041 = createPool(connectionString);
    try {
      assert.equal(await activationCount(after0041), 1);
      assert.equal(await unrelatedCount(after0041), 1);
      const index = await after0041.query<{ indexdef: string }>(
        `select indexdef from pg_indexes where indexname = 'product_events_workspace_activated_once_idx'`,
      );
      assert.match(index.rows[0]?.indexdef ?? "", /unique/i);
    } finally {
      await after0041.end();
    }

    const rest = runMigrations(connectionString, ["--through=0042_workspace_activation_semantic_reset"]);
    assert.deepEqual(rest.applied, [{ id: "0042_workspace_activation_semantic_reset", mode: "applied-migration" }]);
    const after0042 = createPool(connectionString);
    try {
      assert.equal(await activationCount(after0042), 0);
      assert.equal(await unrelatedCount(after0042), 1);
    } finally {
      await after0042.end();
    }

    const marker = runMigrations(connectionString);
    assert.deepEqual(marker.applied, [
      { id: "0043_workspace_activation_semantic_version", mode: "applied-migration" },
      { id: "0044_autopilot_audit_immutability", mode: "applied-migration" },
      { id: "0045_autopilot_mandate_execution_immutability", mode: "applied-migration" },
      { id: "0046_billed_window_immutability", mode: "applied-migration" },
      { id: "0047_billed_window_insert_immutability", mode: "applied-migration" },
      { id: "0048_receipt_sender_provenance", mode: "applied-migration" },
      { id: "0049_recovery_merchant_identity", mode: "applied-migration" },
      { id: "0050_recovery_commitment_lifecycle", mode: "applied-migration" },
      { id: "0051_recovery_change_signals", mode: "applied-migration" },
      { id: "0052_recovery_correction_learning", mode: "applied-migration" },
      { id: "0053_phase_a_receipt_activation", mode: "applied-migration" },
      { id: "0054_recovery_commitment_context", mode: "applied-migration" },
      { id: "0055_recovery_decision_cycles", mode: "applied-migration" },
      { id: "0056_decision_cycle_expected_amount", mode: "applied-migration" },
    ]);

    const helperOutput = execFileSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import=tsx",
        "tests/helpers/qualify-workspace-activation.ts",
        workspaceId,
        userId,
        email,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: connectionString,
          POSTGRES_SSL: "false",
          SESSION_SECRET: process.env.SESSION_SECRET || "activation-reset-session-secret-at-least-32-bytes",
          TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY || "11".repeat(32),
          ALLOW_IN_MEMORY_RATE_LIMITS: process.env.ALLOW_IN_MEMORY_RATE_LIMITS || "true",
        },
      },
    );
    const lastJsonLine = helperOutput.trim().split("\n").filter((line) => line.startsWith("{")).at(-1);
    const qualified = JSON.parse(lastJsonLine ?? "null") as {
      recorded: boolean;
      activeCommitmentCount: number;
      concurrentStatuses: number[];
    };
    assert.equal(qualified.recorded, true);
    assert.equal(qualified.activeCommitmentCount, 1);
    assert.equal(qualified.concurrentStatuses.length, 8);
    assert.ok(qualified.concurrentStatuses.every((status) => status === 200));

    const finalPool = createPool(connectionString);
    try {
      assert.equal(await activationCount(finalPool), 1);
      assert.equal(await unrelatedCount(finalPool), 1);
    } finally {
      await finalPool.query(`delete from workspaces where id = $1`, [workspaceId]);
      await finalPool.query(`delete from users where id = $1`, [userId]);
      await finalPool.end();
    }
  });
});

test("0043 requires a semantic-version marker so old-style activations cannot be reinserted after reset", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("workspace_activation_semantic_version", async (connectionString) => {
    const seedPool = createPool(connectionString);
    try {
      await seedSchemaThrough0022(seedPool);
    } finally {
      await seedPool.end();
    }

    runMigrations(connectionString, ["--through=0042_workspace_activation_semantic_reset"]);
    const before = createPool(connectionString);
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const email = `activation-marker-${userId.slice(0, 8)}@example.test`;
    const activationCount = async (pool: typeof before) => Number((await pool.query<{ n: string }>(
      `select count(*)::text as n from product_events where workspace_id = $1 and event_name = 'workspace.activated'`,
      [workspaceId],
    )).rows[0]?.n ?? 0);

    try {
      await before.query(`insert into users (id, email) values ($1, $2)`, [userId, email]);
      await before.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Marker activation')`, [workspaceId, userId]);
      await before.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);
      await before.query(
        `insert into product_events (workspace_id, user_id, event_name, source, status, occurred_at, metrics)
         values ($1, $2, 'workspace.activated', 'workspace-api', 'succeeded', '2026-07-01T00:00:00.000Z', '{}'::jsonb)`,
        [workspaceId, userId],
      );
      assert.equal(await activationCount(before), 1);
    } finally {
      await before.end();
    }

    const applied = runMigrations(connectionString);
    assert.deepEqual(applied.applied, [
      { id: "0043_workspace_activation_semantic_version", mode: "applied-migration" },
      { id: "0044_autopilot_audit_immutability", mode: "applied-migration" },
      { id: "0045_autopilot_mandate_execution_immutability", mode: "applied-migration" },
      { id: "0046_billed_window_immutability", mode: "applied-migration" },
      { id: "0047_billed_window_insert_immutability", mode: "applied-migration" },
      { id: "0048_receipt_sender_provenance", mode: "applied-migration" },
      { id: "0049_recovery_merchant_identity", mode: "applied-migration" },
      { id: "0050_recovery_commitment_lifecycle", mode: "applied-migration" },
      { id: "0051_recovery_change_signals", mode: "applied-migration" },
      { id: "0052_recovery_correction_learning", mode: "applied-migration" },
      { id: "0053_phase_a_receipt_activation", mode: "applied-migration" },
      { id: "0054_recovery_commitment_context", mode: "applied-migration" },
      { id: "0055_recovery_decision_cycles", mode: "applied-migration" },
      { id: "0056_decision_cycle_expected_amount", mode: "applied-migration" },
    ]);

    const after = createPool(connectionString);
    try {
      assert.equal(await activationCount(after), 0);
      await assert.rejects(
        () => after.query(
          `insert into product_events (workspace_id, user_id, event_name, source, status, metrics)
           values ($1, $2, 'workspace.activated', 'workspace-api', 'succeeded', '{}'::jsonb)`,
          [workspaceId, userId],
        ),
        /activation_semantic_version|semantic version|check/i,
      );
      assert.equal(await activationCount(after), 0);
    } finally {
      await after.end();
    }

    const helperOutput = execFileSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import=tsx",
        "tests/helpers/qualify-workspace-activation.ts",
        workspaceId,
        userId,
        email,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: connectionString,
          POSTGRES_SSL: "false",
          SESSION_SECRET: process.env.SESSION_SECRET || "activation-marker-session-secret-at-least-32-bytes",
          TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY || "11".repeat(32),
          ALLOW_IN_MEMORY_RATE_LIMITS: process.env.ALLOW_IN_MEMORY_RATE_LIMITS || "true",
        },
      },
    );
    const lastJsonLine = helperOutput.trim().split("\n").filter((line) => line.startsWith("{")).at(-1);
    const qualified = JSON.parse(lastJsonLine ?? "null") as {
      recorded: boolean;
      activeCommitmentCount: number;
      concurrentStatuses: number[];
    };
    assert.equal(qualified.recorded, true);
    assert.equal(qualified.activeCommitmentCount, 1);
    assert.equal(qualified.concurrentStatuses.length, 8);
    assert.ok(qualified.concurrentStatuses.every((status) => status === 200));

    const finalPool = createPool(connectionString);
    try {
      assert.equal(await activationCount(finalPool), 1);
      const marker = await finalPool.query<{ version: number | null }>(
        `select activation_semantic_version as version
         from product_events
         where workspace_id = $1 and event_name = 'workspace.activated'`,
        [workspaceId],
      );
      assert.equal(marker.rows[0]?.version, 1);
      await assert.rejects(
        () => finalPool.query(
          `insert into product_events (workspace_id, user_id, event_name, source, status, metrics)
           values ($1, $2, 'workspace.activated', 'workspace-api', 'succeeded', '{}'::jsonb)`,
          [workspaceId, userId],
        ),
        /activation_semantic_version|semantic version|check|unique|duplicate/i,
      );
    } finally {
      await finalPool.query(`delete from workspaces where id = $1`, [workspaceId]);
      await finalPool.query(`delete from users where id = $1`, [userId]);
      await finalPool.end();
    }
  });
});

test("production-upgrade rehearsal from 0030 preserves Recovery facts through 0047 and fail-closes old activation writes", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("autopilot_upgrade_rehearsal", async (connectionString) => {
    const seedPool = createPool(connectionString);
    try {
      await seedSchemaThrough0022(seedPool);
    } finally {
      await seedPool.end();
    }
    runMigrations(connectionString, ["--through=0030_legacy_tenant_ownership_immutable"]);
    const before = createPool(connectionString);
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const submissionId = randomUUID();
    const sourceId = randomUUID();
    const evidenceId = randomUUID();
    const commitmentId = randomUUID();
    const email = `rehearsal-${userId.slice(0, 8)}@example.test`;
    try {
      await before.query(`insert into users (id, email) values ($1, $2)`, [userId, email]);
      await before.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Upgrade rehearsal')`, [workspaceId, userId]);
      await before.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);
      await before.query(
        `insert into consent_grants (workspace_id, user_id, subject_email, purpose, notice_version, source)
         values ($1, $2, $3, 'product-analytics-opt-in', 'rehearsal', 'rehearsal')`,
        [workspaceId, userId, email],
      );
      await before.query(
        `insert into recovery_submissions (id, workspace_id, source_type, accepted_evidence_count)
         values ($1, $2, 'RECEIPT_PASTE', 1)`,
        [submissionId, workspaceId],
      );
      await before.query(
        `insert into recovery_sources (
           id, workspace_id, submission_id, source_type, client_ref, label, content_hash, raw_evidence
         ) values ($1, $2, $3, 'RECEIPT_PASTE', 'openai-rehearsal', 'Pasted receipt', $4, '{}'::jsonb)`,
        [sourceId, workspaceId, submissionId, "a".repeat(64)],
      );
      await before.query(
        `insert into recovery_evidence (
           id, workspace_id, source_id, fingerprint, evidence_kind, row_number, excerpt, merchant,
           normalized_merchant, category, provenance_reference, confidence_state
         ) values ($1, $2, $3, $4, 'RECEIPT', 1, 'OpenAI charged INR 1999', 'OpenAI', 'openai',
           'Software', 'paste:openai-rehearsal', 'HIGH')`,
        [evidenceId, workspaceId, sourceId, "b".repeat(64)],
      );
      await before.query(
        `insert into recovery_commitments (
           id, workspace_id, identity_key, base_status, base_merchant, base_category, base_cadence,
           base_currency, base_amount_minor, base_monthly_minor, effective_status, effective_merchant,
           effective_cadence, effective_amount_minor, effective_monthly_minor, confidence_score,
           recommended_decision, recommendation_reason
         ) values ($1, $2, 'openai-rehearsal', 'ACTIVE', 'OpenAI', 'Software', 'MONTHLY', 'INR', 1999, 1999,
           'ACTIVE', 'OpenAI', 'MONTHLY', 1999, 1999, 90, 'KEEP', 'Cited OpenAI debit.')`,
        [commitmentId, workspaceId],
      );
      await before.query(
        `insert into product_events (workspace_id, user_id, event_name, source, status, metrics)
         values ($1, $2, 'ledger.viewed', 'product-ui', 'succeeded', '{}'::jsonb)`,
        [workspaceId, userId],
      );
      const beforeCounts = await before.query<{ evidence: string; commitments: string; consents: string; events: string }>(
        `select
           (select count(*)::text from recovery_evidence where workspace_id = $1) as evidence,
           (select count(*)::text from recovery_commitments where workspace_id = $1) as commitments,
           (select count(*)::text from consent_grants where workspace_id = $1) as consents,
           (select count(*)::text from product_events where workspace_id = $1) as events`,
        [workspaceId],
      );
      assert.deepEqual(beforeCounts.rows[0], { evidence: "1", commitments: "1", consents: "1", events: "1" });
    } finally {
      await before.end();
    }

    const applied = runMigrations(connectionString);
    assert.deepEqual(applied.applied.map((row) => row.id), [
      "0031_autopilot_loop",
      "0032_autopilot_proof_integrity",
      "0033_autopilot_integrity",
      "0034_autopilot_repair",
      "0035_autopilot_codex_repair",
      "0036_autopilot_notice_hold",
      "0037_autopilot_clock_integrity",
      "0038_autopilot_reconcile_integrity",
      "0039_autopilot_frozen_notice_integrity",
      "0040_autopilot_review_integrity",
      "0041_workspace_activation_integrity",
      "0042_workspace_activation_semantic_reset",
      "0043_workspace_activation_semantic_version",
      "0044_autopilot_audit_immutability",
      "0045_autopilot_mandate_execution_immutability",
      "0046_billed_window_immutability",
      "0047_billed_window_insert_immutability",
      "0048_receipt_sender_provenance",
      "0049_recovery_merchant_identity",
      "0050_recovery_commitment_lifecycle",
      "0051_recovery_change_signals",
      "0052_recovery_correction_learning",
      "0053_phase_a_receipt_activation",
      "0054_recovery_commitment_context",
      "0055_recovery_decision_cycles",
      "0056_decision_cycle_expected_amount",
    ]);

    const after = createPool(connectionString);
    try {
      const afterCounts = await after.query<{ evidence: string; commitments: string; consents: string; events: string }>(
        `select
           (select count(*)::text from recovery_evidence where workspace_id = $1) as evidence,
           (select count(*)::text from recovery_commitments where workspace_id = $1) as commitments,
           (select count(*)::text from consent_grants where workspace_id = $1) as consents,
           (select count(*)::text from product_events where workspace_id = $1) as events`,
        [workspaceId],
      );
      assert.deepEqual(afterCounts.rows[0], { evidence: "1", commitments: "1", consents: "1", events: "1" });
      await assert.rejects(
        () => after.query(
          `insert into product_events (workspace_id, user_id, event_name, source, status, metrics)
           values ($1, $2, 'workspace.activated', 'workspace-api', 'succeeded', '{}'::jsonb)`,
          [workspaceId, userId],
        ),
        /activation_semantic_version|semantic version|check/i,
      );
      await after.query(
        `insert into recovery_fee_ledger (
           workspace_id, period_start, period_end, currency, monitoring_minor, verified_saving_minor,
           outcome_fee_minor, retained_minor, refund_credit_minor, additional_charge_minor,
           razorpay_charge_status, inputs_hash, year_start
         ) values ($1, '2026-08-01', '2026-08-31', 'INR', 0, 0, 0, 0, 0, 0, 'FAIL_CLOSED', $2, '2026-08-01')`,
        [workspaceId, "c".repeat(64)],
      );
      await seedAutopilotAuditFacts(after, { workspaceId, userId, commitmentId, evidenceId });
      const verification = await readRecoveryBackupVerification(after);
      for (const key of requiredAutopilotAuditCountKeys) {
        assert.notEqual(verification.recoveryWorkspaceCounts[key], "0", `${key} must be seeded for restore drills`);
      }
      await assert.rejects(
        after.query(`delete from recovery_fee_ledger where workspace_id = $1`, [workspaceId]),
        /cannot be deleted directly/i,
      );
      await assertRecoveryRelations(after);
    } finally {
      await after.query(`delete from workspaces where id = $1`, [workspaceId]).catch(() => undefined);
      await after.query(`delete from users where id = $1`, [userId]).catch(() => undefined);
      await after.end();
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

async function seedAutopilotAuditFacts(
  pool: Pool,
  ids: { workspaceId: string; userId: string; commitmentId: string; evidenceId: string },
) {
  const mandate = await pool.query<{ id: string }>(
    `insert into recovery_standing_mandates (
       workspace_id, version, status, terms_version, signed_text, signed_text_hash,
       per_action_ceiling_minor, rolling_30d_ceiling_minor, veto_window_hours, signed_by_user_id
     ) values ($1, 1, 'ACTIVE', 'standing-mandate-2026-08-16', $2, $3, 5000000, 20000000, 48, $4)
     returning id`,
    [ids.workspaceId, "I authorize Vognary to cancel supported discretionary subscriptions under this standing mandate for rehearsal.", "b".repeat(64), ids.userId],
  );
  await pool.query(
    `insert into recovery_standing_mandate_events (workspace_id, mandate_id, kind, actor_user_id)
     values ($1, $2, 'SIGNED', $3)`,
    [ids.workspaceId, mandate.rows[0]!.id, ids.userId],
  );
  const snapshot = await pool.query<{ id: string }>(
    `insert into recovery_classification_snapshots (
       workspace_id, commitment_id, commitment_class, protected_override, cited_category,
       cited_merchant, confidence_score, evidence_ids
     ) values ($1, $2, 'discretionary-subscription', false, 'Software', 'OpenAI', 90, $3)
     returning id`,
    [ids.workspaceId, ids.commitmentId, [ids.evidenceId]],
  );
  const candidate = await pool.query<{ id: string }>(
    `insert into recovery_action_candidates (
       workspace_id, commitment_id, mandate_id, mandate_version, classification_snapshot_id,
       commitment_class, eligibility, status, amount_minor, currency
     ) values ($1, $2, $3, 1, $4, 'discretionary-subscription', 'ELIGIBLE', 'SHADOW', 199900, 'INR')
     returning id`,
    [ids.workspaceId, ids.commitmentId, mandate.rows[0]!.id, snapshot.rows[0]!.id],
  );
  await pool.query(
    `insert into recovery_candidate_events (workspace_id, candidate_id, previous_status, status, actor_kind, reason_code)
     values ($1, $2, null, 'SHADOW', 'SYSTEM', 'shadow-created')`,
    [ids.workspaceId, candidate.rows[0]!.id],
  );
  await pool.query(
    `insert into recovery_operator_actions (workspace_id, candidate_id, actor_user_id, minutes, outcome)
     values ($1, $2, $3, 1, 'EXCEPTION')`,
    [ids.workspaceId, candidate.rows[0]!.id, ids.userId],
  );
  await pool.query(
    `insert into recovery_execution_attempts (
       workspace_id, candidate_id, attempt_no, operation_key, request_hash, provider_id, status
     ) values ($1, $2, 1, $3, $4, 'openai', 'AUTHORIZED')`,
    [ids.workspaceId, candidate.rows[0]!.id, `rehearsal-op-${ids.workspaceId.slice(0, 8)}`, "e".repeat(64)],
  );
  await pool.query(
    `insert into recovery_executions (
       workspace_id, candidate_id, provider_id, route, actor_kind, outcome, attempt_no
     ) values ($1, $2, 'openai', 'unsupported', 'OPERATOR', 'EXCEPTION', 1)`,
    [ids.workspaceId, candidate.rows[0]!.id],
  );
}

test("pg_dump/pg_restore preserves the exact pre-0053 production profile", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("pre_0053_dump_source", async (sourceUrl) => {
    const seed = createPool(sourceUrl);
    try {
      await seedSchemaThrough0022(seed);
    } finally {
      await seed.end();
    }
    runMigrations(sourceUrl, ["--through=0026_recovery_inbound_retention"]);
    const source = createPool(sourceUrl);
    const dumpDir = mkdtempSync(path.join(tmpdir(), "vognary-pre-0053-dump-"));
    const dumpPath = path.join(dumpDir, "pre-0053.dump");
    try {
      const expected = await readRecoveryBackupVerification(source, "pre-0053");
      assert.equal(expected.migrationHead, "0026_recovery_inbound_retention");
      execFileSync("pg_dump", ["--format=custom", "--no-owner", "--no-acl", `--dbname=${sourceUrl}`, `--file=${dumpPath}`]);
      await withDisposableDatabase("pre_0053_dump_target", async (targetUrl) => {
        execFileSync("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error", `--dbname=${targetUrl}`, dumpPath]);
        const restored = createPool(targetUrl);
        try {
          const actual = await readRecoveryBackupVerification(restored, "pre-0053");
          assert.deepEqual(actual, expected);
          assert.equal(recoveryBackupVerificationMatches(expected, actual), true);
        } finally {
          await restored.end();
        }
      });
    } finally {
      rmSync(dumpDir, { recursive: true, force: true });
      await source.end();
    }
  });
});

test("pg_dump/pg_restore preserves Recovery and audit counts through 0054", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  await withDisposableDatabase("autopilot_dump_source", async (sourceUrl) => {
    runMigrations(sourceUrl);
    const source = createPool(sourceUrl);
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const submissionId = randomUUID();
    const sourceId = randomUUID();
    const evidenceId = randomUUID();
    const commitmentId = randomUUID();
    try {
      await source.query(`insert into users (id, email) values ($1, $2)`, [userId, `${userId}@dump.test`]);
      await source.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Dump source')`, [workspaceId, userId]);
      await source.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);
      await source.query(
        `insert into recovery_submissions (id, workspace_id, source_type, accepted_evidence_count)
         values ($1, $2, 'RECEIPT_PASTE', 1)`,
        [submissionId, workspaceId],
      );
      await source.query(
        `insert into recovery_sources (
           id, workspace_id, submission_id, source_type, client_ref, label, content_hash, raw_evidence
         ) values ($1, $2, $3, 'RECEIPT_PASTE', 'openai-dump', 'Pasted receipt', $4, '{}'::jsonb)`,
        [sourceId, workspaceId, submissionId, "a".repeat(64)],
      );
      await source.query(
        `insert into recovery_evidence (
           id, workspace_id, source_id, fingerprint, evidence_kind, row_number, excerpt, merchant,
           normalized_merchant, category, provenance_reference, confidence_state
         ) values ($1, $2, $3, $4, 'RECEIPT', 1, 'OpenAI charged INR 1999', 'OpenAI', 'openai',
           'Software', 'paste:openai-dump', 'HIGH')`,
        [evidenceId, workspaceId, sourceId, "b".repeat(64)],
      );
      await source.query(
        `insert into recovery_commitments (
           id, workspace_id, identity_key, base_status, base_merchant, base_category, base_cadence,
           base_currency, base_amount_minor, base_monthly_minor, effective_status, effective_merchant,
           effective_cadence, effective_amount_minor, effective_monthly_minor, confidence_score,
           recommended_decision, recommendation_reason
         ) values ($1, $2, 'openai-dump', 'ACTIVE', 'OpenAI', 'Software', 'MONTHLY', 'INR', 1999, 1999,
           'ACTIVE', 'OpenAI', 'MONTHLY', 1999, 1999, 90, 'KEEP', 'Cited OpenAI debit.')`,
        [commitmentId, workspaceId],
      );
      await seedAutopilotAuditFacts(source, { workspaceId, userId, commitmentId, evidenceId });
      const expected = await readRecoveryBackupVerification(source);
      for (const key of requiredAutopilotAuditCountKeys) {
        assert.notEqual(expected.recoveryWorkspaceCounts[key], "0", key);
      }
      const dumpDir = mkdtempSync(path.join(tmpdir(), "vognary-pg-dump-"));
      const dumpPath = path.join(dumpDir, "audit.dump");
      try {
        execFileSync("pg_dump", ["--format=custom", "--no-owner", "--no-acl", `--dbname=${sourceUrl}`, `--file=${dumpPath}`]);
        await withDisposableDatabase("autopilot_dump_target", async (targetUrl) => {
          execFileSync("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error", `--dbname=${targetUrl}`, dumpPath]);
          const restored = createPool(targetUrl);
          try {
            const actual = await readRecoveryBackupVerification(restored);
            assert.deepEqual(actual, expected, "restored Recovery verification must exactly match the source manifest");
            assert.equal(recoveryBackupVerificationMatches(expected, actual), true);
            for (const key of requiredAutopilotAuditCountKeys) {
              assert.notEqual(actual.recoveryWorkspaceCounts[key], "0", key);
            }
          } finally {
            await restored.end();
          }
        });
      } finally {
        rmSync(dumpDir, { recursive: true, force: true });
      }
    } finally {
      await source.query(`delete from workspaces where id = $1`, [workspaceId]).catch(() => undefined);
      await source.query(`delete from users where id = $1`, [userId]).catch(() => undefined);
      await source.end();
    }
  });
});

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

async function installSchemaThrough0029(connectionString: string) {
  await installSchemaThrough0028(connectionString);
  return runMigrations(connectionString, ["--through=0029_legacy_tenant_integrity"]);
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
    includeDecision?: boolean;
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
  if (seed.includeDecision !== false) {
    await pool.query(
      `insert into commitment_decisions (workspace_id, recurring_item_id, decided_by_user_id, action)
       values ($1, $2, $3, 'watch')`,
      [seed.decisionWorkspaceId ?? seed.workspaceId, seed.itemId, seed.userId],
    );
  }
  await seedWorkspaceState(pool, seed.workspaceId, seed.userId);
}

async function assertNoDecisionChild(pool: Pool, itemId: string) {
  const result = await pool.query<{ decisions: string }>(
    `select count(*)::text as decisions from commitment_decisions where recurring_item_id = $1`,
    [itemId],
  );
  assert.equal(result.rows[0]?.decisions, "0");
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
