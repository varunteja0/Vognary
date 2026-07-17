import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST as auditPost } from "../src/app/api/audit/route";
import { DELETE as profileDelete } from "../src/app/api/profile/route";
import { rejectCrossSiteMutation } from "../src/lib/server/request-security";

const root = fileURLToPath(new URL("../", import.meta.url));

const guardedMutationRoutes: Array<[string, number]> = [
  ["src/app/api/audit-intake/route.ts", 1],
  ["src/app/api/audit-packs/sign/route.ts", 1],
  ["src/app/api/audit/route.ts", 1],
  ["src/app/api/auth/login/route.ts", 1],
  ["src/app/api/auth/logout/route.ts", 1],
  ["src/app/api/auth/magic-link/request/route.ts", 1],
  ["src/app/api/checkout/route.ts", 1],
  ["src/app/api/connectors/[id]/start/route.ts", 1],
  ["src/app/api/connectors/[id]/sync/route.ts", 1],
  ["src/app/api/ingest/route.ts", 1],
  ["src/app/api/privacy/consents/route.ts", 2],
  ["src/app/api/privacy/requests/[id]/download/route.ts", 1],
  ["src/app/api/privacy/requests/route.ts", 1],
  ["src/app/api/privacy/retention-policy/route.ts", 1],
  ["src/app/api/product-events/route.ts", 1],
  ["src/app/api/profile/route.ts", 1],
  ["src/app/api/platform/tokens/route.ts", 2],
  ["src/app/api/renewal-alerts/preferences/route.ts", 1],
  ["src/app/api/waitlist/route.ts", 1],
  ["src/app/api/workspaces/current/audit-snapshot/route.ts", 2],
  ["src/app/api/workspaces/current/route.ts", 1],
  ["src/app/api/workspaces/current/actions/route.ts", 1],
  ["src/app/api/workspaces/current/actions/[caseId]/authorize/route.ts", 1],
  ["src/app/api/workspaces/current/actions/[caseId]/route.ts", 1],
  ["src/app/api/workspaces/current/ask/route.ts", 1],
  ["src/app/api/workspaces/current/decisions/route.ts", 1],
  ["src/app/api/workspaces/current/connectors/[accountId]/route.ts", 1],
  ["src/app/api/workspaces/current/connectors/[accountId]/sync/route.ts", 1],
  ["src/app/api/workspaces/route.ts", 1],
];

const mutationExceptions = [
  "src/app/api/billing/webhooks/razorpay/route.ts",
  "src/app/api/connectors/[id]/webhook/route.ts",
  "src/app/api/internal/monitoring/test/route.ts",
  "src/app/api/internal/action-cases/[caseId]/transition/route.ts",
  "src/app/api/internal/privacy/retention/run/route.ts",
  "src/app/api/internal/renewal-alerts/due/run/route.ts",
  "src/app/api/internal/savings-verification/due/run/route.ts",
  "src/app/api/internal/sync-jobs/[id]/run/route.ts",
  "src/app/api/internal/sync-jobs/due/run/route.ts",
  "src/app/api/internal/sync-jobs/route.ts",
];

const callbackExceptions = [
  "src/app/api/auth/google/callback/route.ts",
  "src/app/api/auth/magic-link/verify/route.ts",
  "src/app/api/integrations/gmail/callback/route.ts",
];

test("allows safe requests regardless of Origin", () => {
  const request = new Request("https://vognary.test/api/profile", {
    headers: { origin: "https://attacker.test", "sec-fetch-site": "cross-site" },
  });
  assert.equal(rejectCrossSiteMutation(request), null);
});

test("allows a same-origin mutation", () => {
  const request = new Request("https://vognary.test/api/profile", {
    method: "DELETE",
    headers: { origin: "https://vognary.test", "sec-fetch-site": "same-origin" },
  });
  assert.equal(rejectCrossSiteMutation(request), null);
});

