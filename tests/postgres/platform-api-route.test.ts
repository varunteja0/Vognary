import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { GET as getPlatformLedger } from "../../src/app/api/v1/ledger/route";
import { getDatabasePool } from "../../src/lib/server/database";
import { createPlatformApiToken } from "../../src/lib/server/platform-api-token-store";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test("platform ledger route paginates every canonical item with a scoped token", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();

  try {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, `${userId}@platform-route.test`]);
    await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Platform route test')`, [workspaceId, userId]);
    await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);
    await pool.query(
      `insert into recurring_items (
         workspace_id, external_reference, merchant, normalized_merchant, category,
         frequency, currency, amount_min, amount_max, average_amount, monthly_cost,
         annual_cost, last_charge_date, next_expected_date, confidence_score, status,
         recommendation_reason, risk_tags
       )
       select $1,
              'workspace-state:route-' || sequence::text,
              'Route Plan ' || sequence::text,
              'route plan ' || sequence::text,
              'Productivity', 'monthly', 'INR', sequence, sequence, sequence,
              sequence, sequence * 12, date '2026-07-01', date '2026-08-01',
              80, 'watch', 'Platform route fixture', array['integration-test']
       from generate_series(1, 205) as sequence`,
      [workspaceId],
    );
    const issued = await createPlatformApiToken({
      workspaceId,
      userId,
      name: "Route integration token",
      scopes: ["ledger:read"],
      expiresInDays: 1,
    });

    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url = new URL("https://vognary.test/api/v1/ledger");
      url.searchParams.set("limit", "50");
      if (cursor) url.searchParams.set("cursor", cursor);
      const response = await getPlatformLedger(new Request(url, {
        headers: { authorization: `Bearer ${issued.token}` },
      }));
      assert.equal(response.status, 200);
      assert.ok(response.headers.get("x-request-id"));
      const body = await response.json();
      ids.push(...body.data.recurringItems.map((item: { id: string }) => item.id));
      cursor = body.page.nextCursor;
      pages += 1;
      assert.equal(JSON.stringify(body).includes(issued.token), false);
    } while (cursor);

    assert.equal(pages, 5);
    assert.equal(ids.length, 205);
    assert.equal(new Set(ids).size, 205);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
  }
});
