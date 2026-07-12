import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  hasActiveConsentGrant,
  recordConsentGrant,
  withdrawConsentGrant,
} from "../../src/lib/server/consent-store";
import { getDatabasePool } from "../../src/lib/server/database";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test("consent replacement and withdrawal stay isolated to one workspace", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const userId = randomUUID();
  const firstWorkspaceId = randomUUID();
  const secondWorkspaceId = randomUUID();
  const email = `${userId}@consent.test`;

  try {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, email]);
    await pool.query(
      `insert into workspaces (id, owner_user_id, name) values ($1, $3, 'First'), ($2, $3, 'Second')`,
      [firstWorkspaceId, secondWorkspaceId, userId],
    );
    await pool.query(
      `insert into workspace_members (workspace_id, user_id, role) values ($1, $3, 'owner'), ($2, $3, 'owner')`,
      [firstWorkspaceId, secondWorkspaceId, userId],
    );

    await recordConsentGrant(consentInput(firstWorkspaceId, userId, email, "first"));
    const replacement = await recordConsentGrant(consentInput(firstWorkspaceId, userId, email, "replacement"));
    await recordConsentGrant(consentInput(secondWorkspaceId, userId, email, "second-workspace"));

    const activeCounts = await pool.query<{ workspace_id: string; count: string }>(
      `select workspace_id::text, count(*)::text as count
       from consent_grants
       where user_id = $1 and purpose = 'product-analytics-opt-in' and withdrawn_at is null
       group by workspace_id`,
      [userId],
    );
    assert.deepEqual(new Map(activeCounts.rows.map((row) => [row.workspace_id, row.count])), new Map([
      [firstWorkspaceId, "1"],
      [secondWorkspaceId, "1"],
    ]));

    assert.equal(await hasActiveConsentGrant({
      userId,
      email,
      workspaceId: firstWorkspaceId,
      purpose: "product-analytics-opt-in",
    }), true);
    assert.equal(await hasActiveConsentGrant({
      userId,
      email,
      workspaceId: secondWorkspaceId,
      purpose: "product-analytics-opt-in",
    }), true);

    assert.equal(await withdrawConsentGrant({
      id: replacement.id,
      userId,
      email,
      workspaceId: firstWorkspaceId,
    }), true);
    assert.equal(await hasActiveConsentGrant({
      userId,
      email,
      workspaceId: firstWorkspaceId,
      purpose: "product-analytics-opt-in",
    }), false);
    assert.equal(await hasActiveConsentGrant({
      userId,
      email,
      workspaceId: secondWorkspaceId,
      purpose: "product-analytics-opt-in",
    }), true);
  } finally {
    await pool.query(`delete from consent_grants where user_id = $1`, [userId]);
    await pool.query(`delete from workspaces where id = any($1::uuid[])`, [[firstWorkspaceId, secondWorkspaceId]]);
    await pool.query(`delete from users where id = $1`, [userId]);
  }
});

function consentInput(workspaceId: string, userId: string, email: string, source: string) {
  return {
    workspaceId,
    userId,
    subjectEmail: email,
    purpose: "product-analytics-opt-in" as const,
    noticeVersion: "privacy-2026-07-11",
    source,
    scopes: ["privacy-safe-product-events"],
  };
}