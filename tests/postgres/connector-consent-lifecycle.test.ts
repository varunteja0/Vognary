import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildConnectorConsentResourceKey } from "../../src/lib/consent";
import { revokeWorkspaceConnectedAccount } from "../../src/lib/server/connected-account-store";
import { recordConsentGrant } from "../../src/lib/server/consent-store";
import {
  activateConnectedAccount,
  buildStoredConnectorConnection,
  storeConnectorSecret,
  upsertConnectedAccount,
} from "../../src/lib/server/connector-token-store";
import { getDatabasePool } from "../../src/lib/server/database";
import { createConnectorSyncJob } from "../../src/lib/server/sync-job-store";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test("connector setup commits atomically and disconnect revokes every local capability", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previousKey = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = "11".repeat(32);
  const fixture = await createWorkspaceFixture();
  const providerAccountId = `org-${randomUUID()}`;
  const client = await getDatabasePool().connect();

  try {
    await client.query("begin");
    const consent = await recordConsentGrant({
      workspaceId: fixture.workspaceId,
      userId: fixture.userId,
      subjectEmail: fixture.email,
      resourceKey: buildConnectorConsentResourceKey("openai-costs", providerAccountId),
      purpose: "provider-connector-sync",
      noticeVersion: "privacy-2026-07-11",
      source: "postgres-integration-test",
      scopes: ["organization costs"],
    }, client);
    const account = await upsertConnectedAccount({
      workspaceId: fixture.workspaceId,
      consentGrantId: consent.id,
      connectorId: "openai-costs",
      authType: "api-key",
      providerAccountId,
      displayName: "OpenAI integration test",
      scopes: ["organization costs"],
    }, client);
    await storeConnectorSecret({
      connectedAccountId: account.id,
      tokenKind: "api_key",
      secret: "sk-integration-secret",
      scopes: ["organization costs"],
    }, client);
    await createConnectorSyncJob({
      workspaceId: fixture.workspaceId,
      connectedAccountId: account.id,
      connectorId: "openai-costs",
      jobType: "initial_sync",
    }, client);
    await client.query("commit");

    const connection = await buildStoredConnectorConnection({
      workspaceId: fixture.workspaceId,
      connectedAccountId: account.id,
      connectorId: "openai-costs",
    });
    assert.equal(connection?.apiKey, "sk-integration-secret");

    const revoked = await revokeWorkspaceConnectedAccount(fixture.workspaceId, account.id);
    assert.equal(revoked.revoked, true);
    assert.equal(revoked.tokenRefsRevoked, 1);
    assert.equal(revoked.syncJobsBlocked, 1);
    assert.equal(revoked.consentGrantsWithdrawn, 1);

    const state = await getDatabasePool().query<{
      account_status: string;
      consent_withdrawn: boolean;
      token_status: string;
      token_payload: Record<string, unknown>;
      job_status: string;
    }>(
      `select account.status as account_status,
              consent.withdrawn_at is not null as consent_withdrawn,
              token.status::text as token_status,
              token.encrypted_payload as token_payload,
              job.status::text as job_status
       from connected_accounts account
       join consent_grants consent on consent.id = account.consent_grant_id
       join connector_token_refs token on token.connected_account_id = account.id
       join connector_sync_jobs job on job.connected_account_id = account.id
       where account.id = $1`,
      [account.id],
    );
    assert.deepEqual(state.rows[0], {
      account_status: "revoked",
      consent_withdrawn: true,
      token_status: "revoked",
      token_payload: {},
      job_status: "blocked",
    });
    assert.equal(await buildStoredConnectorConnection({
      workspaceId: fixture.workspaceId,
      connectedAccountId: account.id,
      connectorId: "openai-costs",
    }), null);
  } finally {
    client.release();
    await deleteWorkspaceFixture(fixture);
    restoreEnvironment("TOKEN_ENCRYPTION_KEY", previousKey);
  }
});

