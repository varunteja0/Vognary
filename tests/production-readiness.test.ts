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
const nodeImage = "node:22.23.2-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32";
const postgresImage = "postgres:16.14@sha256:95206741a5b214807675e14165369d05b93a9cf692223b616d07cca227e74b0b";
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
  assert.doesNotMatch(source, /select[^;]*(merchant|email|amount|token_hash|scopes)/i);
});

test("CI executes the production schema against PostgreSQL before application checks", () => {
  const workflowSource = read(".github/workflows/ci.yml");
  const workflow = parse(workflowSource) as {
    permissions?: { contents?: string };
    jobs?: { validate?: { services?: { postgres?: { image?: string } }; env?: { DATABASE_URL?: string }; steps?: Array<{ run?: string; uses?: string; with?: { "node-version"?: string; "persist-credentials"?: boolean } }> } };
  };
  assert.equal(workflow.permissions?.contents, "read");
  assert.match(workflowSource, new RegExp(`uses: ${checkoutAction}`));
  assert.match(workflowSource, new RegExp(`uses: ${setupNodeAction}`));
  assert.doesNotMatch(workflowSource, /uses: actions\/(?:checkout|setup-node)@v\d+/);
  const validate = workflow.jobs?.validate;
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
  assert.ok(
    commands.indexOf("npm run ci:database") < commands.indexOf("npm run lint"),
    "schema migrations must run before application validation",
  );
  assert.match(workflowSource, /npm run test:e2e -- control-wiring-inventory/);
});

