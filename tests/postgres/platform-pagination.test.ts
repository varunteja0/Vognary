import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { listWorkspaceCommitmentDecisions } from "../../src/lib/server/commitment-decision-store";
import { listWorkspaceRecurringItems } from "../../src/lib/server/connected-account-store";
import { getDatabasePool } from "../../src/lib/server/database";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const pageSize = 50;

test("platform backing stores traverse commitments and decisions without truncation", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();

  try {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, `${userId}@pagination.test`]);
    await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Pagination test')`, [workspaceId, userId]);
    await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);
    await pool.query(
      `insert into recurring_items (
         workspace_id, external_reference, merchant, normalized_merchant, category,
         frequency, currency, amount_min, amount_max, average_amount, monthly_cost,
         annual_cost, last_charge_date, next_expected_date, confidence_score, status,
         recommendation_reason, risk_tags
       )
       select $1,
              'workspace-state:pagination-' || sequence::text,
              'Plan ' || sequence::text,
              'plan ' || sequence::text,
              'Productivity',
              'monthly',
              'INR',
              sequence,
              sequence,
              sequence,
              sequence,
              sequence * 12,
              date '2026-07-01',
              date '2026-08-01',
              80,
              'watch',
              'Pagination fixture',
              array['integration-test']
       from generate_series(1, 205) as sequence`,
      [workspaceId],
    );
    await pool.query(
      `insert into commitment_decisions (workspace_id, recurring_item_id, decided_by_user_id, action)
       select $1, id, $2, 'watch'
       from recurring_items
       where workspace_id = $1`,
      [workspaceId, userId],
    );

    const recurringIds = await collectPages(async (afterId) =>
      listWorkspaceRecurringItems(workspaceId, pageSize + 1, false, afterId, true));
    const decisionIds = await collectPages(async (afterId) =>
      listWorkspaceCommitmentDecisions(workspaceId, pageSize + 1, afterId, true));

    assert.equal(recurringIds.length, 205);
    assert.equal(new Set(recurringIds).size, 205);
    assert.equal(decisionIds.length, 205);
    assert.equal(new Set(decisionIds).size, 205);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
  }
});

async function collectPages(loader: (afterId: string | null) => Promise<Array<{ id: string }>>) {
  const ids: string[] = [];
  let afterId: string | null = null;

  while (true) {
    const rows = await loader(afterId);
    const page = rows.slice(0, pageSize);
    ids.push(...page.map((row) => row.id));
    if (rows.length <= pageSize) return ids;
    afterId = page.at(-1)?.id ?? null;
    assert.ok(afterId, "a non-terminal page must provide a cursor id");
  }
}
