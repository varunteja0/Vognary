import { existsSync, readFileSync } from "node:fs";

const envFiles = [".env.local", ".env"];
for (const file of envFiles) loadEnvFile(file);

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const beta = args.includes("--beta");
const urlArg = args.find((arg) => arg.startsWith("http://") || arg.startsWith("https://"));
const baseUrl = (urlArg || process.env.NEXT_PUBLIC_APP_URL || "https://www.vognary.com").replace(/\/$/, "");

const activationProfile = "receipt-forwarding";
const betaRequiredGroupIds = new Set(["persistent-backend", "feature-migrations", "receipt-inbox", "privacy-lifecycle", "redis-rate-limit"]);
const betaSignInGroupIds = new Set(["identity-provider"]);
const targetUrl = new URL(baseUrl);
const targetIsLocal = targetUrl.hostname === "localhost" || targetUrl.hostname === "127.0.0.1" || targetUrl.hostname === "::1";
const targetInternalSecret = process.env.PRODUCTION_INTERNAL_SYNC_SECRET?.trim()
  || process.env.INTERNAL_SYNC_SECRET?.trim()
  || "";

const groups = [
  {
    id: "lead-persistence",
    label: "Lead persistence",
    requiredAny: ["DATABASE_URL", "AUDIT_INTAKE_WEBHOOK_URL", "WAITLIST_WEBHOOK_URL"],
    probe: isLeadPersistenceReady,
    launchBlocking: false,
    why: "Persists private audit and waitlist leads in Postgres or a webhook instead of preview-only responses.",
  },
  {
    id: "payments",
    label: "Tracked Razorpay billing",
    required: [
      "DATABASE_URL",
      "NEXT_PUBLIC_APP_URL",
      "RAZORPAY_KEY_ID",
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
      "ASSISTED_AUDIT_LEGAL_TERMS_STATUS",
    ],
    requiredValues: {
      RAZORPAY_ACCOUNT_STATUS: "live-kyc-approved",
      RAZORPAY_WEBHOOK_PROOF_STATUS: "passed",
      RAZORPAY_REPLAY_PROOF_STATUS: "passed",
      RAZORPAY_REFUND_PROOF_STATUS: "passed",
      RAZORPAY_RECONCILIATION_STATUS: "passed",
    },
    probe: isPaymentReady,
    launchBlocking: false,
    why: "Requires the versioned one-time assisted-audit offer, legal terms approval, tracked checkout creation, signed settlement webhooks, and an observed assisted-audit order. Static payment links stay hidden.",
  },
  {
    id: "receipt-inbox",
    label: "Recovery receipt inbox",
    required: [
      "DATABASE_URL",
      "TOKEN_ENCRYPTION_KEY",
      "ENABLE_RECEIPT_INBOX",
      "RESEND_RECEIVING_API_KEY",
      "RESEND_INBOUND_WEBHOOK_SECRET",
      "RESEND_RECEIVING_DOMAIN",
      "RECEIPT_INBOX_ALIAS_HMAC_SECRET",
      "RECEIPT_INBOX_ALIAS_HMAC_KEY_ID",
    ],
    requiredValues: {
      ENABLE_RECEIPT_INBOX: "true",
      RECEIPT_INBOX_PROVIDER_STATUS: "production-live",
      RECEIPT_INBOX_WEBHOOK_PROOF_STATUS: "passed",
      RECEIPT_INBOX_REPLAY_PROOF_STATUS: "passed",
      RECEIPT_INBOX_RETENTION_REVIEW_STATUS: "approved",
    },
    probe: isReceiptInboxReady,
    why: "Requires the receiving provider, signed webhook, replay/idempotency proof, retention review, and Recovery migrations before forwarding is advertised.",
  },
  {
    id: "persistent-backend",
    label: "Persistent backend",
    required: ["DATABASE_URL", "TOKEN_ENCRYPTION_KEY", "SESSION_SECRET"],
    probe: isPersistentBackendReady,
    why: "Enables encrypted connected accounts, token storage, sync jobs, and workspace sessions.",
  },
  {
    id: "feature-migrations",
    label: "Feature migrations 0002 through 0053",
    required: ["DATABASE_URL"],
    probe: isFeatureMigrationsReady,
    why: "Confirms the target database recorded every forward migration through the commitment graph and can query persistent capability schema.",
  },
  {
    id: "privacy-lifecycle",
    label: "Privacy lifecycle enforcement",
    required: ["DATABASE_URL", "INTERNAL_SYNC_SECRET"],
    requiredValues: { RETENTION_SCHEDULER_STATUS: "production-live" },
    probe: isPrivacyLifecycleReady,
    why: "Requires migration 0004, at least one audited destructive enforcement run, and an operator-verified deployed fixed-policy retention cron.",
  },
  {
    id: "renewal-alerts",
    label: "Consent-gated renewal email delivery",
    required: ["DATABASE_URL", "RESEND_API_KEY", "RESEND_FROM_EMAIL", "NEXT_PUBLIC_APP_URL", "CRON_SECRET"],
    requiredValues: { RENEWAL_ALERT_DELIVERY_STATUS: "production-live" },
    probe: isRenewalAlertsReady,
    launchBlocking: false,
    why: "Requires migration 0006, complete email configuration, a delivered opt-in test reminder, and an operator-verified deployed cron.",
  },
  {
    id: "encrypted-snapshots",
    label: "Encrypted synchronized workspace state",
    required: ["DATABASE_URL", "TOKEN_ENCRYPTION_KEY", "SESSION_SECRET"],
    probe: isEncryptedSnapshotsReady,
    launchBlocking: false,
    why: "Enables signed-in beta users to auto-sync revisioned encrypted workspace state and normalized upload/manual ledger rows.",
  },
  {
    id: "identity-provider",
    label: "Recovery identity provider / Google",
    required: ["GOOGLE_AUTH_CLIENT_ID", "GOOGLE_AUTH_CLIENT_SECRET"],
    probe: isIdentityProviderReady,
    why: "Recovery launch requires the dedicated Google OIDC path. Bearer magic links are deferred until browser intent is bound.",
  },
  {
    id: "redis-rate-limit",
    label: "Shared multi-instance rate limiting",
    requiredAny: ["DATABASE_URL", "UPSTASH_REDIS_REST_URL"],
    probe: isSharedRateLimitReady,
    why: "Required before multi-instance public traffic; uses Postgres automatically or Upstash Redis REST when configured.",
  },
  {
    id: "platform-api",
    label: "Read-only platform API surface",
    required: ["DATABASE_URL"],
    probe: isPlatformApiReady,
    launchBlocking: false,
    why: "Confirms migration 0008, shared rate limiting, and unauthenticated denial on the read-only ledger/source routes. It does not claim partner adoption.",
  },
  {
    id: "monitoring",
    label: "Monitoring and incident alerts",
    requiredAny: ["SENTRY_DSN", "BETTER_STACK_SOURCE_TOKEN"],
    probe: isMonitoringReady,
    why: "Required to detect production errors and incidents.",
  },
  {
    id: "backup-storage",
    label: "Backups / encrypted object storage",
    required: ["BACKUP_RESTORE_DRILL_STATUS"],
    requiredAny: ["BACKUP_STORAGE_BUCKET", "S3_BUCKET", "R2_BUCKET"],
    probe: isBackupStorageReady,
    why: "Required before storing files or long-lived reports server-side.",
  },
];