test("runtime and PostgreSQL tooling are pinned to one reproducible foundation", () => {
  const packageJson = JSON.parse(read("package.json")) as {
    engines?: { node?: string; npm?: string };
    packageManager?: string;
  };
  assert.equal(packageJson.engines?.node, nodeVersion);
  assert.equal(packageJson.engines?.npm, npmVersion);
  assert.equal(packageJson.packageManager, `npm@${npmVersion}`);
  assert.equal(read(".nvmrc").trim(), nodeVersion);
  assert.match(read(".npmrc"), /^engine-strict=true$/m);

  const dockerfile = read("Dockerfile");
  assert.equal(dockerfile.match(new RegExp(`FROM ${nodeImage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"))?.length, 3);
  assert.doesNotMatch(dockerfile, /FROM node:20/);

  const compose = parse(read("docker-compose.yml")) as { services?: { postgres?: { image?: string } } };
  assert.equal(compose.services?.postgres?.image, postgresImage);
  assert.match(read("scripts/lib/postgres-backup-utils.mjs"), new RegExp(postgresImage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const backupWorkflow = read(".github/workflows/ops-backup-drill.yml");
  assert.match(backupWorkflow, new RegExp(`uses: ${checkoutAction}`));
  assert.match(backupWorkflow, new RegExp(`uses: ${setupNodeAction}`));
  assert.match(backupWorkflow, new RegExp(`uses: ${uploadArtifactAction}`));
  assert.match(backupWorkflow, new RegExp(`node-version: ["']?${nodeVersion}["']?`));
  assert.doesNotMatch(backupWorkflow, /uses: actions\/(?:checkout|setup-node|upload-artifact)@v\d+/);
});

test("Vercel production builds apply checksummed migrations before compiling the deployment", () => {
  const config = JSON.parse(read("vercel.json")) as { buildCommand?: string };
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const build = read("scripts/vercel-build.mjs");
  assert.equal(config.buildCommand, "npm run vercel-build");
  assert.equal(packageJson.scripts?.["vercel-build"], "node scripts/vercel-build.mjs");
  assert.match(build, /VERCEL_ENV === "production"/);
  assert.ok(
    build.indexOf("scripts/apply-postgres-schema.mjs") < build.indexOf('["run", "build"]'),
    "production migrations must complete before the Next.js build",
  );
});

test("CI browser journeys exercise the built Next.js production artifact", () => {
  const config = read("playwright.config.ts");
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const server = read("scripts/start-standalone.mjs");
  assert.match(config, /process\.env\.CI[\s\S]*npm run start/);
  assert.match(config, /npm run dev/);
  assert.equal(packageJson.scripts?.start, "node scripts/start-standalone.mjs");
  assert.match(server, /\.next["'], "standalone["'], "server\.js/);
  assert.match(server, /cpSync[\s\S]*\.next["'], "static/);
  assert.match(server, /cpSync[\s\S]*public/);
});

test("standalone PDF ingestion preserves the dynamically loaded pdf.js worker", () => {
  const config = read("next.config.ts");
  assert.match(config, /serverExternalPackages: \["pdf-parse"\]/);
  assert.match(config, /"\/api\/ingest": \["\.\/node_modules\/pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs"\]/);
});

test("internal readiness distinguishes schema, observed evidence, and operator attestation", () => {
  const source = read("src/app/api/readiness/route.ts");
  assert.match(source, /capabilities: features/);
  assert.match(source, /schemaDegraded/);
  assert.match(source, /cron-secret-configured-deployment-schedule-unverified/);
  assert.match(source, /last-run-observed-deployment-schedule-unverified/);
  assert.match(source, /cron-route-ready-needs-secret/);
  assert.match(source, /delivery-observed-deployment-schedule-unverified/);
  assert.match(source, /operator-attested-production-live/);
  assert.match(source, /invalid-attestation-no-enforced-run-observed/);
  assert.match(source, /invalid-attestation-no-delivery-observed/);
  assert.match(source, /invalid-attestation-no-cron-evidence/);
  assert.match(source, /schema-ready-shared-rate-limit-required/);
  assert.match(source, /sharedRateLimiting/);
  assert.match(source, /configured-postgres/);
  assert.match(source, /settlement-observed/);
  assert.match(read("src/lib/server/feature-readiness.ts"), /checkout\.plan = \$1[\s\S]*checkout\.offer_id = \$2[\s\S]*orders\.status in \('pending', 'in_progress', 'delivered'\)/);
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
    "core-connectors",
    "platform-api",
    "workspace-decisions-auth-guard",
    "workspace-proof-graph-auth-guard",
    "workspace-current-auth-guard",
    "workspace-actions-auth-guard",
    "workspace-ask-auth-guard",
    "workspace-commitments-auth-guard",
    "savings-verification-due-run-cron-guard",
    "renewal-alert-preferences-auth-guard",
    "privacy-retention-worker-secret-guard",
    "platform-ledger-token-guard",
    "platform-sources-token-guard",
    "billing-entitlements-auth-guard",
  ]) {
    assert.match(source, new RegExp(`"${id}"`));
  }
  assert.match(source, /SYNC_SCHEDULER_STATUS: "production-live"/);
  assert.match(source, /RETENTION_SCHEDULER_STATUS: "production-live"/);
  assert.match(source, /RENEWAL_ALERT_DELIVERY_STATUS: "production-live"/);
  assert.match(source, /ledger\.status === 401/);
  assert.match(source, /sources\.status === 401/);
  assert.match(source, /target activation evidence/);
  assert.match(source, /capabilities\?\.schema\?\.status === "ready"/);
  assert.match(source, /betaReady: endpointReport\.every\(\(item\) => item\.ok\)/);
  assert.match(source, /envReport\.filter\(\(item\) => item\.launchBlocking\)/);
  assert.match(source, /coreConnectorLaunch/);
  assert.match(source, /launchBlocking: false/);
  assert.match(source, /id: "audit-intake-status"/);
  assert.doesNotMatch(source, /name: "Activation Check"/);
  assert.doesNotMatch(source, /id: "monitoring-delivery-test"/);
});

test("operator evidence flags default blank and the runbook forbids secret-only activation claims", () => {
  const env = read(".env.example");
  const runbook = read("docs/production-activation-runbook.md");
  const preflight = read("scripts/check-ops-preflight.mjs");
  for (const name of ["SYNC_SCHEDULER_STATUS", "RENEWAL_ALERT_DELIVERY_STATUS", "RETENTION_SCHEDULER_STATUS"]) {
    assert.match(env, new RegExp(`^${name}=$`, "m"));
    assert.match(runbook, new RegExp(`${name}=production-live`));
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
  assert.match(source, /\[401, 404, 501\]\.includes\(loginWithoutSetup\.status\)/);
  assert.match(source, /"usage-only"/);
  assert.match(source, /"source-health-only"/);
  assert.match(source, /\[200, 401, 501\]\.includes\(gmailProductStartResponse\.status\)/);
  assert.match(source, /fetch\(`\$\{baseUrl\}\/api\/audit-intake`\)/);
  assert.match(source, /\['ready', 'not-configured'\]\.includes\(auditIntake\.status\)/);
  assert.doesNotMatch(source, /fetch\(`\$\{baseUrl\}\/api\/audit-intake`,\s*\{[\s\S]*?method:\s*"POST"/);
  assert.match(source, /connectors\.adapters\?\.includes\("anthropic-usage"\)/);
  assert.match(source, /connector\.status === "planned"/);
  assert.doesNotMatch(source, /\/api\/connectors\/anthropic-usage\/(?:start|sync)["`]/);
  const activation = read("scripts/check-production-activation.mjs");
  assert.match(activation, /id: "gmail-product-start"[\s\S]*expected: \[200, 401, 501\]/);
  assert.match(activation, /Feature migrations 0002 through 0022/);
});
