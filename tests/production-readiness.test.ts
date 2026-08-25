import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const nodeVersion = "22.23.2";
const npmVersion = "10.9.8";
const nodeEngine = ">=22.22.2 <23";
const npmEngine = ">=10.9.7 <11";
const nodeImage = "node:22.23.2-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32";
const postgresImage = "postgres:16.14@sha256:95206741a5b214807675e14165369d05b93a9cf692223b616d07cca227e74b0b";
const postgresClientImage = "postgres:18.4@sha256:a02db8cac496f15b094798a38254f14d6e00741f709360e5e00bb6668ea31636";
const checkoutAction = "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803";
const setupNodeAction = "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38";
const uploadArtifactAction = "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02";

test("feature readiness checks every persistent capability migration with bounded aggregate evidence", () => {
  const source = read("src/lib/server/feature-readiness.ts");
  for (const migration of [
    "0002_revocable_sessions",
    "0003_living_ledger",
    "0004_privacy_lifecycle",
    "0005_product_experience_events",
    "0006_renewal_alerts",
    "0007_commitment_decisions",
    "0008_platform_api",
    "0009_consent_scope",
    "0010_connector_consent",
    "0011_workspace_state",
    "0012_workspace_state_materialization",
    "0013_billing_entitlements",
    "0014_sync_run_invocation",
    "0015_paid_audit_flow",
    "0016_assisted_audit_orders",
    "0017_shared_rate_limits",
    "0018_living_proof_graph",
    "0019_verified_outcome_loop",
    "0020_authorization_evidence",
    "0021_pending_connector_consent",
    "0022_weekly_digest",
    "0023_recovery_v1",
    "0024_recovery_inbound_receipts",
    "0025_recovery_renewal_alerts",
    "0026_recovery_inbound_retention",
    "0027_gmail_forwarding_verification",
    "0028_recovery_gmail_oauth_source",
    "0029_legacy_tenant_integrity",
    "0030_legacy_tenant_ownership_immutable",
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
    "0057_commitment_control_v0",
  ]) {
    assert.match(source, new RegExp(`"${migration}"`));
  }
  assert.match(source, /where id = any\(\$1::text\[\]\)/);
  assert.match(source, /capability-query-failed/);
  assert.match(source, /max\(finished_at\)[\s\S]*not dry_run/);
  assert.doesNotMatch(source, /lastDryRunAt|last_dry_run_at/);
  assert.match(source, /max\(sent_at\)/);
  assert.match(source, /count\(\*\)::int as saved_decisions/);
  assert.match(source, /max\(last_used_at\)/);
  assert.match(source, /metadata ->> 'ledgerAuthority'[\s\S]*<> 'RECOVERY_V1'/);
  assert.doesNotMatch(source, /select[^;]*(merchant|email|amount|token_hash|scopes)/i);
});

test("CI executes the production schema against PostgreSQL before application checks", () => {
  const workflowSource = read(".github/workflows/ci.yml");
  const workflow = parse(workflowSource) as {
    permissions?: { contents?: string };
    jobs?: { validate?: { "timeout-minutes"?: number; services?: { postgres?: { image?: string } }; env?: { DATABASE_URL?: string }; steps?: Array<{ "timeout-minutes"?: number; run?: string; uses?: string; with?: { "node-version"?: string; "persist-credentials"?: boolean } }> } };
  };
  assert.equal(workflow.permissions?.contents, "read");
  assert.match(workflowSource, new RegExp(`uses: ${checkoutAction}`));
  assert.match(workflowSource, new RegExp(`uses: ${setupNodeAction}`));
  assert.doesNotMatch(workflowSource, /uses: actions\/(?:checkout|setup-node)@v\d+/);
  const validate = workflow.jobs?.validate;
  assert.equal(validate?.["timeout-minutes"], 60);
  assert.equal(validate?.services?.postgres?.image, postgresImage);
  assert.equal(validate?.env?.DATABASE_URL, "postgresql://postgres:vognary_ci@127.0.0.1:5432/vognary_ci");
  const checkout = (validate?.steps ?? []).find((step) => step.uses === checkoutAction);
  const setupNode = (validate?.steps ?? []).find((step) => step.uses === setupNodeAction);
  assert.equal(checkout?.with?.["persist-credentials"], false);
  assert.equal(setupNode?.with?.["node-version"], nodeVersion);
  const commands = (validate?.steps ?? []).flatMap((step) => step.run ? [step.run] : []);
  assert.ok(commands.some((command) => command.includes(`node --version`) && command.includes(nodeVersion)));
  assert.ok(commands.includes("npm run tokens:check"));
  assert.ok(commands.includes("npm audit --omit=dev --audit-level=high"));
  assert.ok(commands.includes("npm audit --audit-level=high"));
  assert.ok(commands.includes("npm run ci:database"));
  const playwrightInstall = (validate?.steps ?? []).find((step) => step.run === "npx playwright install chromium");
  assert.equal(playwrightInstall?.["timeout-minutes"], 10);
  assert.doesNotMatch(workflowSource, /playwright install --with-deps/);
  assert.ok(
    commands.indexOf("npm run ci:database") < commands.indexOf("npm run lint"),
    "schema migrations must run before application validation",
  );
  assert.match(workflowSource, /COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS:\s*"\*"/);
  assert.match(workflowSource, /npm run test:e2e -- commitment-control-ui recovery-customer-zero recovery-ui-home recovery-ui-states/);
  assert.doesNotMatch(workflowSource, /signed-in-first-value|verified-savings-share|workspace-source-health|control-wiring-inventory|sample-workspace/);
});