const endpointChecks = [
  { id: "home", path: "/", expected: [200] },
  { id: "private-audit", path: "/private-audit", expected: [200] },
  { id: "login", path: "/login", expected: [200] },
  { id: "health", path: "/api/health", expected: [200], captureJson: true },
  {
    id: "readiness",
    path: "/api/readiness",
    expected: [200],
    captureJson: true,
    init: {
      headers: { authorization: `Bearer ${targetInternalSecret}` },
    },
  },
  { id: "connectors", path: "/api/connectors", expected: [410] },
  { id: "auth-session", path: "/api/auth/session", expected: [200] },
  { id: "auth-google-start", path: "/api/auth/google/start?mode=json", expected: [200, 501], captureJson: true },
  {
    id: "auth-magic-link-request",
    path: "/api/auth/magic-link/request",
    expected: [400, 501],
    captureJson: true,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `activation-magic-${Date.now()}` },
      body: JSON.stringify({}),
    },
  },
  { id: "auth-login-status", path: "/api/auth/login", expected: [200, 501], captureJson: true },
  { id: "checkout-assisted-audit", path: "/api/checkout?plan=assisted-audit", expected: [200, 501], captureJson: true },
  { id: "audit-snapshot-auth-guard", path: "/api/workspaces/current/audit-snapshot", expected: [401] },
  { id: "workspace-connectors-auth-guard", path: "/api/workspaces/current/connectors", expected: [401] },
  { id: "workspace-decisions-auth-guard", path: "/api/workspaces/current/decisions", expected: [401] },
  { id: "workspace-proof-graph-auth-guard", path: "/api/workspaces/current/proof-graph", expected: [401] },
  { id: "workspace-current-auth-guard", path: "/api/workspaces/current", expected: [401] },
  { id: "workspace-actions-retired", path: "/api/workspaces/current/actions", expected: [410], captureJson: true },
  {
    id: "workspace-ask-auth-guard",
    path: "/api/workspaces/current/ask",
    expected: [401],
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "What is my total recurring spend?" }),
    },
  },
  { id: "workspace-commitments-auth-guard", path: "/api/workspaces/current/commitments", expected: [401] },
  { id: "workspace-sources-auth-guard", path: "/api/workspaces/current/sources", expected: [401] },
  { id: "renewal-alert-preferences-auth-guard", path: "/api/renewal-alerts/preferences", expected: [401] },
  { id: "privacy-retention-policy-auth-guard", path: "/api/privacy/retention-policy", expected: [401] },
  { id: "privacy-requests-auth-guard", path: "/api/privacy/requests", expected: [401] },
  { id: "platform-token-admin-auth-guard", path: "/api/platform/tokens", expected: [401] },
  { id: "billing-entitlements-auth-guard", path: "/api/billing/entitlements", expected: [401] },
  { id: "platform-ledger-token-guard", path: "/api/v1/ledger", expected: [401, 503], captureJson: true },
  { id: "platform-sources-token-guard", path: "/api/v1/sources", expected: [401, 503], captureJson: true },
  {
    id: "workspace-connector-sync-auth-guard",
    path: "/api/workspaces/current/connectors/00000000-0000-4000-8000-000000000000/sync",
    expected: [410],
    init: { method: "POST" },
  },
  {
    id: "audit-api",
    path: "/api/audit",
    expected: [200],
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sources: [{ name: "activation.csv", text: "Date,Description,Debit,Credit\n2026-01-01,OPENAI CHATGPT,1999,\n2026-02-01,OPENAI CHATGPT,1999," }],
        manualItems: [],
      }),
    },
  },
  { id: "audit-intake-status", path: "/api/audit-intake", expected: [200, 501], captureJson: true },
  { id: "billing-return-page", path: "/billing/return", expected: [200] },
  { id: "checkout-status-guard", path: "/api/checkout/00000000-0000-4000-8000-000000000000", expected: [404, 501, 503], captureJson: true },
  { id: "gmail-product-start", path: "/api/integrations/gmail/start?mode=json", expected: [410], captureJson: true },
  { id: "gmail-callback-config", path: "/api/integrations/gmail/callback", expected: [410], captureJson: true },
  { id: "sync-due-run-retired", path: "/api/internal/sync-jobs/due/run", expected: [410], captureJson: true },
  { id: "renewal-alert-due-run-cron-guard", path: "/api/internal/renewal-alerts/due/run", expected: [401, 501], captureJson: true },
  { id: "savings-verification-retired", path: "/api/internal/savings-verification/due/run", expected: [410], captureJson: true },
  {
    id: "privacy-retention-worker-secret-guard",
    path: "/api/internal/privacy/retention/run",
    expected: [401, 501],
    captureJson: true,
    init: { method: "POST" },
  },
  {
    id: "openai-cost-sync-auth-guard",
    path: "/api/connectors/openai-costs/sync",
    expected: [410],
    captureJson: true,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `activation-openai-${Date.now()}` },
      body: JSON.stringify({ workspaceId: "env-preview" }),
    },
  },
];

