import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { POST as receiveConnectorWebhook } from "../src/app/api/connectors/[id]/webhook/route";
import { ConnectorReauthorizationRequiredError } from "../src/lib/connector-errors";
import { revokeConnectorCredentialAtProviderWithDependencies } from "../src/lib/connector-provider-revocation";

const root = fileURLToPath(new URL("../", import.meta.url));

test("reauthorization errors are typed, non-retryable, and client-safe", () => {
  const error = new ConnectorReauthorizationRequiredError("gmail");
  assert.equal(error.name, "ConnectorReauthorizationRequiredError");
  assert.equal(error.code, "connector_reauthorization_required");
  assert.equal(error.retryable, false);
  assert.match(error.message, /Reconnect/);
});

test("Google revocation prefers the refresh token and reports confirmed revocation", async () => {
  const secret = "refresh-token-that-must-not-be-returned";
  const tokenKinds: string[] = [];
  const outcome = await revokeConnectorCredentialAtProviderWithDependencies({
    connectedAccountId: "00000000-0000-4000-8000-000000000001",
    connectorId: "gmail-readonly",
  }, {
    loadSecret: async (_accountId, tokenKind) => {
      tokenKinds.push(tokenKind);
      return tokenKind === "refresh" ? secret : null;
    },
    fetchImpl: (async (input, init) => {
      assert.equal(String(input), "https://oauth2.googleapis.com/revoke");
      assert.equal(init?.method, "POST");
      assert.equal((init?.headers as Record<string, string>)["content-type"], "application/x-www-form-urlencoded");
      assert.equal((init?.body as URLSearchParams).get("token"), secret);
      assert.ok(init?.signal, "provider calls must have a bounded timeout signal");
      return new Response(null, { status: 200 });
    }) as typeof fetch,
  });

  assert.deepEqual(tokenKinds, ["refresh"]);
  assert.deepEqual(outcome, {
    provider: "google",
    status: "revoked",
    attempted: true,
    remoteCredentialMayRemainActive: false,
    message: "Google confirmed provider-side credential revocation.",
  });
  assert.equal(JSON.stringify(outcome).includes(secret), false);
});

test("provider failure remains honest and never blocks the local-disconnect path", async () => {
  const unreachable = await revokeConnectorCredentialAtProviderWithDependencies({
    connectedAccountId: "00000000-0000-4000-8000-000000000001",
    connectorId: "gmail-readonly",
  }, {
    loadSecret: async () => "google-token",
    fetchImpl: (async () => {
      throw new Error("network detail must not escape");
    }) as typeof fetch,
  });
  assert.equal(unreachable.status, "unreachable");
  assert.equal(unreachable.remoteCredentialMayRemainActive, true);
  assert.doesNotMatch(unreachable.message, /network detail|google-token/);

  const rejected = await revokeConnectorCredentialAtProviderWithDependencies({
    connectedAccountId: "00000000-0000-4000-8000-000000000001",
    connectorId: "gmail-readonly",
  }, {
    loadSecret: async () => "google-token",
    fetchImpl: (async () => new Response("PROVIDER_BODY_MUST_NOT_ESCAPE", { status: 400 })) as typeof fetch,
  });
  assert.equal(rejected.status, "not_confirmed");
  assert.equal(rejected.remoteCredentialMayRemainActive, true);
  assert.doesNotMatch(rejected.message, /PROVIDER_BODY|google-token/);
});

test("API-key disconnects explicitly require provider-side rotation", async () => {
  let secretRead = false;
  const outcome = await revokeConnectorCredentialAtProviderWithDependencies({
    connectedAccountId: "00000000-0000-4000-8000-000000000001",
    connectorId: "openai-costs",
  }, {
    loadSecret: async () => {
      secretRead = true;
      return "api-key";
    },
    fetchImpl: fetch,
  });

  assert.equal(secretRead, false);
  assert.equal(outcome.status, "manual_action_required");
  assert.equal(outcome.attempted, false);
  assert.equal(outcome.remoteCredentialMayRemainActive, true);
  assert.match(outcome.message, /revoke or rotate/i);
});