test("production migration workflow requires a pre-0053 backup restore and exact live head", () => {
  const workflow = read(".github/workflows/production-database-activation.yml");
  assert.match(workflow, /apply-latest/);
  assert.match(workflow, /APPLY_LATEST_PRODUCTION/);
  assert.match(workflow, /backup_run_id/);
  assert.match(workflow, /encrypted-postgres-backup-pre-0053/);
  assert.match(workflow, /run\.conclusion !== "success"/);
  assert.match(workflow, /ageMs > 24 \* 60 \* 60 \* 1000/);
  assert.match(workflow, /state\.migration_head !== '0026_recovery_inbound_retention'/);
  assert.match(workflow, /verification\.migration_head !== '0057_commitment_control_v0'/);
  assert.match(workflow, /recovery_inbound_alias_milestones_immutable/);
  assert.doesNotMatch(workflow, /NEON_RESTORE_BRANCH_ID|backup\/pre-0053-/);
  assert.doesNotMatch(workflow, /apply-0026|APPLY_0026_PRODUCTION/);
});

test("Commitment Control has a bounded production 0056 to 0057 operator", () => {
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const workflow = read(".github/workflows/production-database-activation.yml");
  const operator = read("scripts/apply-production-0057.mjs");

  assert.equal(packageJson.scripts?.["db:apply-production-0057"], "node scripts/apply-production-0057.mjs");
  assert.match(workflow, /apply-control-0057/);
  assert.match(workflow, /APPLY_CONTROL_0057_PRODUCTION/);
  assert.match(workflow, /encrypted-postgres-backup-current/);
  assert.match(workflow, /run\.head_sha !== currentSha/);
  assert.match(workflow, /npm run db:apply-production-0057 -- --confirm-0056-to-0057-production/);
  assert.match(operator, /0056_decision_cycle_expected_amount/);
  assert.match(operator, /0057_commitment_control_v0/);
  assert.match(operator, /eb1145d8248f5044c38472870525209560122fad5b4aa3175fb26f6edc9afc4f/);
  assert.match(operator, /pg_try_advisory_lock/);
  assert.match(operator, /commitment_control_reconciliations_immutable/);
});

