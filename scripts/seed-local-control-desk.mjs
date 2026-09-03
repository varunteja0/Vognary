// Seeds the local dev workspace with a realistic Commitment Control desk.
//
// Every judgement about the daily desk was being made against an empty
// first-run workspace, which is not the product anyone will use. This drives
// the REAL API with a real session, so the result is genuine product state:
// no mocks, no fixtures, no writes to protected code.
//
// Local dev only. Refuses to run against anything but localhost/127.0.0.1.
const base = process.argv[2] ?? "http://127.0.0.1:3123";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|$)/.test(base)) {
  console.error(`Refusing to seed a non-local target: ${base}`);
  process.exit(1);
}

const email = process.env.DEVELOPMENT_LOGIN_EMAIL;
const code = process.env.DEVELOPMENT_LOGIN_ACCESS_CODE;
if (!email || !code) {
  console.error("DEVELOPMENT_LOGIN_EMAIL and DEVELOPMENT_LOGIN_ACCESS_CODE are required.");
  process.exit(1);
}

let cookie = "";
let version = 0;

function key(label) {
  return `seed-${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function call(path, { method = "GET", body, idempotency } = {}) {
  const headers = { origin: base, cookie };
  if (body) {
    headers["content-type"] = "application/json";
    headers["idempotency-key"] = key(idempotency ?? "op");
    headers["if-match"] = `"workspace:${version}"`;
  }
  const response = await fetch(base + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text.slice(0, 200) }; }
  const etag = response.headers.get("etag");
  const parsed = etag && /workspace:(\d+)/.exec(etag);
  if (parsed) version = Number(parsed[1]);
  else if (typeof payload?.meta?.workspaceVersion === "number") version = payload.meta.workspaceVersion;
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${JSON.stringify(payload?.error ?? payload)}`);
  }
  return payload;
}

const login = await fetch(base + "/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ email, accessCode: code }),
});
const loginCookies = login.headers.getSetCookie?.() ?? [];
if (!login.ok || !loginCookies.length) {
  console.error(`Sign-in failed: ${login.status} ${(await login.text()).slice(0, 200)}`);
  process.exit(1);
}
cookie = loginCookies.map((c) => c.split(";")[0]).join("; ");

const brief = await call("/api/workspaces/current/control/brief");
console.log(`signed in · workspace version ${version} · existing proposals ${brief?.data?.proposals?.length ?? 0}`);

if (!brief?.data?.policy) {
  await call("/api/workspaces/current/control/policy", {
    method: "PUT",
    idempotency: "policy",
    body: {
      categoryRules: [
        { category: "AI_MODEL", posture: "ALLOW" },
        { category: "CLOUD_INFRASTRUCTURE", posture: "ALLOW" },
        { category: "SOFTWARE", posture: "ALLOW" },
        { category: "CONTRACTOR", posture: "REVIEW" },
        { category: "CAMPAIGN", posture: "REVIEW" },
        { category: "OTHER", posture: "REVIEW" },
      ],
      currencyLimits: [{
        currency: "INR",
        maxPerChargeMinor: "40000000",
        maxThirteenWeekMinor: "300000000",
        maxAnnualMinor: "1200000000",
      }],
    },
  });
  console.log("policy recorded · INR per-charge limit 4,00,000");
}

// Mirrors the canonical desk: one crossing the limit, one needing review, one
// capped and waiting, one matched, one refused.
const desk = [
  { merchant: "Model API vendor", purpose: "One-month inference capacity before a customer launch", category: "AI_MODEL", amountMinor: "48000000", cadence: "ONE_TIME", firstChargeDate: "2026-09-10", decide: null },
  { merchant: "Cloud failover capacity", purpose: "Standby region for the launch window", category: "CLOUD_INFRASTRUCTURE", amountMinor: "24000000", cadence: "ONE_TIME", firstChargeDate: "2026-09-12", decide: null },
  { merchant: "Observability vendor", purpose: "Tracing retention for the pilot month", category: "SOFTWARE", amountMinor: "22000000", cadence: "MONTHLY", firstChargeDate: "2026-09-15", decide: { action: "APPROVE_WITH_CAP", approvedCapMinor: "20000000", overrideReason: "Launch window only; revisit before the next cycle." } },
  { merchant: "Security assessment firm", purpose: "Independent assessment and retest", category: "CONTRACTOR", amountMinor: "30000000", cadence: "ONE_TIME", firstChargeDate: "2026-09-18", decide: { action: "APPROVE" } },
  { merchant: "Launch campaign vendor", purpose: "Paid acquisition burst around the launch", category: "CAMPAIGN", amountMinor: "65000000", cadence: "ONE_TIME", firstChargeDate: "2026-09-20", decide: { action: "DECLINE", overrideReason: "No acquisition spend before the pilot proves the loop." } },
];

const existing = new Set((brief?.data?.proposals ?? []).map((entry) => entry.proposal?.merchant));
let created = 0;
for (const item of desk) {
  if (existing.has(item.merchant)) { console.log(`skip (exists) · ${item.merchant}`); continue; }
  const { decide, ...request } = item;
  const result = await call("/api/workspaces/current/control/proposals", {
    method: "POST",
    idempotency: "proposal",
    body: { ...request, currency: "INR", existingCommitmentIds: [] },
  });
  const proposalId = result?.data?.proposal?.id ?? result?.data?.id;
  created += 1;
  console.log(`proposal · ${item.merchant} · INR ${item.amountMinor}`);
  if (decide && proposalId) {
    await call(`/api/workspaces/current/control/proposals/${proposalId}/decision`, {
      method: "POST",
      idempotency: "decision",
      body: decide,
    });
    console.log(`   decision · ${decide.action}${decide.approvedCapMinor ? ` at ${decide.approvedCapMinor}` : ""}`);
  }
}

const after = await call("/api/workspaces/current/control/brief");
const proposals = after?.data?.proposals ?? [];
console.log(`\nseeded ${created} proposal(s) · desk now holds ${proposals.length}`);
console.log(`awaiting a human decision: ${proposals.filter((p) => p.evaluation && !p.decision).length}`);
