import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { normalizeConnectorSyncResult } from "../../src/lib/connector-evidence-normalizer";
import type { ConnectorEvidence } from "../../src/lib/connector-runtime";
import { getDatabasePool } from "../../src/lib/server/database";
import { recordConsentGrant } from "../../src/lib/server/consent-store";
import { materializeConnectorBatch } from "../../src/lib/server/living-ledger-store";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test("connector cadence and merchant corrections preserve one canonical commitment", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const connectedAccountId = randomUUID();
  const connectorId = "gmail-readonly";

  try {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, `${userId}@integration.test`]);
    await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Ledger identity test')`, [workspaceId, userId]);
    await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);
    const consent = await recordConsentGrant({
      workspaceId,
      userId,
      subjectEmail: `${userId}@integration.test`,
      resourceKey: `connector:${connectorId}:${connectedAccountId}`,
      purpose: "gmail-readonly-sync",
      noticeVersion: "privacy-2026-07-11",
      source: "postgres-integration-test",
      scopes: ["gmail.readonly"],
    });
    await pool.query(
      `insert into connected_accounts (id, workspace_id, consent_grant_id, connector_id, auth_type, provider_account_id, display_name, scopes)
       values ($1, $2, $3, $4, 'oauth', $5, 'Test Gmail', array['gmail.readonly'])`,
      [connectedAccountId, workspaceId, consent.id, connectorId, `integration-${connectedAccountId}`],
    );

    const first = receiptEvidence({ externalId: "charge-1", cadenceHint: "monthly" });
    await materialize(workspaceId, connectedAccountId, connectorId, first, "2026-05-01T00:00:00.000Z");

    const cadenceCorrection = receiptEvidence({
      externalId: "charge-2",
      observedAt: "2026-06-01T00:00:00.000Z",
      cadenceHint: "yearly",
    });
    await materialize(workspaceId, connectedAccountId, connectorId, cadenceCorrection, "2026-06-01T00:00:00.000Z");

    const merchantCorrection = receiptEvidence({
      externalId: "charge-2",
      observedAt: "2026-06-02T00:00:00.000Z",
      merchantRaw: "OpenAI ChatGPT Plus",
      cadenceHint: "yearly",
    });
    await materialize(workspaceId, connectedAccountId, connectorId, merchantCorrection, "2026-06-02T00:00:00.000Z");

    const commitments = await pool.query<{
      id: string;
      merchant: string;
      frequency: string;
    }>(
      `select id, merchant, frequency from recurring_items where workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(commitments.rowCount, 1);
    assert.equal(commitments.rows[0]?.merchant, "OpenAI ChatGPT Plus");
    assert.equal(commitments.rows[0]?.frequency, "yearly");

    const evidence = await pool.query<{ recurring_item_id: string | null }>(
      `select recurring_item_id from connector_evidence where workspace_id = $1 order by external_id`,
      [workspaceId],
    );
    assert.equal(evidence.rowCount, 2);
    assert.deepEqual(new Set(evidence.rows.map((row) => row.recurring_item_id)), new Set([commitments.rows[0]?.id]));

    const links = await pool.query<{ count: string }>(
      `select count(*)::text as count from evidence_links where recurring_item_id = $1`,
      [commitments.rows[0]?.id],
    );
    assert.equal(links.rows[0]?.count, "2");
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from consent_grants where user_id = $1`, [userId]);
    await pool.query(`delete from users where id = $1`, [userId]);
  }
});

function receiptEvidence(overrides: Partial<ConnectorEvidence>): ConnectorEvidence {
  return {
    connectorId: "gmail-readonly",
    externalId: "charge-1",
    provider: "gmail",
    observedAt: "2026-05-01T00:00:00.000Z",
    evidenceType: "receipt",
    merchantRaw: "OpenAI Plus",
    amount: 20,
    currency: "USD",
    category: "AI tools",
    cadenceHint: "monthly",
    confidence: 90,
    ...overrides,
  };
}

async function materialize(
  workspaceId: string,
  connectedAccountId: string,
  connectorId: string,
  evidence: ConnectorEvidence,
  startedAt: string,
) {
  const syncRun = await getDatabasePool().query<{ id: string }>(
    `insert into connector_sync_runs (workspace_id, connected_account_id, connector_id)
     values ($1, $2, $3)
     returning id`,
    [workspaceId, connectedAccountId, connectorId],
  );
  const syncRunId = syncRun.rows[0]?.id;
  assert.ok(syncRunId);

  return materializeConnectorBatch({
    workspaceId,
    connectedAccountId,
    connectorId,
    syncRunId,
    batch: normalizeConnectorSyncResult([evidence], {
      connectorId,
      syncMode: "polling",
      startedAt,
    }),
  });
}