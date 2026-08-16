import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

test("retention dry runs select preview SQL inside repeatable-read read-only transactions", () => {
  const source = read("src/lib/server/retention-executor.ts");
  assert.match(source, /begin isolation level repeatable read read only/);
  assert.match(source, /options\.dryRun \? query\.previewSql : query\.executeSql/);
  assert.match(source, /input\.options\.dryRun \? query\.preview : query\.execute/);
  assert.match(source, /pg_try_advisory_xact_lock/);
  assert.match(source, /for update skip locked/g);
  assert.match(source, /nextWorkspaceCursor/);
  assert.match(source, /afterWorkspaceId/);
});

test("retention predicates preserve manual rows and dead-letter stale verified webhooks", () => {
  const source = read("src/lib/server/retention-executor.ts");
  assert.match(source, /external_reference like 'connector:%'/);
  assert.match(source, /status in \('verified', 'processed', 'failed', 'ignored'\)/);
  assert.match(source, /when item\.status = 'verified' then 'ignored'/);
  assert.match(source, /webhookErrorsMinimized/);
  assert.match(source, /workspace_id is null and payload_minimized_at is null/);
  assert.match(source, /where workspace_id is null and occurred_at < \$1/);
  assert.match(source, /recoveryRawEvidenceMinimized/);
  assert.match(source, /update recovery_sources item\s+set raw_evidence = '\{\}'::jsonb, raw_minimized_at = now\(\)/);
  assert.match(source, /recoveryInboundEventsDeleted/);
  assert.match(source, /delete from recovery_inbound_events item using candidates/);
  assert.match(source, /status in \('PROCESSED', 'IGNORED', 'TERMINAL_FAILED'\)/);
  assert.match(source, /event_name = 'workspace.activated' and activation_semantic_version is not distinct from 1/);
  assert.doesNotMatch(source, /status in \([^)]*'RECEIVED'[^)]*\)[\s\S]{0,200}delete from recovery_inbound_events/);
});

test("connector upserts cannot repopulate payloads after minimization", () => {
  for (const file of [
    "src/lib/server/living-ledger-store.ts",
    "src/lib/server/sync-job-store.ts",
    "src/lib/server/webhook-store.ts",
  ]) {
    const source = read(file);
    assert.match(source, /payload_minimized_at is null|raw_row_minimized_at is null/, `${file} must honor a minimization marker`);
  }
});

test("privacy export SQL excludes raw rows, secret material, and arbitrary connector metadata", () => {
  const source = read("src/lib/server/privacy-lifecycle-store.ts");
  const exportSection = source.slice(source.indexOf("async function buildAccessExport"), source.indexOf("async function readRetentionPolicy"));
  assert.ok(exportSection.length > 0);
  for (const forbiddenColumn of [
    "encrypted_payload",
    "secret_ref",
    "raw_row",
    "merchant_raw",
    "external_id",
    "ca.metadata",
  ]) {
    assert.doesNotMatch(exportSection, new RegExp(forbiddenColumn), `${forbiddenColumn} must not enter the export query`);
  }
  assert.match(exportSection, /where \(user_id = \$1 or lower\(subject_email\) = lower\(\$2\)\)/);
  const consentSection = exportSection.slice(
    exportSection.indexOf("from consent_grants"),
    exportSection.indexOf("client.query<ConnectedSourceExportRow>"),
  );
  assert.match(consentSection, /workspace_id = \$3 or workspace_id is null/);
  assert.match(exportSection, /workspaceId: row\.workspace_id/);
  assert.match(exportSection, /from recovery_workspace_versions/);
  assert.match(exportSection, /from recovery_submissions/);
  assert.match(exportSection, /from recovery_sources/);
  assert.match(exportSection, /from recovery_commitments/);
  assert.match(exportSection, /from recovery_evidence/);
  assert.match(exportSection, /from recovery_corrections/);
  assert.match(exportSection, /from recovery_decisions/);
  assert.match(exportSection, /from recovery_changes/);
  assert.doesNotMatch(exportSection, /select[^;]*raw_evidence/);
  assert.doesNotMatch(exportSection, /from recovery_idempotency_keys/);
  assert.match(exportSection, /as "noticeFingerprint"/);
  assert.doesNotMatch(exportSection, /as "payloadHash"/);
  assert.match(exportSection, /as provider_controls/);
  assert.match(exportSection, /connected_mandate_cohort/);
  assert.match(exportSection, /source_disconnections/);
  assert.doesNotMatch(exportSection, /signed_text[^\n_]/);
  assert.doesNotMatch(exportSection, /notice_text|notice_from_email|notice_to_email|notice_subject|notice_tags/);
});

test("privacy migration carries bounded policy, coherent request, and allowlisted run constraints", () => {
  const migration = read("infra/postgres/migrations/0004_privacy_lifecycle.sql");
  assert.match(migration, /raw_connector_payload_days between 7 and 90/);
  assert.match(migration, /product_event_days between 30 and 365/);
  assert.match(migration, /status = 'completed' and completed_at is not null and download_count > 0/);
  assert.match(migration, /data_subject_requests_ready_idx/);
  assert.match(migration, /policy_snapshot - array/);
  assert.match(migration, /counts - array/);
  assert.match(migration, /webhookErrorsMinimized/);
  assert.match(migration, /connector_evidence_retention_idx/);

  const recoveryMigration = read("infra/postgres/migrations/0023_recovery_v1.sql");
  assert.match(recoveryMigration, /recoveryRawEvidenceMinimized/);
  assert.match(recoveryMigration, /recovery_sources_retention_idx/);

  const expansionMigration = read("infra/postgres/migrations/0025_recovery_renewal_alerts.sql");
  assert.match(expansionMigration, /recoveryInboundEventsDeleted/);
  assert.match(expansionMigration, /retention_runs_counts_keys_check/);
  assert.doesNotMatch(read("infra/postgres/migrations/0026_recovery_inbound_retention.sql"), /retention_runs_counts_keys_check/);
  const schema = read("infra/postgres/schema.sql");
  assert.match(schema, /recoveryInboundEventsDeleted/);
});

test("retention cron executes a fixed bounded enforcement batch", () => {
  const route = read("src/app/api/internal/privacy/retention/run/route.ts");
  assert.match(route, /export async function GET\(request: Request\)/);
  assert.match(route, /dryRun: false/);
  assert.match(route, /workspaceLimit: 10/);
  assert.match(route, /batchSize: 500/);
  assert.match(route, /requireRetentionExecutorSecret\(request\)/);
  const post = route.slice(route.indexOf("export async function POST"), route.indexOf("async function runRetention"));
  assert.ok(post.indexOf("requireRetentionExecutorSecret(request)") < post.indexOf("readExecutionJson(request)"));
});
