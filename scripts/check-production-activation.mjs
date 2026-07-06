import { existsSync, readFileSync } from "node:fs";

const envFiles = [".env.local", ".env"];
for (const file of envFiles) loadEnvFile(file);

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const beta = args.includes("--beta");
const urlArg = args.find((arg) => arg.startsWith("http://") || arg.startsWith("https://"));
const baseUrl = (urlArg || process.env.NEXT_PUBLIC_APP_URL || "https://www.vognary.com").replace(/\/$/, "");

const betaRequiredGroupIds = new Set(["lead-persistence", "encrypted-snapshots"]);
const betaSignInGroupIds = new Set(["identity-provider", "private-beta-login"]);

const groups = [
  {
    id: "lead-persistence",
    label: "Lead persistence",
    requiredAny: ["AUDIT_INTAKE_WEBHOOK_URL", "WAITLIST_WEBHOOK_URL"],
    probe: isLeadPersistenceReady,
    why: "Persists private audit and waitlist leads instead of preview-only responses.",
  },
  {
    id: "payments",
    label: "Payment links",
    required: ["PAYMENT_LINK_PERSONAL_PRO", "PAYMENT_LINK_FOUNDER_PRO", "PAYMENT_LINK_TEAM", "PAYMENT_LINK_ANNUAL_AUDIT"],
    probe: isPaymentReady,
    why: "Enables paid plan checkout buttons and private audit collection.",
  },
  {
    id: "gmail-oauth",
    label: "Gmail OAuth",
    required: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"],
    probe: isGmailOAuthReady,
    why: "Lets users authorize their own Gmail accounts for receipt discovery.",
  },
  {
    id: "persistent-backend",
    label: "Persistent backend",
    required: ["DATABASE_URL", "TOKEN_ENCRYPTION_KEY", "SESSION_SECRET", "INTERNAL_SYNC_SECRET"],
    probe: isPersistentBackendReady,
    why: "Enables encrypted connected accounts, token storage, sync jobs, and workspace sessions.",
  },
  {
    id: "private-beta-login",
    label: "Private beta login",
    required: ["DATABASE_URL", "SESSION_SECRET", "PRIVATE_BETA_ACCESS_CODE"],
    probe: isPrivateBetaLoginReady,
    why: "Enables invited beta users to sign in and create a workspace envelope.",
  },
  {
    id: "encrypted-snapshots",
    label: "Encrypted server snapshots",
    required: ["DATABASE_URL", "TOKEN_ENCRYPTION_KEY", "SESSION_SECRET", "PRIVATE_BETA_ACCESS_CODE"],
    probe: isEncryptedSnapshotsReady,
    why: "Enables signed-in beta users to save encrypted audit snapshots server-side.",
  },
  {
    id: "openai-costs",
    label: "OpenAI cost sync",
    required: ["OPENAI_ADMIN_API_KEY"],
    probe: isOpenAiCostSyncReady,
    why: "Enables the first direct provider cost adapter.",
  },
  {
    id: "identity-provider",
    label: "Identity provider / Google or magic link",
    requiredAny: ["GOOGLE_AUTH_CLIENT_ID", "GOOGLE_CLIENT_ID", "RESEND_API_KEY", "AUTH_PROVIDER"],
    probe: isIdentityProviderReady,
    why: "Required to mint real user sessions through Google OAuth or Resend magic links.",
  },
  {
    id: "redis-rate-limit",
    label: "Redis / trusted proxy rate limiting",
    required: ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    probe: isRedisRateLimitReady,
    why: "Required before multi-instance public traffic; uses Upstash Redis REST when configured.",
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
  {
    id: "partner-rails",
    label: "AA / UPI / card mandate partner rails",
    requiredAny: ["ACCOUNT_AGGREGATOR_PARTNER_STATUS", "UPI_MANDATE_PARTNER_STATUS", "CARD_MANDATE_PARTNER_STATUS"],
    probe: isPartnerRailsReady,
    why: "Required for regulated real-time mandate and bank data access.",
  },
];

const endpointChecks = [
  { id: "home", path: "/", expected: [200] },
  { id: "private-audit", path: "/private-audit", expected: [200] },
  { id: "login", path: "/login", expected: [200] },
  { id: "health", path: "/api/health", expected: [200], captureJson: true },
  { id: "readiness", path: "/api/readiness", expected: [200], captureJson: true },
  { id: "connectors", path: "/api/connectors", expected: [200] },
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
  {
    id: "auth-login-guard",
    path: "/api/auth/login",
    expected: [401, 501],
    captureJson: true,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `activation-login-${Date.now()}` },
      body: JSON.stringify({ email: "activation@example.com", accessCode: "wrong" }),
    },
  },
  ...["personal", "founder", "team", "annual"].map((plan) => ({
    id: `checkout-${plan}`,
    path: "/api/checkout",
    expected: [200, 501],
    captureJson: true,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `activation-checkout-${plan}-${Date.now()}` },
      body: JSON.stringify({ plan }),
    },
  })),
  {
    id: "auth-logout",
    path: "/api/auth/logout",
    expected: [200],
    init: { method: "POST" },
  },
  { id: "audit-snapshot-auth-guard", path: "/api/workspaces/current/audit-snapshot", expected: [401] },
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
  {
    id: "audit-intake",
    path: "/api/audit-intake",
    expected: [200],
    captureJson: true,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `activation-${Date.now()}` },
      body: JSON.stringify({
        name: "Activation Check",
        email: "activation@example.com",
        persona: "Founder",
        paymentTypes: ["AI tools"],
        sourceTypes: ["Redacted bank/card statement"],
        biggestConcern: "Privacy",
        canContact: true,
      }),
    },
  },
  { id: "gmail-product-start", path: "/api/integrations/gmail/start?mode=json", expected: [200], captureJson: true },
  { id: "gmail-callback-config", path: "/api/integrations/gmail/callback", expected: [400, 501], captureJson: true },
  {
    id: "openai-cost-sync",
    path: "/api/connectors/openai-costs/sync",
    expected: [200, 409, 502],
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
    const response = await fetch(`${baseUrl}${check.path}`, check.init);
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
  baseUrl,
  strict,
  beta,
  endpointsReady: endpointReport.every((item) => item.ok),
  activationReady: envReport.every((item) => item.ready),
  betaReady: envReport.filter((item) => betaRequiredGroupIds.has(item.id)).every((item) => item.ready)
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
  const present = [...required, ...requiredAny].filter(hasEnv);
  const missing = required.filter((name) => !hasEnv(name));
  const anySatisfied = requiredAny.length === 0 || requiredAny.some(hasEnv);
  const localReady = missing.length === 0 && anySatisfied;
  const targetReady = typeof group.probe === "function" ? group.probe(context) : undefined;
  const ready = typeof targetReady === "boolean" ? targetReady : localReady;

  return {
    id: group.id,
    label: group.label,
    ready,
    source: typeof targetReady === "boolean" ? "target-probe" : "local-env",
    present,
    missing: ready ? [] : [
      ...missing,
      ...(anySatisfied ? [] : [`one of: ${requiredAny.join(" | ")}`]),
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
    return {
      status: payload.status,
      database: payload.database?.status,
      tokenVault: payload.tokenVault?.status,
      session: payload.auth?.session?.status,
      hardening: payload.hardening,
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
  const intake = endpointPayloads["audit-intake"];
  if (typeof intake?.persisted === "boolean") return intake.persisted;
  const readiness = endpointPayloads.readiness;
  return readiness?.hardening?.leadPersistence === "configured";
}

function isPaymentReady({ endpointPayloads }) {
  return ["personal", "founder", "team", "annual"].every((plan) => endpointPayloads[`checkout-${plan}`]?.status === "ready");
}

function isGmailOAuthReady(context) {
  const start = context.endpointPayloads["gmail-product-start"];
  const callback = getEndpoint(context, "gmail-callback-config");
  if (!start || !callback) return undefined;
  return start.status === "ready" && callback.status === 400;
}

function isPersistentBackendReady({ endpointPayloads }) {
  const readiness = endpointPayloads.readiness;
  if (!readiness) return undefined;
  return readiness.database?.status === "ready"
    && readiness.tokenVault?.status === "ready"
    && readiness.auth?.session?.status === "ready"
    && readiness.hardening?.internalSyncJobApi === "configured";
}

function isPrivateBetaLoginReady(context) {
  const login = getEndpoint(context, "auth-login-guard");
  return login ? login.status === 401 : undefined;
}

function isEncryptedSnapshotsReady(context) {
  const readiness = context.endpointPayloads.readiness;
  if (!readiness) return undefined;
  const signInReady = isPrivateBetaLoginReady(context) === true || isIdentityProviderReady(context) === true;
  return signInReady
    && readiness.database?.status === "ready"
    && readiness.tokenVault?.status === "ready"
    && readiness.auth?.session?.status === "ready";
}

function isOpenAiCostSyncReady({ endpointPayloads }) {
  const payload = endpointPayloads["openai-cost-sync"];
  return payload ? payload.status === "sync-preview-complete" : undefined;
}

function isIdentityProviderReady({ endpointPayloads }) {
  const status = endpointPayloads.readiness?.hardening?.identityProvider;
  if (typeof status !== "string") return undefined;
  return status === "magic-link-ready" || status === "google-ready";
}

function isRedisRateLimitReady({ endpointPayloads }) {
  const status = endpointPayloads.readiness?.hardening?.redisRateLimiting;
  return typeof status === "string" ? status === "configured" : undefined;
}

function isMonitoringReady({ endpointPayloads }) {
  const status = endpointPayloads.readiness?.hardening?.monitoring;
  return typeof status === "string" ? status.startsWith("configured-") : undefined;
}

function isBackupStorageReady({ endpointPayloads }) {
  const status = endpointPayloads.readiness?.hardening?.backups;
  return typeof status === "string" ? status === "configured" : undefined;
}

function isPartnerRailsReady({ endpointPayloads }) {
  const status = endpointPayloads.readiness?.hardening?.partnerRails;
  return typeof status === "string" ? status === "partner-status-recorded" : undefined;
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