const endpointReport = [];
const endpointPayloads = {};
for (const check of endpointChecks) {
  try {
    const response = await fetch(`${baseUrl}${check.path}`, {
      ...check.init,
      signal: AbortSignal.timeout(8_000),
    });
    const payload = check.captureJson ? await readResponseJson(response) : undefined;
    if (payload) endpointPayloads[check.id] = payload;
    endpointReport.push({
      id: check.id,
      path: check.path,
      status: response.status,
      ok: check.expected.includes(response.status),
      detail: summarizeProbePayload(check.id, payload),
    });
  } catch (error) {
    endpointReport.push({
      id: check.id,
      path: check.path,
      status: 0,
      ok: false,
      error: error instanceof Error ? error.message : "request failed",
    });
  }
}

const activationContext = { endpointPayloads, endpointReport };
const envReport = groups.map((group) => buildActivationReport(group, activationContext));

const summary = {
  activationProfile,
  baseUrl,
  strict,
  beta,
  endpointsReady: endpointReport.every((item) => item.ok),
  activationReady: envReport.filter((item) => item.launchBlocking).every((item) => item.ready),
  betaReady: endpointReport.every((item) => item.ok)
    && envReport.filter((item) => betaRequiredGroupIds.has(item.id)).every((item) => item.ready)
    && envReport.some((item) => betaSignInGroupIds.has(item.id) && item.ready),
  env: envReport,
  endpoints: endpointReport,
};

