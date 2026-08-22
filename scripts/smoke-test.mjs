const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const smokeTarget = new URL(baseUrl);
const targetIsLocal = ["localhost", "127.0.0.1", "::1"].includes(smokeTarget.hostname);
const allowUnconfigured = process.env.SMOKE_ALLOW_UNCONFIGURED === "true";
if (allowUnconfigured && !targetIsLocal) throw new Error("SMOKE_ALLOW_UNCONFIGURED is permitted only for a local target.");

async function assertOk(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response;
}

await assertOk("/");
await assertOk("/verify");
await assertOk("/sources");
await assertOk("/privacy");
await assertOk("/security");
await assertOk("/private-audit");
await assertOk("/login");

for (const [legacy, destination] of [["/connect", "/app"], ["/integrations", "/app"], ["/sources", "/app"], ["/launch", "/login?next=/app"], ["/private-audit", "/login?next=/app"]]) {
  const response = await fetch(`${baseUrl}${legacy}`, { redirect: "manual" });
  if (response.status !== 308) throw new Error(`${legacy} compatibility redirect returned ${response.status}`);
  const location = response.headers.get("location");
  const redirectUrl = location ? new URL(location, baseUrl) : null;
  if (!redirectUrl || `${redirectUrl.pathname}${redirectUrl.search}` !== destination) throw new Error(`${legacy} did not redirect to ${destination}`);
}

const health = await (await assertOk("/api/health")).json();
if (health.status !== "ok") throw new Error("Health endpoint did not return ok");

const readiness = await (await assertOk("/api/readiness", {
  headers: { authorization: `Bearer ${process.env.SMOKE_INTERNAL_SECRET || "ci-internal-sync-secret-at-least-32-bytes"}` },
})).json();
if (!["ok", "degraded"].includes(readiness.status)) throw new Error("Readiness endpoint returned an invalid status");
if (!readiness.database?.status) throw new Error("Readiness endpoint did not report database status");
if (!["not-configured", "ready", "invalid"].includes(readiness.tokenVault?.status)) throw new Error("Readiness endpoint did not report token vault status");
if (!readiness.auth?.session?.status) throw new Error("Readiness endpoint did not report auth session status");
if (!readiness.capabilities?.schema?.status) throw new Error("Readiness endpoint did not report feature migration status");
if (!allowUnconfigured) {
  if (readiness.status !== "ok") throw new Error(`Readiness is ${readiness.status}; production smoke requires ok`);
  if (readiness.database?.status !== "ready") throw new Error("Production smoke requires a ready database");
  if (readiness.capabilities?.schema?.status !== "ready") throw new Error("Production smoke requires all feature migrations");
  if (readiness.hardening?.receiptInbox !== "operator-attested-production-live") {
    throw new Error("Production smoke requires operator-attested receipt forwarding");
  }
}
for (const capability of ["privacyLifecycle", "renewalAlerts", "commitmentDecisions", "platformApi"]) {
  if (!readiness.capabilities?.[capability]?.status) throw new Error(`Readiness endpoint did not report ${capability} status`);
}

const authSession = await (await assertOk("/api/auth/session")).json();
if (typeof authSession.authenticated !== "boolean") throw new Error("Auth session endpoint did not return authenticated state");

const signingKeys = await (await assertOk("/api/audit-packs/sign")).json();
if (!["ready", "not-configured"].includes(signingKeys.status)) throw new Error("Audit-pack signing key discovery returned an invalid state");
if (signingKeys.algorithm !== "Ed25519" || !Array.isArray(signingKeys.keys)) throw new Error("Audit-pack signing key discovery returned an invalid contract");

const signingWithoutSession = await fetch(`${baseUrl}/api/audit-packs/sign`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-forwarded-for": `audit-pack-sign-smoke-${Date.now()}` },
  body: JSON.stringify({ integrity: {} }),
});
if (!(allowUnconfigured ? [401, 503] : [401]).includes(signingWithoutSession.status)) throw new Error(`Audit-pack signing without session returned ${signingWithoutSession.status}`);

const loginWithoutSetup = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-forwarded-for": `login-smoke-${Date.now()}` },
  body: JSON.stringify({ email: "smoke@example.com", accessCode: "wrong" }),
});
if (!(allowUnconfigured ? [401, 404, 501, 503] : [401, 404, 501]).includes(loginWithoutSetup.status)) throw new Error(`Login endpoint returned ${loginWithoutSetup.status}`);

const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST" });
if (!logoutResponse.ok) throw new Error(`Logout endpoint returned ${logoutResponse.status}`);

const workspaceWithoutSession = await fetch(`${baseUrl}/api/workspaces`);
if (!(allowUnconfigured ? [401, 503] : [401]).includes(workspaceWithoutSession.status)) throw new Error(`Workspace endpoint without session returned ${workspaceWithoutSession.status}`);

const snapshotWithoutSession = await fetch(`${baseUrl}/api/workspaces/current/audit-snapshot`);
if (!(allowUnconfigured ? [401, 503] : [401]).includes(snapshotWithoutSession.status)) throw new Error(`Audit snapshot endpoint without session returned ${snapshotWithoutSession.status}`);

