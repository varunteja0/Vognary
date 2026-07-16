import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

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
  const workflow = parse(read(".github/workflows/ci.yml")) as {
    jobs?: { validate?: { services?: { postgres?: { image?: string } }; env?: { DATABASE_URL?: string }; steps?: Array<{ run?: string }> } };
  };
  const validate = workflow.jobs?.validate;
  assert.equal(validate?.services?.postgres?.image, "postgres:16");
  assert.equal(validate?.env?.DATABASE_URL, "postgresql://postgres:vognary_ci@127.0.0.1:5432/vognary_ci");
  const commands = (validate?.steps ?? []).flatMap((step) => step.run ? [step.run] : []);
  assert.ok(commands.includes("npm run ci:database"));
  assert.ok(
    commands.indexOf("npm run ci:database") < commands.indexOf("npm run lint"),
    "schema migrations must run before application validation",
  );
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
  for (const id of [
    "feature-migrations",
    "privacy-lifecycle",
    "renewal-alerts",
    "platform-api",
    "workspace-decisions-auth-guard",
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
  assert.match(source, /id: "audit-intake-status"/);
  assert.doesNotMatch(source, /name: "Activation Check"/);
  assert.doesNotMatch(source, /id: "monitoring-delivery-test"/);
});

test("operator evidence flags default blank and the runbook forbids secret-only activation claims", () => {
  const env = read(".env.example");
  const runbook = read("docs/production-activation-runbook.md");
  for (const name of ["SYNC_SCHEDULER_STATUS", "RENEWAL_ALERT_DELIVERY_STATUS", "RETENTION_SCHEDULER_STATUS"]) {
    assert.match(env, new RegExp(`^${name}=$`, "m"));
    assert.match(runbook, new RegExp(`${name}=production-live`));
  }
  assert.match(runbook, /CRON_SECRET[\s\S]*does not prove the schedule is deployed or firing/);
  assert.match(runbook, /operator attestation rather than independent scheduler telemetry/);
  assert.match(runbook, /does not label the API as adopted by a partner/);
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
  const activation = read("scripts/check-production-activation.mjs");
  assert.match(activation, /id: "gmail-product-start"[\s\S]*expected: \[200, 401, 501\]/);
  assert.match(activation, /Feature migrations 0002 through 0017/);
});
