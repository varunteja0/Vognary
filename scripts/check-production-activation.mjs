import { existsSync, readFileSync } from "node:fs";

const envFiles = [".env.local", ".env"];
for (const file of envFiles) loadEnvFile(file);

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const urlArg = args.find((arg) => arg.startsWith("http://") || arg.startsWith("https://"));
const baseUrl = (urlArg || process.env.NEXT_PUBLIC_APP_URL || "https://www.vognary.com").replace(/\/$/, "");

const groups = [
  {
    id: "lead-persistence",
    label: "Lead persistence",
    requiredAny: ["AUDIT_INTAKE_WEBHOOK_URL", "WAITLIST_WEBHOOK_URL"],
    why: "Persists private audit and waitlist leads instead of preview-only responses.",
  },
  {
    id: "payments",
    label: "Payment links",
    required: ["PAYMENT_LINK_PERSONAL_PRO", "PAYMENT_LINK_FOUNDER_PRO", "PAYMENT_LINK_TEAM", "PAYMENT_LINK_ANNUAL_AUDIT"],
    why: "Enables paid plan checkout buttons and private audit collection.",
  },
  {
    id: "gmail-oauth",
    label: "Gmail OAuth",
    required: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"],
    why: "Lets users authorize their own Gmail accounts for receipt discovery.",
  },
  {
    id: "persistent-backend",
    label: "Persistent backend",
    required: ["DATABASE_URL", "TOKEN_ENCRYPTION_KEY", "SESSION_SECRET", "INTERNAL_SYNC_SECRET"],
    why: "Enables encrypted connected accounts, token storage, sync jobs, and workspace sessions.",
  },
  {
    id: "private-beta-login",
    label: "Private beta login",
    required: ["DATABASE_URL", "SESSION_SECRET", "PRIVATE_BETA_ACCESS_CODE"],
    why: "Enables invited beta users to sign in and create a workspace envelope.",
  },
  {
    id: "encrypted-snapshots",
    label: "Encrypted server snapshots",
    required: ["DATABASE_URL", "TOKEN_ENCRYPTION_KEY", "SESSION_SECRET", "PRIVATE_BETA_ACCESS_CODE"],
    why: "Enables signed-in beta users to save encrypted audit snapshots server-side.",
  },
  {
    id: "openai-costs",
    label: "OpenAI cost sync",
    required: ["OPENAI_ADMIN_API_KEY"],
    why: "Enables the first direct provider cost adapter.",
  },
  {
    id: "identity-provider",
    label: "Identity provider",
    requiredAny: ["CLERK_SECRET_KEY", "RESEND_API_KEY", "AUTH_PROVIDER"],
    why: "Required to mint real user sessions instead of only verifying signed cookies.",
  },
  {
    id: "redis-rate-limit",
    label: "Redis / trusted proxy rate limiting",
    requiredAny: ["REDIS_URL", "UPSTASH_REDIS_REST_URL"],
    why: "Required before multi-instance public traffic; current limiter is in-memory.",
  },
  {
    id: "monitoring",
    label: "Monitoring and incident alerts",
    requiredAny: ["SENTRY_DSN", "AXIOM_TOKEN", "BETTER_STACK_SOURCE_TOKEN"],
    why: "Required to detect production errors and incidents.",
  },
  {
    id: "backup-storage",
    label: "Backups / encrypted object storage",
    requiredAny: ["BACKUP_STORAGE_BUCKET", "S3_BUCKET", "R2_BUCKET"],
    why: "Required before storing files or long-lived reports server-side.",
  },
  {
    id: "partner-rails",
    label: "AA / UPI / card mandate partner rails",
    requiredAny: ["ACCOUNT_AGGREGATOR_PARTNER_STATUS", "UPI_MANDATE_PARTNER_STATUS", "CARD_MANDATE_PARTNER_STATUS"],
    why: "Required for regulated real-time mandate and bank data access.",
  },
];

const endpointChecks = [
  { id: "home", path: "/", expected: [200] },
  { id: "private-audit", path: "/private-audit", expected: [200] },
  { id: "login", path: "/login", expected: [200] },
  { id: "health", path: "/api/health", expected: [200] },
  { id: "readiness", path: "/api/readiness", expected: [200] },
  { id: "connectors", path: "/api/connectors", expected: [200] },
  { id: "auth-session", path: "/api/auth/session", expected: [200] },
  {
    id: "auth-login-guard",
    path: "/api/auth/login",
    expected: [401, 501],
    init: {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `activation-login-${Date.now()}` },
      body: JSON.stringify({ email: "activation@example.com", accessCode: "wrong" }),
    },
  },
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
  { id: "gmail-product-start", path: "/api/integrations/gmail/start?mode=json", expected: [200] },
];

const envReport = groups.map((group) => {
  const required = group.required ?? [];
  const requiredAny = group.requiredAny ?? [];
  const present = [...required, ...requiredAny].filter(hasEnv);
  const missing = required.filter((name) => !hasEnv(name));
  const anySatisfied = requiredAny.length === 0 || requiredAny.some(hasEnv);
  const ready = missing.length === 0 && anySatisfied;
  return {
    id: group.id,
    label: group.label,
    ready,
    present,
    missing: [
      ...missing,
      ...(anySatisfied ? [] : [`one of: ${requiredAny.join(" | ")}`]),
    ],
    why: group.why,
  };
});

const endpointReport = [];
for (const check of endpointChecks) {
  try {
    const response = await fetch(`${baseUrl}${check.path}`, check.init);
    endpointReport.push({
      id: check.id,
      path: check.path,
      status: response.status,
      ok: check.expected.includes(response.status),
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

const summary = {
  baseUrl,
  strict,
  endpointsReady: endpointReport.every((item) => item.ok),
  activationReady: envReport.every((item) => item.ready),
  env: envReport,
  endpoints: endpointReport,
};

printReport(summary);

if (!summary.endpointsReady) process.exit(1);
if (strict && !summary.activationReady) process.exit(1);

function hasEnv(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
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
  console.log(`External activation: ${report.activationReady ? "READY" : "INCOMPLETE"}`);
  for (const item of report.env) {
    console.log(`  ${item.ready ? "READY" : "MISSING"} ${item.label}`);
    if (!item.ready) console.log(`    missing: ${item.missing.join(", ")}`);
  }
  console.log(JSON.stringify(report, null, 2));
}
