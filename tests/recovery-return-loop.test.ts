import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("infra/postgres/migrations/0025_recovery_renewal_alerts.sql", "utf8");
const schema = readFileSync("infra/postgres/schema.sql", "utf8");
const alerts = readFileSync("src/lib/server/renewal-alert-store.ts", "utf8");
const recoveryStore = readFileSync("src/lib/server/recovery-store.ts", "utf8");
const connectorRunner = readFileSync("src/lib/server/connector-sync-runner.ts", "utf8");
const retirementMigration = readFileSync("infra/postgres/migrations/0026_recovery_inbound_retention.sql", "utf8");
const vercel = readFileSync("vercel.json", "utf8");

test("renewal deliveries accept exactly one legacy or Recovery target", () => {
  for (const sql of [migration, schema]) {
    const targetAlter = sql.slice(sql.indexOf("alter table renewal_alert_deliveries\n  alter column recurring_item_id drop not null"));
    assert.ok(targetAlter.length > 0, "renewal target migration must alter the delivery table");
    assert.match(targetAlter, /add column if not exists recovery_commitment_id uuid/i);
    assert.match(sql, /references recovery_commitments\(workspace_id, id\)/i);
    assert.match(sql, /num_nonnulls\(recurring_item_id, recovery_commitment_id\) = 1/i);
    assert.match(sql, /renewal_alert_deliveries_recovery_unique_idx/i);
  }
  const evidenceLinks = schema.slice(schema.indexOf("create table evidence_links"), schema.indexOf("create table connector_evidence"));
  assert.match(evidenceLinks, /recurring_item_id uuid not null/);
  assert.doesNotMatch(evidenceLinks, /recovery_commitment_id/);
});

test("Recovery cutover blocks queued legacy sync jobs and removes their cron", () => {
  for (const sql of [retirementMigration, schema]) {
    assert.match(sql, /create trigger connector_sync_jobs_recovery_cutover_guard/);
    assert.match(sql, /new\.status in \('queued', 'running', 'failed', 'paused'\)/);
    assert.match(sql, /create trigger connector_evidence_running_job_guard/);
    assert.match(sql, /before insert or update on connector_evidence/);
    assert.match(sql, /to_jsonb\(new\) - array\['payload', 'payload_minimized_at'\]::text\[\]/);
    assert.match(sql, /Connector evidence writes are retired at Recovery cutover/);
    assert.match(sql, /create trigger renewal_alert_deliveries_recovery_cutover_guard/);
    assert.match(sql, /new\.recurring_item_id is not null and new\.status in \('scheduled', 'sending', 'failed'\)/);
  }
  assert.match(retirementMigration, /update connector_sync_jobs[\s\S]*status = 'blocked'/);
  assert.match(retirementMigration, /where status in \('queued', 'running', 'failed', 'paused'\)/);
  assert.doesNotMatch(vercel, /\/api\/internal\/sync-jobs\/due\/run/);
  assert.doesNotMatch(vercel, /\/api\/internal\/savings-verification\/due\/run/);
  const recheck = connectorRunner.indexOf("assertConnectorSyncRunRunnable");
  const materialize = connectorRunner.indexOf("materializeConnectorBatch({");
  assert.ok(recheck >= 0 && materialize > recheck, "the runner must recheck the job before legacy materialization");
});

test("Recovery reminders schedule canonical subscriptions and cancel unsent legacy deliveries", () => {
  assert.match(retirementMigration, /update renewal_alert_deliveries[\s\S]*recurring_item_id is not null[\s\S]*status in \('scheduled', 'sending', 'failed'\)/);
  assert.match(alerts, /join recovery_commitments commitment/);
  assert.match(alerts, /recovery_commitment_id/);
  assert.match(alerts, /commitment\.confidence_score >= \$\{renewalAlertMinimumConfidence\}/);
  assert.match(alerts, /decision\.decision is distinct from 'KEEP'/);
  assert.match(alerts, /recovery\.effective_merchant as merchant/);
  assert.match(alerts, /delivery\.recurring_item_id is null/);
  assert.doesNotMatch(alerts, /coalesce\(recovery\.effective_merchant, legacy\.merchant\)/);
  assert.match(alerts, /on conflict \(preference_id, recovery_commitment_id, alert_window, renewal_date\)/);
  assert.equal(
    [...recoveryStore.matchAll(/scheduleRenewalAlertsForWorkspace\(input\.workspaceId, client\)/g)].length,
    4,
    "user evidence, provider evidence, decisions, and corrections must all reconcile reminders",
  );
});
