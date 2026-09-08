import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { POST } from "../../src/app/api/workspaces/current/evidence/route";
import { createRecoveryTransport } from "../../src/app/workspace/recovery/transport";
import { getDatabasePool } from "../../src/lib/server/database";
import { createSessionCookie } from "../../src/lib/server/session";

test("lost real-handler acknowledgements recover once and cannot cross an active-workspace switch", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const pool = getDatabasePool();
  const ownerId = randomUUID();
  const workspaceId = randomUUID();
  const otherWorkspaceId = randomUUID();
  await pool.query("insert into users (id,email) values ($1,$2)", [ownerId, `unknown-write-${ownerId}@example.test`]);
  await pool.query("insert into workspaces (id,owner_user_id,name) values ($1,$3,'Synthetic original workspace'),($2,$3,'Synthetic other workspace')", [workspaceId, otherWorkspaceId, ownerId]);
  await pool.query("insert into workspace_members (workspace_id,user_id,role) values ($1,$3,'owner'),($2,$3,'owner')", [workspaceId, otherWorkspaceId, ownerId]);
  try {
    const original = await createSessionCookie({ userId: ownerId, workspaceId });
    const other = await createSessionCookie({ userId: ownerId, workspaceId: otherWorkspaceId });
    const cookie = (value: typeof original) => `${value.name}=${encodeURIComponent(value.value)}`;
    const body = (amount: number) => ({ kind: "RECEIPT_PASTE" as const, receipts: [{ clientRef: `synthetic-${amount}`, text: `OpenAI invoice paid INR ${amount}.00 on 6 September 2026. Synthetic fixture. Renews monthly on 6 October 2026.` }] });
    let attempts = 0;
    const transport = createRecoveryTransport(async (path, init) => {
      attempts += 1;
      const headers = new Headers(init?.headers);
      headers.set("cookie", cookie(original));
      headers.set("origin", "https://vognary.test");
      const result = await POST(new Request(`https://vognary.test${path}`, { ...init, headers }));
      if (attempts === 1) {
        assert.equal(result.status, 201);
        throw new TypeError("Synthetic acknowledgement lost after the real commit");
      }
      return result;
    });
    const result = await transport.submitEvidence(body(100), { workspaceId, workspaceVersion: 0, idempotencyKey: randomUUID() });
    assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify({ attempts, failure: result }));
    assert.equal(attempts, 2);
    assert.equal((await pool.query("select count(*)::int as count from recovery_submissions where workspace_id=$1", [workspaceId])).rows[0].count, 1);
    assert.ok(result.ok);
    let switchedAttempts = 0;
    const switched = createRecoveryTransport(async (path, init) => {
      switchedAttempts += 1;
      const headers = new Headers(init?.headers);
      headers.set("cookie", cookie(switchedAttempts === 1 ? original : other));
      headers.set("origin", "https://vognary.test");
      const response = await POST(new Request(`https://vognary.test${path}`, { ...init, headers }));
      if (switchedAttempts === 1) {
        assert.equal(response.status, 201);
        throw new TypeError("Synthetic acknowledgement loss before a workspace switch");
      }
      assert.equal(response.status, 403);
      return response;
    });
    const unknown = await switched.submitEvidence(body(110), { workspaceId, workspaceVersion: result.meta.workspaceVersion, idempotencyKey: randomUUID() });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.outcome, "UNKNOWN");
    assert.equal((await pool.query("select count(*)::int as count from recovery_submissions where workspace_id=$1", [workspaceId])).rows[0].count, 2);
    assert.equal((await pool.query("select count(*)::int as count from recovery_submissions where workspace_id=$1", [otherWorkspaceId])).rows[0].count, 0);
  } finally {
    await pool.query("delete from workspaces where id=any($1::uuid[])", [[workspaceId, otherWorkspaceId]]);
    await pool.query("delete from users where id=$1", [ownerId]);
  }
});
