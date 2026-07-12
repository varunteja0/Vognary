import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  deleteAuditSnapshots,
  getLatestAuditSnapshot,
  saveAuditSnapshot,
} from "../../src/lib/server/audit-snapshot-store";
import { getDatabasePool } from "../../src/lib/server/database";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test("workspace state is encrypted, revisioned, conflict-safe, and deletable", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previousKey = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = "33".repeat(32);
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const pool = getDatabasePool();

  try {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, `${userId}@state.test`]);
    await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'State test')`, [workspaceId, userId]);
    await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);

    const firstSnapshot = { version: 1, statementSources: [], manualItems: [manualItem(100)] };
    const first = await saveAuditSnapshot({
      workspaceId,
      userId,
      title: "State",
      summary: summary(1),
      snapshot: firstSnapshot,
      expectedRevision: null,
    });
    assert.equal(first.status, "saved");
    assert.equal(first.revision, 1);
    assert.equal(first.materialized.commitmentsWritten, 1);
    const firstRecurring = await pool.query<{ id: string }>(
      `select id from recurring_items where workspace_id = $1 and external_reference like 'workspace-state:%'`,
      [workspaceId],
    );
    const recurringItemId = firstRecurring.rows[0]?.id;
    assert.ok(recurringItemId);

    const stale = await saveAuditSnapshot({
      workspaceId,
      userId,
      title: "Stale",
      summary: summary(2),
      snapshot: { version: 1, statementSources: [], manualItems: [manualItem(999)] },
      expectedRevision: null,
    });
    assert.deepEqual(stale, { status: "conflict", currentRevision: 1 });

    const secondSnapshot = { version: 1, statementSources: [], manualItems: [manualItem(120)] };
    const second = await saveAuditSnapshot({
      workspaceId,
      userId,
      title: "State",
      summary: summary(2),
      snapshot: secondSnapshot,
      expectedRevision: 1,
    });
    assert.equal(second.status, "saved");
    assert.equal(second.revision, 2);
    const updatedRecurring = await pool.query<{ id: string; average_amount: string }>(
      `select id, average_amount::text
       from recurring_items
       where workspace_id = $1 and external_reference like 'workspace-state:%'`,
      [workspaceId],
    );
    assert.deepEqual(updatedRecurring.rows[0], { id: recurringItemId, average_amount: "120.00" });

    const raw = await pool.query<{ encrypted_snapshot: Record<string, unknown> }>(
      `select encrypted_snapshot from workspace_states where workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(JSON.stringify(raw.rows[0]?.encrypted_snapshot).includes("State Plan"), false);

    const loaded = await getLatestAuditSnapshot(workspaceId);
    assert.equal(loaded?.revision, 2);
    assert.deepEqual(loaded?.snapshot, secondSnapshot);
    assert.equal(await deleteAuditSnapshots({ workspaceId, userId }), 1);
    assert.equal(await getLatestAuditSnapshot(workspaceId), null);
    const remaining = await pool.query<{ count: string }>(
      `select (
         (select count(*) from recurring_items where workspace_id = $1 and external_reference like 'workspace-state:%')
         + (select count(*) from transactions where workspace_id = $1 and external_reference like 'workspace-state:%')
         + (select count(*) from data_sources where workspace_id = $1 and external_reference like 'workspace-state:%')
       )::text as count`,
      [workspaceId],
    );
    assert.equal(remaining.rows[0]?.count, "0");
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
    if (previousKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = previousKey;
  }
});

test("concurrent first workspace saves cannot both claim revision one", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previousKey = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = "44".repeat(32);
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const pool = getDatabasePool();

  try {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, `${userId}@state-race.test`]);
    await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'State race test')`, [workspaceId, userId]);
    await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);

    const results = await Promise.all([
      saveAuditSnapshot({ workspaceId, userId, title: "First A", summary: summary(1), snapshot: { version: 1, statementSources: [], manualItems: [manualItem(100)] }, expectedRevision: null }),
      saveAuditSnapshot({ workspaceId, userId, title: "First B", summary: summary(1), snapshot: { version: 1, statementSources: [], manualItems: [manualItem(200)] }, expectedRevision: null }),
    ]);
    assert.equal(results.filter((result) => result.status === "saved").length, 1);
    assert.equal(results.filter((result) => result.status === "conflict").length, 1);
    assert.equal((await getLatestAuditSnapshot(workspaceId))?.revision, 1);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
    if (previousKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = previousKey;
  }
});

function summary(recurringCount: number) {
  return {
    recurringCount,
    monthlyRecurringSpend: 100,
    annualRecurringSpend: 1200,
    reviewableMonthlySpend: 100,
    sourceCount: 1,
    manualCount: 1,
  };
}

function manualItem(amount: number) {
  return {
    id: "state-plan",
    merchant: "State Plan",
    amount,
    currency: "INR",
    frequency: "monthly",
    nextExpectedDate: "2026-08-11",
    category: "Productivity",
    sourceName: "Workspace state test",
  };
}