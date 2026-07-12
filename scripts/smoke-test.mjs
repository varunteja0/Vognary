const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";

async function assertOk(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response;
}

await assertOk("/");
await assertOk("/verify");
await assertOk("/launch");
await assertOk("/sources");
await assertOk("/integrations");
await assertOk("/privacy");
await assertOk("/security");
await assertOk("/private-audit");
await assertOk("/login");

const health = await (await assertOk("/api/health")).json();
if (health.status !== "ok") throw new Error("Health endpoint did not return ok");

const readiness = await (await assertOk("/api/readiness", {
  headers: { authorization: `Bearer ${process.env.SMOKE_INTERNAL_SECRET || "ci-internal-sync-secret"}` },
})).json();
if (!["ok", "degraded"].includes(readiness.status)) throw new Error("Readiness endpoint returned an invalid status");
if (!readiness.database?.status) throw new Error("Readiness endpoint did not report database status");
if (!["not-configured", "ready", "invalid"].includes(readiness.tokenVault?.status)) throw new Error("Readiness endpoint did not report token vault status");
if (!readiness.auth?.session?.status) throw new Error("Readiness endpoint did not report auth session status");
if (!readiness.capabilities?.schema?.status) throw new Error("Readiness endpoint did not report feature migration status");
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
if (signingWithoutSession.status !== 401) throw new Error(`Audit-pack signing without session returned ${signingWithoutSession.status}`);

const loginWithoutSetup = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-forwarded-for": `login-smoke-${Date.now()}` },
  body: JSON.stringify({ email: "smoke@example.com", accessCode: "wrong" }),
});
if (![401, 404, 501].includes(loginWithoutSetup.status)) throw new Error(`Login endpoint returned ${loginWithoutSetup.status}`);

const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST" });
if (!logoutResponse.ok) throw new Error(`Logout endpoint returned ${logoutResponse.status}`);

const workspaceWithoutSession = await fetch(`${baseUrl}/api/workspaces`);
if (workspaceWithoutSession.status !== 401) throw new Error(`Workspace endpoint without session returned ${workspaceWithoutSession.status}`);

const snapshotWithoutSession = await fetch(`${baseUrl}/api/workspaces/current/audit-snapshot`);
if (snapshotWithoutSession.status !== 401) throw new Error(`Audit snapshot endpoint without session returned ${snapshotWithoutSession.status}`);

const connectors = await (await assertOk("/api/connectors")).json();
if (!connectors.connectors?.length) throw new Error("Connector registry is empty");
if (typeof connectors.syncSummary?.total !== "number" || connectors.syncSummary.total < 30) throw new Error("Connector registry does not include the live-sync target surface");
if (!connectors.readiness?.length) throw new Error("Connector readiness map is missing");
if (!connectors.adapters?.includes("openai-costs")) throw new Error("OpenAI costs adapter is not registered");
if (!connectors.honesty?.length) throw new Error("Connector honesty map is missing");
const honestyStates = new Set(connectors.honesty.map((entry) => entry.state));
const allowedHonestyStates = new Set(["live", "usage-only", "source-health-only", "setup-ready", "token-required", "oauth-required", "verification-required", "partner-gated", "blocked", "evidence-only", "planned"]);
for (const state of honestyStates) {
  if (!allowedHonestyStates.has(state)) throw new Error(`Connector honesty map returned an unknown state: ${state}`);
}
const aaHonesty = connectors.honesty.find((entry) => entry.id === "account-aggregator");
if (aaHonesty?.state !== "partner-gated") throw new Error("Account Aggregator must report partner-gated honesty state");

const gmailStart = await (await assertOk("/api/connectors/gmail-readonly/start")).json();
if (!["ready-to-connect", "needs-configuration"].includes(gmailStart.state)) throw new Error("Gmail connector start state is invalid");

const gmailProductStartResponse = await fetch(`${baseUrl}/api/integrations/gmail/start?mode=json`);
if (![200, 401, 501].includes(gmailProductStartResponse.status)) {
  throw new Error(`Gmail product start endpoint returned ${gmailProductStartResponse.status}`);
}
if (gmailProductStartResponse.ok) {
  const gmailProductStart = await gmailProductStartResponse.json();
  if (!["ready", "not-configured"].includes(gmailProductStart.status)) throw new Error("Gmail product start endpoint returned an invalid state");
}

const plannedStart = await (await assertOk("/api/connectors/anthropic-usage/start")).json();
if (plannedStart.state === "ready-to-connect") throw new Error("Planned connector must not claim ready-to-connect");