for (const [path, init] of [
  ["/api/connectors"],
  ["/api/connectors/gmail-readonly/start"],
  ["/api/connectors/openai-costs/sync"],
  ["/api/connectors/openai-costs/webhook", { method: "POST" }],
  ["/api/integrations/gmail/start?mode=json"],
  ["/api/integrations/gmail/callback"],
  ["/api/integrations/aa/start"],
  ["/api/workspaces/current/actions"],
  ["/api/workspaces/current/actions/00000000-0000-4000-8000-000000000000/authorize", { method: "POST" }],
  ["/api/workspaces/current/actions/00000000-0000-4000-8000-000000000000", { method: "PATCH" }],
  ["/api/internal/action-cases/00000000-0000-4000-8000-000000000000/transition", { method: "POST" }],
  ["/api/internal/savings-verification/due/run"],
]) {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (response.status !== 410) throw new Error(`${path} returned ${response.status} instead of retired`);
  const payload = await response.json();
  if (payload.status !== "retired" || payload.ledgerAuthority !== "RECOVERY_V1") {
    throw new Error(`${path} did not return the Recovery retirement contract`);
  }
}

const sourcesWithoutSession = await fetch(`${baseUrl}/api/workspaces/current/sources`);
if (!(allowUnconfigured ? [401, 503] : [401]).includes(sourcesWithoutSession.status)) throw new Error(`Recovery Sources without session returned ${sourcesWithoutSession.status}`);

const unsignedReceiptWebhook = await fetch(`${baseUrl}/api/webhooks/resend/inbound`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "email.received", data: {} }),
});
const expectedUnsignedReceiptStatus = process.env.ENABLE_RECEIPT_INBOX === "true" ? 401 : 501;
if (unsignedReceiptWebhook.status !== expectedUnsignedReceiptStatus) {
  throw new Error(`Unsigned receipt webhook returned ${unsignedReceiptWebhook.status} instead of ${expectedUnsignedReceiptStatus}`);
}

const internalSyncWithoutSecret = await fetch(`${baseUrl}/api/internal/sync-jobs`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ connectorId: "openai-costs", workspaceId: "00000000-0000-0000-0000-000000000000" }),
});
if (internalSyncWithoutSecret.status !== 410) throw new Error(`Retired internal sync job returned ${internalSyncWithoutSecret.status}`);

const auditResponse = await fetch(`${baseUrl}/api/audit`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    sources: [{ name: "statement.csv", text: "Date,Description,Debit,Credit\n2026-01-01,OPENAI CHATGPT,1999,\n2026-02-01,OPENAI CHATGPT,1999," }],
    manualItems: [],
  }),
});
const auditBackendUnavailable = allowUnconfigured && auditResponse.status === 503;
if (!auditBackendUnavailable) {
  if (!auditResponse.ok) throw new Error(`Audit endpoint returned ${auditResponse.status}`);
  const audit = await auditResponse.json();
  if (!audit.audit?.summary) throw new Error("Audit endpoint did not return a summary");
  if (!audit.timeline || !Array.isArray(audit.timeline.events)) throw new Error("Audit endpoint did not return a renewal timeline");
}

const receiptAuditResponse = await fetch(`${baseUrl}/api/audit`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    sources: [],
    manualItems: [],
    receiptTexts: ["OpenAI invoice paid INR 1,999 on 2026-07-06. ChatGPT Plus renews monthly."],
  }),
});
if (auditBackendUnavailable) {
  if (receiptAuditResponse.status !== 503) throw new Error(`Receipt audit returned ${receiptAuditResponse.status} while audit backend was unavailable`);
} else {
  if (!receiptAuditResponse.ok) throw new Error(`Receipt audit request returned ${receiptAuditResponse.status}`);
  const receiptAudit = await receiptAuditResponse.json();
  if (!receiptAudit.audit?.recurringItems?.length) throw new Error("Receipt texts did not produce recurring candidates");
}

const invalidAuditResponse = await fetch(`${baseUrl}/api/audit`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ manualItems: [{ id: "bad", merchant: "", amount: -5, frequency: "sometimes", nextExpectedDate: "", category: "" }] }),
});
const expectedInvalidAuditStatus = auditBackendUnavailable ? 503 : 400;
if (invalidAuditResponse.status !== expectedInvalidAuditStatus) {
  throw new Error(`Invalid manual item returned ${invalidAuditResponse.status} instead of ${expectedInvalidAuditStatus}`);
}

const auditIntakeResponse = await fetch(`${baseUrl}/api/audit-intake`);
if (auditIntakeResponse.status !== 410) throw new Error(`Retired audit intake returned ${auditIntakeResponse.status}`);
const auditIntake = await auditIntakeResponse.json();
if (auditIntake.status !== "retired" || auditIntake.replacement !== "/login?next=/app") throw new Error("Retired audit intake returned an invalid contract");

console.log(JSON.stringify({ status: "ok", baseUrl, routes: "verified" }, null, 2));