test("runtime and PostgreSQL tooling are pinned to one reproducible foundation", () => {
  const packageJson = JSON.parse(read("package.json")) as {
    engines?: { node?: string; npm?: string };
    packageManager?: string;
  };
  assert.equal(packageJson.engines?.node, nodeEngine);
  assert.equal(packageJson.engines?.npm, npmEngine);
  assert.equal(packageJson.packageManager, `npm@${npmVersion}`);
  assert.equal(read(".nvmrc").trim(), nodeVersion);
  assert.match(read(".npmrc"), /^engine-strict=true$/m);

  const dockerfile = read("Dockerfile");
  assert.equal(dockerfile.match(new RegExp(`FROM ${nodeImage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"))?.length, 3);
  assert.doesNotMatch(dockerfile, /FROM node:20/);

  const compose = parse(read("docker-compose.yml")) as { services?: { postgres?: { image?: string } } };
  assert.equal(compose.services?.postgres?.image, postgresImage);
  assert.match(read("scripts/lib/postgres-backup-utils.mjs"), new RegExp(postgresClientImage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(read("scripts/lib/postgres-backup-utils.mjs"), new RegExp(postgresImage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const backupWorkflow = read(".github/workflows/ops-backup-drill.yml");
  assert.match(backupWorkflow, new RegExp(`uses: ${checkoutAction}`));
  assert.match(backupWorkflow, new RegExp(`uses: ${setupNodeAction}`));
  assert.match(backupWorkflow, new RegExp(`uses: ${uploadArtifactAction}`));
  assert.match(backupWorkflow, new RegExp(`node-version: ["']?${nodeVersion}["']?`));
  assert.doesNotMatch(backupWorkflow, /apt-get install -y postgresql-client/);
  assert.equal((backupWorkflow.match(/POSTGRES_CLIENT_MODE: docker/g) ?? []).length, 2);
  assert.match(backupWorkflow, /NEON_API_KEY/);
  assert.match(backupWorkflow, /NEON_PROJECT_ID/);
  assert.match(backupWorkflow, /verification_profile/);
  assert.match(backupWorkflow, /pre-0053/);
  assert.match(backupWorkflow, /BACKUP_VERIFICATION_PROFILE/);
  assert.match(backupWorkflow, /postgres:18\.4@sha256:/);
  assert.match(backupWorkflow, /vognary_restore_drill@127\.0\.0\.1:5432\/vognary_restore/);
  assert.match(backupWorkflow, /RESTORE_POSTGRES_SSL: "false"/);
  assert.match(backupWorkflow, /retention-days: 90/);
  assert.doesNotMatch(backupWorkflow, /secrets\.DATABASE_URL|secrets\.RESTORE_DATABASE_URL/);
  assert.doesNotMatch(backupWorkflow, /uses: actions\/(?:checkout|setup-node|upload-artifact)@v\d+/);

  const backupUtils = read("scripts/lib/postgres-backup-utils.mjs");
  assert.match(backupUtils, /POSTGRES_CLIENT_MODE === "docker"/);
  assert.match(backupUtils, /if \(!forceDocker && commandExists\(command\)\)/);
  assert.match(backupUtils, /export function postgresConnectionEnv/);
  assert.match(backupUtils, /export function postgresDockerEnvironment/);
  assert.match(backupUtils, /host\.docker\.internal:host-gateway/);
  assert.match(read("scripts/backup-postgres.mjs"), /postgresConnectionEnv\(databaseUrl\)/);
  assert.match(read("scripts/restore-postgres-drill.mjs"), /postgresConnectionEnv\(restoreDatabaseUrl\)/);
  assert.match(read("scripts/restore-postgres-drill.mjs"), /"--dbname",[\s\S]*restoreConnectionEnv\.PGDATABASE/);
});

test("restore drills require Recovery v1 and report restored Recovery state", () => {
  const backup = read("scripts/backup-postgres.mjs");
  const restore = read("scripts/restore-postgres-drill.mjs");
  const recoveryVerification = read("scripts/lib/recovery-backup-verification.mjs");
  for (const relation of [
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
    "recovery_inbound_replay_keys",
    "recovery_standing_mandates",
    "recovery_autopilot_dead_letters",
    "recovery_source_disconnections",
  ]) {
    assert.match(recoveryVerification, new RegExp(`"${relation}"`));
  }
  assert.match(recoveryVerification, /inbound_aliases/);
  assert.match(recoveryVerification, /inbound_events/);
  assert.match(recoveryVerification, /inbound_replay_keys/);
  assert.match(backup, /readRecoveryBackupVerification/);
  assert.match(recoveryVerification, /requiredRecoveryMigration = "0023_recovery_v1"/);
  assert.match(recoveryVerification, /0045_autopilot_mandate_execution_immutability/);
  assert.match(recoveryVerification, /0046_billed_window_immutability/);
  assert.match(recoveryVerification, /0047_billed_window_insert_immutability/);
  assert.match(recoveryVerification, /recovery_covered_windows_billed_immutable/);
  assert.match(recoveryVerification, /from pg_trigger/);
  assert.match(recoveryVerification, /from schema_migrations/);
  assert.match(recoveryVerification, /recoveryWorkspaceCounts/);
  assert.match(restore, /manifest\.verification\?\.recoveryWorkspaceCounts/);
  assert.match(restore, /Recovery restore counts do not match the backup manifest/);
  assert.match(recoveryVerification, /commitment_evidence/);
  assert.match(recoveryVerification, /idempotency_keys/);
});

test("Vercel builds never race Recovery cutover migrations ahead of worker retirement", () => {
  const config = JSON.parse(read("vercel.json")) as { buildCommand?: string };
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const build = read("scripts/vercel-build.mjs");
  const runbook = read("docs/production-activation-runbook.md");
  assert.equal(config.buildCommand, "npm run vercel-build");
  assert.equal(packageJson.scripts?.["vercel-build"], "node scripts/vercel-build.mjs");
  assert.doesNotMatch(build, /apply-postgres-schema|db:apply-schema/);
  assert.match(build, /\["run", "build"\]/);
  assert.match(runbook, /ends exactly at `0026_recovery_inbound_retention`/);
  assert.match(runbook, /encrypted-postgres-backup-pre-0053/);
  assert.match(runbook, /Deploy the exact candidate SHA/);
  assert.match(runbook, /Wait at least five minutes after the last old sync, reminder, or savings-verification invocation finishes/);
  assert.match(runbook, /DATABASE_URL='<production-postgres-url>' POSTGRES_SSL=true npm run db:apply-schema/);
  assert.match(runbook, /last row is `0057_commitment_control_v0`/);
});

test("CI browser journeys exercise the built Next.js production artifact", () => {
  const config = read("playwright.config.ts");
  const nextConfig = read("next.config.ts");
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const server = read("scripts/start-standalone.mjs");
  assert.match(nextConfig, /output: process\.env\.VERCEL \? undefined : "standalone"/);
  assert.match(config, /process\.env\.CI[\s\S]*npm run start/);
  assert.match(config, /npm run dev/);
  assert.equal(packageJson.scripts?.start, "node scripts/start-standalone.mjs");
  assert.match(server, /\.next["'], "standalone["'], "server\.js/);
  assert.match(server, /cpSync[\s\S]*\.next["'], "static/);
  assert.match(server, /cpSync[\s\S]*public/);
});

test("Lighthouse measures the signed-out app without hydration delay and respects noindex utilities", () => {
  const lighthouse = read("scripts/check-lighthouse.mjs");
  const loginPage = read("src/app/login/page.tsx");
  const loginClient = read("src/app/login/login-client.tsx");
  assert.match(lighthouse, /path: "\/login\?next=\/app", categories: \["performance", "accessibility", "best-practices"\]/);
  assert.doesNotMatch(lighthouse, /path: "\/app", categories:/);
  assert.match(lighthouse, /path: "\/verify", categories: \["performance", "accessibility", "best-practices"\]/);
  assert.match(loginPage, /initialSession=/);
  assert.match(loginPage, /readCurrentSession/);
  assert.match(loginClient, /initialSession: SessionPayload/);
  assert.match(loginClient, /useState<SessionPayload>\(initialSession\)/);
});

test("standalone PDF ingestion preserves the dynamically loaded pdf.js worker", () => {
  const config = read("next.config.ts");
  assert.match(config, /agentRules: false/);
  assert.match(config, /serverExternalPackages: \["pdf-parse", "@napi-rs\/canvas", "tesseract.js", "sharp"\]/);
  assert.match(config, /"\/api\/ingest": \["\.\/node_modules\/pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs"\]/);
});

test("internal readiness distinguishes schema, observed evidence, and operator attestation", () => {
  const source = read("src/app/api/readiness/route.ts");
  assert.match(source, /capabilities: \{[\s\S]*schema: features\.schema/);
  assert.match(source, /recoveryV1/);
  assert.doesNotMatch(source, /getConnectorSummary|listConnectorAdapters|partnerRails|syncWorkers|internalSyncJobApi|webhookIngestion/);
  assert.match(source, /schemaDegraded/);
  assert.match(source, /cron-secret-configured-deployment-schedule-unverified/);
  assert.match(source, /last-run-observed-deployment-schedule-unverified/);
  assert.match(source, /cron-route-ready-needs-secret/);
  assert.match(source, /delivery-observed-deployment-schedule-unverified/);
  assert.match(source, /operator-attested-production-live/);
  assert.match(source, /invalid-attestation-no-enforced-run-observed/);
  assert.match(source, /invalid-attestation-no-delivery-observed/);
  assert.match(source, /schema-ready-shared-rate-limit-required/);
  assert.match(source, /sharedRateLimiting/);
  assert.match(source, /configured-postgres/);
  assert.match(source, /payments: "retired-public-checkout"/);
  assert.match(source, /leadPersistence: "retired-public-intake"/);
  assert.match(read("src/lib/server/feature-readiness.ts"), /checkout\.plan = \$1[\s\S]*checkout\.offer_id = \$2[\s\S]*orders\.status in \('pending', 'in_progress', 'delivered'\)/);
});

test("the public landing stays static while the signed product checks receipt availability", () => {
  const source = read("src/app/page.tsx");
  assert.match(source, /export const revalidate = 3600/);
  assert.doesNotMatch(source, /force-dynamic|isReceiptInboxPubliclyAvailable/);
  assert.match(read("src/app/app/page.tsx"), /isReceiptInboxPubliclyAvailable/);
});

test("activation probes are bounded and cover private lifecycle, renewal, decisions, and platform guards", () => {
  const source = read("scripts/check-production-activation.mjs");
  assert.match(source, /AbortSignal\.timeout\(8_000\)/);
  assert.match(source, /PRODUCTION_INTERNAL_SYNC_SECRET/);
  assert.match(source, /Set PRODUCTION_INTERNAL_SYNC_SECRET to the deployed INTERNAL_SYNC_SECRET/);
  for (const id of [
    "feature-migrations",
    "privacy-lifecycle",
    "renewal-alerts",
    "receipt-inbox",
    "platform-api",
    "workspace-decisions-auth-guard",
    "workspace-proof-graph-auth-guard",
    "workspace-current-auth-guard",
    "workspace-actions-retired",
    "workspace-ask-auth-guard",
    "workspace-commitments-auth-guard",
    "workspace-sources-auth-guard",
    "sync-due-run-retired",
    "savings-verification-retired",
    "renewal-alert-preferences-auth-guard",
    "privacy-retention-worker-secret-guard",
    "platform-ledger-token-guard",
    "platform-sources-token-guard",
    "billing-entitlements-auth-guard",
  ]) {
    assert.match(source, new RegExp(`"${id}"`));
  }
  assert.match(source, /RETENTION_SCHEDULER_STATUS: "production-live"/);
  assert.match(source, /RENEWAL_ALERT_DELIVERY_STATUS: "production-live"/);
  assert.match(source, /RECEIPT_INBOX_PROVIDER_STATUS: "production-live"/);
  assert.match(source, /RECEIPT_INBOX_WEBHOOK_PROOF_STATUS: "passed"/);
  assert.match(source, /RECEIPT_INBOX_REPLAY_PROOF_STATUS: "passed"/);
  assert.match(source, /RECEIPT_INBOX_RETENTION_REVIEW_STATUS: "approved"/);
  assert.match(source, /ledger\.status === 401/);
  assert.match(source, /sources\.status === 401/);
  assert.match(source, /target activation evidence/);
  assert.match(source, /capabilities\?\.schema\?\.status === "ready"/);
  assert.match(source, /capabilities\.recoveryV1\?\.status === "schema-ready-clean-cutover"/);
  assert.match(source, /Feature migrations through current Recovery head/);
  assert.doesNotMatch(source, /Feature migrations 0002 through 0054/);
  assert.match(source, /required\?\.includes\("0055_recovery_decision_cycles"\)/);
  assert.match(source, /applied\?\.includes\("0055_recovery_decision_cycles"\)/);
  assert.match(source, /required\?\.includes\("0056_decision_cycle_expected_amount"\)/);
  assert.match(source, /applied\?\.includes\("0056_decision_cycle_expected_amount"\)/);
  assert.match(source, /required\?\.includes\("0057_commitment_control_v0"\)/);
  assert.match(source, /applied\?\.includes\("0057_commitment_control_v0"\)/);
  assert.match(source, /betaReady: endpointReport\.every\(\(item\) => item\.ok\)/);
  assert.match(source, /envReport\.filter\(\(item\) => item\.launchBlocking\)/);
  assert.match(source, /activationProfile = "receipt-forwarding"/);
  for (const optionalId of ["renewal-alerts", "encrypted-snapshots", "platform-api"]) {
    assert.match(source, new RegExp(`id: "${optionalId}"[\\s\\S]*?launchBlocking: false`));
  }
  assert.match(source, /hardening\?\.receiptInbox/);
  assert.match(source, /return status === "google-ready"/);
  assert.doesNotMatch(source, /status === "magic-link-ready" \|\| status === "google-ready"/);
  assert.match(source, /id: "audit-intake-retired"[\s\S]*?expected: \[410\]/);
  assert.match(source, /id: "checkout-assisted-audit-retired"[\s\S]*?expected: \[410\]/);
  assert.doesNotMatch(source, /name: "Activation Check"/);
  assert.doesNotMatch(source, /id: "monitoring-delivery-test"/);
});

test("operator evidence flags default blank and the runbook forbids secret-only activation claims", () => {
  const env = read(".env.example");
  const runbook = read("docs/production-activation-runbook.md");
  const preflight = read("scripts/check-ops-preflight.mjs");
  const operatorEvidence = {
    RENEWAL_ALERT_DELIVERY_STATUS: "production-live",
    RETENTION_SCHEDULER_STATUS: "production-live",
    RECEIPT_INBOX_PROVIDER_STATUS: "production-live",
    RECEIPT_INBOX_WEBHOOK_PROOF_STATUS: "passed",
    RECEIPT_INBOX_REPLAY_PROOF_STATUS: "passed",
    RECEIPT_INBOX_RETENTION_REVIEW_STATUS: "approved",
  };
  for (const [name, expected] of Object.entries(operatorEvidence)) {
    assert.match(env, new RegExp(`^${name}=$`, "m"));
    assert.match(runbook, new RegExp(`${name}=${expected}`));
  }
  assert.match(runbook, /CRON_SECRET[\s\S]*does not prove the schedule is deployed or firing/);
  assert.match(runbook, /operator attestation rather than independent scheduler telemetry/);
  assert.match(runbook, /does not label the API as adopted by a partner/);
  assert.match(env, /^PRODUCTION_INTERNAL_SYNC_SECRET=$/m);
  assert.match(runbook, /401.*configuration drift between the operator copy and the deployed secret/);
  assert.match(preflight, /PRODUCTION_INTERNAL_SYNC_SECRET/);
  assert.match(preflight, /readinessAuthentication/);
});

test("public health remains a minimal liveness surface", () => {
  const source = read("src/app/api/health/route.ts");
  assert.doesNotMatch(source, /DATABASE_URL|schema_migrations|capabilities|partnerRails|RESEND/);
  assert.match(source, /status: "ok"/);
});

test("production smoke accepts disabled code login and materialization-aware connector states", () => {
  const source = read("scripts/smoke-test.mjs");
  const ci = read(".github/workflows/ci.yml");
  assert.match(source, /SMOKE_ALLOW_UNCONFIGURED/);
  assert.match(source, /allowUnconfigured && !targetIsLocal/);
  assert.match(source, /Production smoke requires a ready database/);
  assert.match(source, /Production smoke requires all feature migrations/);
  assert.match(source, /Production smoke requires operator-attested receipt forwarding/);
  assert.match(source, /allowUnconfigured \? \[401, 404, 501, 503\] : \[401, 404, 501\]/);
  assert.match(source, /payload\.status !== "retired"/);
  assert.match(source, /payload\.ledgerAuthority !== "RECOVERY_V1"/);
  assert.match(source, /fetch\(`\$\{baseUrl\}\/api\/audit-intake`\)/);
  assert.match(source, /auditIntakeResponse\.status !== 410/);
  assert.match(source, /auditIntake\.status !== "retired"/);
  assert.doesNotMatch(source, /fetch\(`\$\{baseUrl\}\/api\/audit-intake`,\s*\{[\s\S]*?method:\s*"POST"/);
  assert.match(source, /Recovery Sources without session/);
  assert.match(ci, /SMOKE_BASE_URL: http:\/\/127\.0\.0\.1:3000[\s\S]*SMOKE_ALLOW_UNCONFIGURED: "true"/);
  const serverSecret = ci.match(/INTERNAL_SYNC_SECRET=([^\s\\]+)/)?.[1];
  const smokeSecret = ci.match(/SMOKE_INTERNAL_SECRET:\s*([^\s]+)/)?.[1];
  assert.ok(serverSecret, "CI production server must configure an internal secret");
  assert.equal(smokeSecret, serverSecret, "the smoke client must use the production server's internal secret");
  assert.ok(Buffer.byteLength(serverSecret, "utf8") >= 32, "CI internal secret must satisfy the production guard");
  assert.ok(source.includes(`|| "${serverSecret}"`), "the local smoke fallback must satisfy the same guard");
  const activation = read("scripts/check-production-activation.mjs");
  assert.match(activation, /id: "gmail-product-start"[\s\S]*expected: \[410\]/);
  assert.match(activation, /Feature migrations through current Recovery head/);
});