test("signed connector webhooks fail closed when durable storage is unavailable", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousSecret = process.env.CONNECTOR_WEBHOOK_SECRET_OPENAI_COSTS;
  const secret = "connector-webhook-test-secret";
  const rawBody = JSON.stringify({ id: "evt_test", type: "cost.updated" });
  process.env.CONNECTOR_WEBHOOK_SECRET_OPENAI_COSTS = secret;
  delete process.env.DATABASE_URL;

  try {
    const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
    const response = await receiveConnectorWebhook(new Request("https://vognary.test/api/connectors/openai-costs/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-vognary-signature": signature,
      },
      body: rawBody,
    }), { params: Promise.resolve({ id: "openai-costs" }) });

    assert.equal(response.status, 501);
    assert.deepEqual(await response.json(), {
      status: "not-configured",
      connectorId: "openai-costs",
      requiredEnv: ["DATABASE_URL"],
      message: "Durable webhook storage is not configured. The event was not accepted.",
    });
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousSecret === undefined) delete process.env.CONNECTOR_WEBHOOK_SECRET_OPENAI_COSTS;
    else process.env.CONNECTOR_WEBHOOK_SECRET_OPENAI_COSTS = previousSecret;
  }
});

test("sync and disconnect SQL enforce terminal lifecycle states and erase local token material", () => {
  const syncStore = source("src/lib/server/sync-job-store.ts");
  assert.match(syncStore, /error_code = 'connector_reauthorization_required'/);
  assert.match(syncStore, /set status = 'needs_reauth'/);
  assert.match(syncStore, /next_run_at = null/);
  assert.match(syncStore, /target_job\.status in \('queued', 'running', 'failed', 'paused'\)/);

  const accountStore = source("src/lib/server/connected-account-store.ts");
  assert.match(accountStore, /encrypted_payload = '\{\}'::jsonb/);
  assert.match(accountStore, /secret_ref = 'deleted'/);
  assert.match(accountStore, /key_fingerprint = null/);
  assert.match(accountStore, /where connected_account_id = \$1\n\s+and status in \('queued', 'running', 'failed', 'paused'\)/);
});

test("scheduled sync uses the shared timing-safe cron guard", () => {
  const route = source("src/app/api/internal/sync-jobs/due/run/route.ts");
  assert.match(route, /import \{ requireCronSecret, requireInternalSecret \} from "@\/lib\/server\/internal-auth"/);
  assert.doesNotMatch(route, /function requireCronSecret\(/);
});

test("disconnect preserves request-origin authorization and revokes provider before local state", () => {
  const route = source("src/app/api/workspaces/current/connectors/[accountId]/route.ts");
  const guardIndex = route.indexOf("rejectCrossSiteMutation(request)");
  const providerIndex = route.indexOf("revokeConnectorCredentialAtProvider({");
  const localIndex = route.indexOf("revokeWorkspaceConnectedAccount(session.workspaceId, accountId)");

  assert.ok(guardIndex >= 0);
  assert.ok(providerIndex > guardIndex);
  assert.ok(localIndex > providerIndex);
  assert.match(route, /localCredentialsDeleted: true/);

  const runner = source("src/lib/server/connector-sync-runner.ts");
  assert.match(runner, /markConnectorReauthorizationRequired/);
  assert.match(runner, /status: "needs_reauth" as const/);

  const manualSyncRoute = source("src/app/api/workspaces/current/connectors/[accountId]/sync/route.ts");
  assert.match(manualSyncRoute, /account\.status === "needs_reauth"/);
  assert.match(manualSyncRoute, /status: 409/);
});

test("account deletion attempts provider revocation before deleting owned workspace data", () => {
  const route = source("src/app/api/profile/route.ts");
  const providerIndex = route.indexOf("revokeConnectorCredentialAtProvider({");
  const deletionIndex = route.indexOf("deleteUserData(session.userId, session.email)");
  assert.ok(providerIndex >= 0);
  assert.ok(deletionIndex > providerIndex);
  assert.match(route, /providerFollowUpRequired/);
  assert.match(route, /does not enforce automatic backup expiry or selective erasure/);
  assert.doesNotMatch(route, /backup copies expire according to the active backup retention policy/i);
});

function source(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}
