import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { recordConsentGrant } from "../../src/lib/server/consent-store";
import { listWorkspaceConnectedAccounts } from "../../src/lib/server/connected-account-store";
import { getDatabasePool } from "../../src/lib/server/database";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test("source freshness follows its own next scheduled run", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const sourceId = randomUUID();
  const accountId = randomUUID();

  try {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, `${userId}@freshness.test`]);
    await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Freshness test')`, [workspaceId, userId]);
    await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);
    const consent = await recordConsentGrant({
      workspaceId,
      userId,
      subjectEmail: `${userId}@freshness.test`,
      resourceKey: `connector:gmail-readonly:${accountId}`,
      purpose: "gmail-readonly-sync",
      noticeVersion: "privacy-2026-07-11",
      source: "source-freshness-test",
      scopes: ["gmail.readonly"],
    });
    await pool.query(
      `insert into data_sources (
         id, workspace_id, kind, provider, display_name, freshness_status,
         last_synced_at, coverage_start_at, coverage_end_at
       ) values ($1, $2, 'gmail_receipt', 'gmail', 'Freshness Gmail', 'fresh',
                 now(), now() - interval '30 days', now())`,
      [sourceId, workspaceId],
    );
    await pool.query(
      `insert into connected_accounts (
         id, workspace_id, source_id, consent_grant_id, connector_id, auth_type,
         provider_account_id, display_name, scopes
       ) values ($1, $2, $3, $4, 'gmail-readonly', 'oauth', $5, 'Freshness Gmail', array['gmail.readonly'])`,
      [accountId, workspaceId, sourceId, consent.id, `freshness-${accountId}`],
    );
    await pool.query(
      `insert into connector_sync_jobs (
         workspace_id, connected_account_id, connector_id, job_type, status, next_run_at
       ) values ($1, $2, 'gmail-readonly', 'incremental_sync', 'queued', now() + interval '45 minutes')`,
      [workspaceId, accountId],
    );

    assert.equal((await listWorkspaceConnectedAccounts(workspaceId))[0]?.freshnessStatus, "fresh");
    await pool.query(
      `update connector_sync_jobs set next_run_at = now() - interval '16 minutes' where connected_account_id = $1`,
      [accountId],
    );
    assert.equal((await listWorkspaceConnectedAccounts(workspaceId))[0]?.freshnessStatus, "stale");
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from consent_grants where user_id = $1`, [userId]);
    await pool.query(`delete from users where id = $1`, [userId]);
  }
});