test("rolling back connector setup leaves no grant, account, token, or job", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previousKey = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = "22".repeat(32);
  const fixture = await createWorkspaceFixture();
  const client = await getDatabasePool().connect();

  try {
    await client.query("begin");
    const consent = await recordConsentGrant({
      workspaceId: fixture.workspaceId,
      userId: fixture.userId,
      subjectEmail: fixture.email,
      resourceKey: buildConnectorConsentResourceKey("openai-costs", "rollback-test"),
      purpose: "provider-connector-sync",
      noticeVersion: "privacy-2026-07-11",
      source: "postgres-rollback-test",
      scopes: ["organization costs"],
    }, client);
    const account = await upsertConnectedAccount({
      workspaceId: fixture.workspaceId,
      consentGrantId: consent.id,
      connectorId: "openai-costs",
      authType: "api-key",
      providerAccountId: "rollback-test",
      displayName: "Rollback test",
    }, client);
    await storeConnectorSecret({
      connectedAccountId: account.id,
      tokenKind: "api_key",
      secret: "sk-rollback-secret",
    }, client);
    await createConnectorSyncJob({
      workspaceId: fixture.workspaceId,
      connectedAccountId: account.id,
      connectorId: "openai-costs",
      jobType: "initial_sync",
    }, client);
    await client.query("rollback");

    const residual = await getDatabasePool().query<{ count: string }>(
      `select (
         (select count(*) from consent_grants where workspace_id = $1)
         + (select count(*) from connected_accounts where workspace_id = $1)
         + (select count(*) from connector_sync_jobs where workspace_id = $1)
       )::text as count`,
      [fixture.workspaceId],
    );
    assert.equal(residual.rows[0]?.count, "0");
  } finally {
    client.release();
    await deleteWorkspaceFixture(fixture);
    restoreEnvironment("TOKEN_ENCRYPTION_KEY", previousKey);
  }
});

test("provider consent stays pending until an observed approval activates it", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const fixture = await createWorkspaceFixture();
  try {
    const consent = await recordConsentGrant({
      workspaceId: fixture.workspaceId,
      userId: fixture.userId,
      subjectEmail: fixture.email,
      resourceKey: buildConnectorConsentResourceKey("account-aggregator", "consent-pending-test"),
      purpose: "provider-connector-sync",
      noticeVersion: "privacy-2026-07-11",
      source: "postgres-pending-consent-test",
      scopes: ["aa:consent", "aa:fi-data:deposit"],
    });
    const account = await upsertConnectedAccount({
      workspaceId: fixture.workspaceId,
      consentGrantId: consent.id,
      connectorId: "account-aggregator",
      authType: "partner-api",
      providerAccountId: "consent-pending-test",
      displayName: "Pending AA consent",
      scopes: ["aa:consent", "aa:fi-data:deposit"],
      status: "pending",
    });
    assert.equal(account.status, "pending");

    const resumable = await buildStoredConnectorConnection({
      workspaceId: fixture.workspaceId,
      connectedAccountId: account.id,
      connectorId: "account-aggregator",
    });
    assert.equal(resumable?.providerAccountId, "consent-pending-test", "the worker must be able to poll pending consent");

    await activateConnectedAccount({
      workspaceId: fixture.workspaceId,
      connectedAccountId: account.id,
      connectorId: "account-aggregator",
    });
    const state = await getDatabasePool().query<{ status: string }>(
      `select status from connected_accounts where id = $1`,
      [account.id],
    );
    assert.equal(state.rows[0]?.status, "active");
  } finally {
    await deleteWorkspaceFixture(fixture);
  }
});

async function createWorkspaceFixture() {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const email = `${userId}@connector.test`;
  const pool = getDatabasePool();
  await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, email]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Connector test')`, [workspaceId, userId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);
  return { userId, workspaceId, email };
}

async function deleteWorkspaceFixture(fixture: { userId: string; workspaceId: string }) {
  const pool = getDatabasePool();
  await pool.query(`delete from workspaces where id = $1`, [fixture.workspaceId]);
  await pool.query(`delete from consent_grants where user_id = $1`, [fixture.userId]);
  await pool.query(`delete from users where id = $1`, [fixture.userId]);
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