test("allows a browser origin that matches Host when the framework normalizes Request.url", () => {
  const request = new Request("http://localhost:3000/api/profile", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(rejectCrossSiteMutation(request), null);
});

test("rejects a cross-site mutation", async () => {
  const request = new Request("https://vognary.test/api/profile", {
    method: "DELETE",
    headers: { origin: "https://attacker.test", "sec-fetch-site": "cross-site" },
  });
  const response = rejectCrossSiteMutation(request);
  assert.equal(response?.status, 403);
  assert.equal((await response?.json()).code, "cross_site_request");
});

test("rejects mismatched origins even without Fetch Metadata", () => {
  const request = new Request("https://vognary.test/api/profile", {
    method: "POST",
    headers: { origin: "https://attacker.test" },
  });
  assert.equal(rejectCrossSiteMutation(request)?.status, 403);
});

test("allows configured canonical origin behind a deployment proxy", () => {
  const previous = process.env.APP_URL;
  process.env.APP_URL = "https://www.vognary.com";
  try {
    const request = new Request("https://internal-deployment.test/api/profile", {
      method: "POST",
      headers: { origin: "https://www.vognary.com", "sec-fetch-site": "same-origin" },
    });
    assert.equal(rejectCrossSiteMutation(request), null);
  } finally {
    if (previous === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  }
});

test("browser-facing mutation route inventory is exhaustively guarded", () => {
  const expectedMutationRoutes = [...guardedMutationRoutes.map(([route]) => route), ...mutationExceptions].sort();
  assert.deepEqual(findMutationRoutes(), expectedMutationRoutes, "every new mutation route needs an explicit CSRF decision");

  for (const [route, expectedCalls] of guardedMutationRoutes) {
    const source = readRoute(route);
    assert.match(source, /from ["']@\/lib\/server\/request-security["']/, `${route} must import the shared guard`);
    assert.equal(count(source, "rejectCrossSiteMutation(request);"), expectedCalls, `${route} must guard every mutation handler`);
  }
});

test("provider callbacks, webhooks, and internal-secret workers stay explicit CSRF exceptions", () => {
  for (const route of [...mutationExceptions, ...callbackExceptions]) {
    assert.doesNotMatch(readRoute(route), /rejectCrossSiteMutation/, `${route} is a legitimate non-browser callback/worker`);
  }
});

test("all guarded JSON handlers use bounded parsing", () => {
  const boundedJsonRoutes = [
    "src/app/api/audit-intake/route.ts",
    "src/app/api/audit-packs/sign/route.ts",
    "src/app/api/audit/route.ts",
    "src/app/api/auth/login/route.ts",
    "src/app/api/auth/magic-link/request/route.ts",
    "src/app/api/checkout/route.ts",
    "src/app/api/connectors/[id]/start/route.ts",
    "src/app/api/connectors/[id]/sync/route.ts",
    "src/app/api/privacy/consents/route.ts",
    "src/app/api/privacy/requests/route.ts",
    "src/app/api/privacy/retention-policy/route.ts",
    "src/app/api/product-events/route.ts",
    "src/app/api/profile/route.ts",
    "src/app/api/platform/tokens/route.ts",
    "src/app/api/renewal-alerts/preferences/route.ts",
    "src/app/api/waitlist/route.ts",
    "src/app/api/workspaces/current/audit-snapshot/route.ts",
    "src/app/api/workspaces/current/route.ts",
    "src/app/api/workspaces/current/actions/route.ts",
    "src/app/api/workspaces/current/actions/[caseId]/authorize/route.ts",
    "src/app/api/workspaces/current/actions/[caseId]/route.ts",
    "src/app/api/workspaces/current/ask/route.ts",
    "src/app/api/workspaces/current/decisions/route.ts",
    "src/app/api/workspaces/route.ts",
  ];

  for (const route of boundedJsonRoutes) {
    const source = readRoute(route);
    assert.match(source, /readLimitedJson/, `${route} must bound JSON bytes`);
    assert.doesNotMatch(source, /request\.json\s*\(/, `${route} must not bypass bounded parsing`);
  }
});

test("representative public and cookie-authenticated routes reject before parsing or auth", async () => {
  const crossSiteHeaders = {
    origin: "https://attacker.test",
    "sec-fetch-site": "cross-site",
    "content-type": "application/json",
  };
  const auditResponse = await auditPost(new NextRequest("https://vognary.test/api/audit", {
    method: "POST",
    headers: crossSiteHeaders,
    body: "not-json",
  }));
  assert.equal(auditResponse.status, 403);
  assert.equal((await auditResponse.json()).code, "cross_site_request");

  const profileResponse = await profileDelete(new NextRequest("https://vognary.test/api/profile", {
    method: "DELETE",
    headers: crossSiteHeaders,
    body: "not-json",
  }));
  assert.equal(profileResponse.status, 403);
  assert.equal((await profileResponse.json()).code, "cross_site_request");
});

function findMutationRoutes() {
  const apiRoot = path.join(root, "src/app/api");
  return walk(apiRoot)
    .filter((file) => file.endsWith("/route.ts"))
    .filter((file) => /export (?:async )?function (?:POST|PUT|PATCH|DELETE)\b/.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(root, file).split(path.sep).join("/"))
    .sort();
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function readRoute(route: string) {
  return readFileSync(path.join(root, route), "utf8");
}

function count(value: string, needle: string) {
  return value.split(needle).length - 1;
}
