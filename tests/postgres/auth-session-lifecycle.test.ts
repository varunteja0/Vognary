import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { getDatabasePool } from "../../src/lib/server/database";
import {
  createSessionCookie,
  readCurrentSession,
  revokeCurrentSession,
} from "../../src/lib/server/session";
import { getOrCreateDefaultWorkspaceForUser } from "../../src/lib/server/workspace-store";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test("concurrent first sign-ins create exactly one default workspace", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const userId = randomUUID();

  try {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, `${userId}@auth-race.test`]);
    const results = await Promise.all(Array.from({ length: 12 }, () => getOrCreateDefaultWorkspaceForUser({
      userId,
      workspaceName: "Concurrent auth workspace",
    })));

    assert.equal(new Set(results.map((result) => result.workspaceId)).size, 1);
    const workspaces = await pool.query<{ count: number }>(
      `select count(*)::int as count from workspaces where owner_user_id = $1`,
      [userId],
    );
    const memberships = await pool.query<{ count: number }>(
      `select count(*)::int as count from workspace_members where user_id = $1 and role = 'owner'`,
      [userId],
    );
    assert.equal(workspaces.rows[0]?.count, 1);
    assert.equal(memberships.rows[0]?.count, 1);
  } finally {
    await pool.query(`delete from workspaces where owner_user_id = $1`, [userId]);
    await pool.query(`delete from users where id = $1`, [userId]);
  }
});

test("logout revokes the current session while a later sign-in mints a valid new session", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const previousSecret = process.env.SESSION_SECRET;
  const userId = randomUUID();
  const workspaceId = randomUUID();
  process.env.SESSION_SECRET = "auth-session-lifecycle-test-secret";

  try {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, `${userId}@auth-session.test`]);
    await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Auth session test')`, [workspaceId, userId]);
    await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);

    const firstCookie = await createSessionCookie({ userId, workspaceId });
    const firstRequest = requestWithCookie(firstCookie);
    assert.equal((await readCurrentSession(firstRequest))?.workspaceId, workspaceId);
    assert.equal(await revokeCurrentSession(firstRequest), true);
    assert.equal(await readCurrentSession(firstRequest), null);

    const secondCookie = await createSessionCookie({ userId, workspaceId });
    const secondRequest = requestWithCookie(secondCookie);
    assert.equal((await readCurrentSession(secondRequest))?.workspaceId, workspaceId);
    assert.equal(await readCurrentSession(firstRequest), null);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

function requestWithCookie(cookie: Awaited<ReturnType<typeof createSessionCookie>>) {
  return new Request("https://vognary.test/app", {
    headers: { cookie: `${cookie.name}=${encodeURIComponent(cookie.value)}` },
  });
}