printReport(summary);

if (!summary.endpointsReady) process.exit(1);
if (beta && !summary.betaReady) process.exit(1);
if (strict && !summary.activationReady) process.exit(1);

function hasEnv(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

function buildActivationReport(group, context) {
  const required = group.required ?? [];
  const requiredAny = group.requiredAny ?? [];
  const requiredValues = group.requiredValues ?? {};
  const present = [...new Set([...required, ...requiredAny, ...Object.keys(requiredValues)])].filter(hasEnv);
  const missing = required.filter((name) => !hasEnv(name));
  const anySatisfied = requiredAny.length === 0 || requiredAny.some(hasEnv);
  const invalidValues = Object.entries(requiredValues)
    .filter(([name, expected]) => process.env[name]?.trim() !== expected)
    .map(([name, expected]) => `${name}=${expected}`);
  const localReady = missing.length === 0 && anySatisfied && invalidValues.length === 0;
  const targetReady = typeof group.probe === "function" ? group.probe(context) : undefined;
  const hasTargetEvidence = typeof targetReady === "boolean";
  const ready = hasTargetEvidence ? targetReady : targetIsLocal && localReady;
  const targetEvidenceMissing = !targetIsLocal && (!hasTargetEvidence || !targetReady)
    ? ["target activation evidence"]
    : [];

  return {
    id: group.id,
    label: group.label,
    launchBlocking: group.launchBlocking !== false,
    ready,
    source: hasTargetEvidence ? "target-probe" : targetIsLocal ? "local-env" : "target-evidence-unavailable",
    present,
    missing: ready ? [] : [
      ...missing,
      ...(anySatisfied ? [] : [`one of: ${requiredAny.join(" | ")}`]),
      ...invalidValues,
      ...targetEvidenceMissing,
    ],
    why: group.why,
  };
}

async function readResponseJson(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return undefined;

  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function summarizeProbePayload(id, payload) {
  if (!payload || typeof payload !== "object") return undefined;

  if (id === "readiness") {
    if (typeof payload.error === "string") {
      return {
        error: payload.error,
        hint: "Set PRODUCTION_INTERNAL_SYNC_SECRET to the deployed INTERNAL_SYNC_SECRET; never weaken the readiness route guard.",
      };
    }
    return {
      status: payload.status,
      database: payload.database?.status,
      tokenVault: payload.tokenVault?.status,
      session: payload.auth?.session?.status,
      hardening: payload.hardening,
      capabilities: payload.capabilities,
    };
  }

  if (id === "health") {
    return {
      status: payload.status,
      components: {
        redisRateLimiting: payload.components?.redisRateLimiting,
        monitoring: payload.components?.monitoring,
        backups: payload.components?.backups,
        identityProvider: payload.components?.identityProvider,
        syncWorkers: payload.components?.syncWorkers,
      },
    };
  }

  const detail = {};
  for (const key of ["status", "persisted", "plan", "requiredEnv", "message", "error", "evidenceCount"]) {
    if (Object.hasOwn(payload, key)) detail[key] = payload[key];
  }
  return Object.keys(detail).length ? detail : undefined;
}

function isLeadPersistenceReady({ endpointPayloads }) {
  const intake = endpointPayloads["audit-intake-status"];
  if (typeof intake?.persisted === "boolean") return intake.persisted;
  const readiness = endpointPayloads.readiness;
  const status = readiness?.hardening?.leadPersistence;
  return typeof status === "string" ? status.startsWith("configured") : undefined;
}

function isPaymentReady({ endpointPayloads }) {
  return endpointPayloads["checkout-assisted-audit"]?.status === "ready"
    && endpointPayloads.readiness?.hardening?.payments === "settlement-observed";
}

function isReceiptInboxReady({ endpointPayloads }) {
  const status = endpointPayloads.readiness?.hardening?.receiptInbox;
  return typeof status === "string" ? status === "operator-attested-production-live" : undefined;
}

function isPersistentBackendReady({ endpointPayloads }) {
  const readiness = endpointPayloads.readiness;
  if (!readiness) return undefined;
  return readiness.database?.status === "ready"
    && readiness.tokenVault?.status === "ready"
    && readiness.auth?.session?.status === "ready"
    && readiness.capabilities?.schema?.status === "ready";
}

function isFeatureMigrationsReady({ endpointPayloads }) {
  const capabilities = endpointPayloads.readiness?.capabilities;
  if (!capabilities) return undefined;
  return capabilities.schema?.status === "ready"
    && capabilities.schema.required?.includes("0053_phase_a_receipt_activation") === true
    && capabilities.schema.applied?.includes("0053_phase_a_receipt_activation") === true
    && capabilities.privacyLifecycle?.status !== "schema-query-failed"
    && capabilities.renewalAlerts?.status !== "schema-query-failed"
    && capabilities.commitmentDecisions?.status !== "schema-query-failed"
    && capabilities.platformApi?.status !== "schema-query-failed"
    && capabilities.billing?.status !== "schema-query-failed"
    && capabilities.recoveryV1?.status === "schema-ready-clean-cutover";
}

function isPrivacyLifecycleReady({ endpointPayloads }) {
  const readiness = endpointPayloads.readiness;
  if (!readiness) return undefined;
  return readiness.hardening?.retentionScheduler === "operator-attested-production-live"
    && typeof readiness.capabilities?.privacyLifecycle?.lastEnforcedAt === "string";
}

function isRenewalAlertsReady({ endpointPayloads }) {
  const readiness = endpointPayloads.readiness;
  if (!readiness) return undefined;
  return readiness.hardening?.renewalAlerts === "operator-attested-production-live"
    && typeof readiness.capabilities?.renewalAlerts?.lastSentAt === "string";
}

function isPlatformApiReady(context) {
  const readiness = context.endpointPayloads.readiness;
  const ledger = getEndpoint(context, "platform-ledger-token-guard");
  const sources = getEndpoint(context, "platform-sources-token-guard");
  if (!readiness || !ledger || !sources) return undefined;
  return readiness.capabilities?.schema?.status === "ready"
    && readiness.capabilities?.platformApi?.status !== "migration-pending"
    && readiness.capabilities?.platformApi?.status !== "schema-query-failed"
    && readiness.hardening?.platformApi !== "schema-ready-shared-rate-limit-required"
    && ledger.status === 401
    && sources.status === 401;
}

function isEncryptedSnapshotsReady(context) {
  const readiness = context.endpointPayloads.readiness;
  if (!readiness) return undefined;
  return isIdentityProviderReady(context) === true
    && readiness.database?.status === "ready"
    && readiness.tokenVault?.status === "ready"
    && readiness.auth?.session?.status === "ready";
}

function isIdentityProviderReady({ endpointPayloads }) {
  const status = endpointPayloads.readiness?.hardening?.identityProvider;
  if (typeof status !== "string") return undefined;
  return status === "google-ready";
}

function isSharedRateLimitReady({ endpointPayloads }) {
  const status = endpointPayloads.readiness?.hardening?.sharedRateLimiting;
  if (typeof status === "string") return status.startsWith("configured-");

  const legacyStatus = endpointPayloads.readiness?.hardening?.redisRateLimiting;
  return typeof legacyStatus === "string" ? legacyStatus === "configured" : undefined;
}

function isMonitoringReady({ endpointPayloads }) {
  const status = endpointPayloads.readiness?.hardening?.monitoring;
  return typeof status === "string" ? status.startsWith("configured-") : undefined;
}

function isBackupStorageReady({ endpointPayloads }) {
  const status = endpointPayloads.readiness?.hardening?.backups;
  return typeof status === "string" ? status === "configured" : undefined;
}

function getEndpoint(context, id) {
  return context.endpointReport.find((endpoint) => endpoint.id === id);
}

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const raw = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key]) continue;
    process.env[key] = raw.replace(/^['\"]|['\"]$/g, "");
  }
}

function printReport(report) {
  console.log(`Vognary production activation check: ${report.baseUrl}`);
  console.log(`Endpoint health: ${report.endpointsReady ? "PASS" : "FAIL"}`);
  for (const endpoint of report.endpoints) {
    console.log(`  ${endpoint.ok ? "PASS" : "FAIL"} ${endpoint.status} ${endpoint.path}`);
  }
  if (report.beta) {
    console.log(`Private beta activation: ${report.betaReady ? "READY" : "INCOMPLETE"}`);
    for (const item of report.env.filter((envItem) => betaRequiredGroupIds.has(envItem.id) || betaSignInGroupIds.has(envItem.id))) {
      console.log(`  ${item.ready ? "READY" : "MISSING"} ${item.label}`);
      if (!item.ready) console.log(`    missing: ${item.missing.join(", ")}`);
    }
  }
  console.log(`External activation: ${report.activationReady ? "READY" : "INCOMPLETE"}`);
  for (const item of report.env) {
    console.log(`  ${item.ready ? "READY" : "MISSING"} ${item.label}`);
    if (!item.ready) console.log(`    missing: ${item.missing.join(", ")}`);
  }
  console.log(JSON.stringify(report, null, 2));
}