const partnerStart = await (await assertOk("/api/connectors/account-aggregator/start")).json();
if (partnerStart.state !== "partner-gated") throw new Error("Partner-required connector did not report partner-gated start state");

const plannedSync = await (await assertOk("/api/connectors/anthropic-usage/sync")).json();
if (!plannedSync.plan?.blockers?.length) throw new Error("Planned connector did not explain sync blockers");

const blockedPlannedSync = await fetch(`${baseUrl}/api/connectors/anthropic-usage/sync`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ workspaceId: "smoke" }),
});
if (blockedPlannedSync.status !== 401) throw new Error(`Unauthenticated blocked connector sync returned ${blockedPlannedSync.status}`);

const manualSync = await (await assertOk("/api/connectors/apple-receipt-evidence/sync")).json();
if (manualSync.plan?.state !== "manual") throw new Error("Manual evidence connector should report manual sync state");

const manualSyncResponse = await fetch(`${baseUrl}/api/connectors/apple-receipt-evidence/sync`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ workspaceId: "smoke" }),
});
if (manualSyncResponse.status !== 401) throw new Error(`Unauthenticated manual connector sync returned ${manualSyncResponse.status}`);

const webhookWithoutSecret = await fetch(`${baseUrl}/api/connectors/openai-costs/webhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: "smoke", type: "connector.smoke" }),
});
if (![401, 501].includes(webhookWithoutSecret.status)) throw new Error(`Unsigned webhook returned ${webhookWithoutSecret.status}`);

const internalSyncWithoutSecret = await fetch(`${baseUrl}/api/internal/sync-jobs`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ connectorId: "openai-costs", workspaceId: "00000000-0000-0000-0000-000000000000" }),
});
if (![401, 501].includes(internalSyncWithoutSecret.status)) throw new Error(`Internal sync job without secret returned ${internalSyncWithoutSecret.status}`);

const auditResponse = await fetch(`${baseUrl}/api/audit`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    sources: [{ name: "statement.csv", text: "Date,Description,Debit,Credit\n2026-01-01,OPENAI CHATGPT,1999,\n2026-02-01,OPENAI CHATGPT,1999," }],
    manualItems: [],
  }),
});
if (!auditResponse.ok) throw new Error(`Audit endpoint returned ${auditResponse.status}`);
const audit = await auditResponse.json();
if (!audit.audit?.summary) throw new Error("Audit endpoint did not return a summary");
if (!audit.timeline || !Array.isArray(audit.timeline.events)) throw new Error("Audit endpoint did not return a renewal timeline");

const receiptAuditResponse = await fetch(`${baseUrl}/api/audit`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    sources: [],
    manualItems: [],
    receiptTexts: ["OpenAI invoice paid INR 1,999 on 2026-07-06. ChatGPT Plus renews monthly."],
  }),
});
if (!receiptAuditResponse.ok) throw new Error(`Receipt audit request returned ${receiptAuditResponse.status}`);
const receiptAudit = await receiptAuditResponse.json();
if (!receiptAudit.audit?.recurringItems?.length) throw new Error("Receipt texts did not produce recurring candidates");

const invalidAuditResponse = await fetch(`${baseUrl}/api/audit`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ manualItems: [{ id: "bad", merchant: "", amount: -5, frequency: "sometimes", nextExpectedDate: "", category: "" }] }),
});
if (invalidAuditResponse.status !== 400) throw new Error(`Invalid manual item returned ${invalidAuditResponse.status} instead of 400`);

const auditIntakeResponse = await fetch(`${baseUrl}/api/audit-intake`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-forwarded-for": `smoke-${Date.now()}` },
  body: JSON.stringify({
    name: "Smoke Founder",
    email: "smoke@example.com",
    contact: "LinkedIn",
    persona: "Founder",
    spendGuess: "50000",
    paymentTypes: ["AI tools", "SaaS tools"],
    sourceTypes: ["Redacted bank/card statement"],
    biggestConcern: "Privacy",
    canContact: true,
    message: "Smoke audit intake validation",
  }),
});
if (!auditIntakeResponse.ok) throw new Error(`Audit intake endpoint returned ${auditIntakeResponse.status}`);
const auditIntake = await auditIntakeResponse.json();
if (!auditIntake.status) throw new Error("Audit intake endpoint did not return a status");

console.log(JSON.stringify({ status: "ok", baseUrl, routes: "verified" }, null, 2));
