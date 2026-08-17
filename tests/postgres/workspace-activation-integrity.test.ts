import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { POST as recordActivation } from "../../src/app/api/workspaces/current/activation/route";
import { POST as submitEvidence } from "../../src/app/api/workspaces/current/evidence/route";
import { GET as getHome } from "../../src/app/api/workspaces/current/brief/route";
import type { ApiFailure, ApiSuccess } from "../../src/lib/recovery/contracts";
import { recordConsentGrant } from "../../src/lib/server/consent-store";
import { getDatabasePool } from "../../src/lib/server/database";
import { recordWorkspaceActivationOnce } from "../../src/lib/server/product-event-store";
import { executeRetentionPolicies } from "../../src/lib/server/retention-executor";
import { createSessionCookie } from "../../src/lib/server/session";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const baseUrl = "https://vognary.test";

test("workspace activation is consent-gated, Home-rendered, unique, and never trusts client totals", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  const email = `activation-integrity-${suffix}@example.test`;

  await pool.query(`insert into users (id, email) values ($1, $2)`, [ownerUserId, email]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Activation integrity')`, [workspaceId, ownerUserId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, ownerUserId]);

  try {
    const index = await pool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'product_events_workspace_activated_once_idx'`,
    );
    assert.match(index.rows[0]?.indexdef ?? "", /unique/i);
    assert.match(index.rows[0]?.indexdef ?? "", /workspace_id/);
    assert.match(index.rows[0]?.indexdef ?? "", /workspace.activated/);

    const cookie = await createSessionCookie({ userId: ownerUserId, workspaceId });
    const cookieHeader = `${cookie.name}=${encodeURIComponent(cookie.value)}`;
    const mutationHeaders = {
      cookie: cookieHeader,
      origin: baseUrl,
      "content-type": "application/json",
    };
    const activationCount = async () => Number((await pool.query<{ n: string }>(
      `select count(*)::text as n from product_events where workspace_id = $1 and event_name = 'workspace.activated'`,
      [workspaceId],
    )).rows[0]?.n ?? 0);

    await recordConsentGrant({
      workspaceId,
      userId: ownerUserId,
      subjectEmail: email,
      purpose: "product-analytics-opt-in",
      noticeVersion: "privacy-2026-07-11",
      source: "activation-integrity-test",
      scopes: ["privacy-safe-product-events"],
    });
    const noPicture = await recordActivation(new Request(`${baseUrl}/api/workspaces/current/activation`, {
      method: "POST",
      headers: mutationHeaders,
      body: "{}",
    }));
    assert.equal(noPicture.status, 200);
    const noPicturePayload = await noPicture.json() as ApiSuccess<{ recorded: boolean; id: string | null; outcome: string }>;
    assert.equal(noPicturePayload.data.recorded, false);
    assert.equal(noPicturePayload.data.outcome, "deferred-no-picture");
    assert.equal(await activationCount(), 0);
    await pool.query(
      `update consent_grants set withdrawn_at = now() where workspace_id = $1 and purpose = 'product-analytics-opt-in'`,
      [workspaceId],
    );

    const evidence = await submitEvidence(new Request(`${baseUrl}/api/workspaces/current/evidence`, {
      method: "POST",
      headers: {
        ...mutationHeaders,
        "idempotency-key": `activation-integrity-${suffix}`,
        "if-match": '"workspace:0"',
      },
      body: JSON.stringify({
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "activation-integrity-openai",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 August 2026.",
        }],
      }),
    }));
    assert.equal(evidence.status, 201);
    assert.equal(await activationCount(), 0);

    const home = await getHome(new Request(`${baseUrl}/api/workspaces/current/brief`, { headers: { cookie: cookieHeader } }));
    assert.equal(home.status, 200);
    assert.equal(await activationCount(), 0);

    const unauthenticated = await recordActivation(new Request(`${baseUrl}/api/workspaces/current/activation`, {
      method: "POST",
      headers: { origin: baseUrl, "content-type": "application/json" },
      body: "{}",
    }));
    assert.equal(unauthenticated.status, 401);

    const crossSite = await recordActivation(new Request(`${baseUrl}/api/workspaces/current/activation`, {
      method: "POST",
      headers: {
        ...mutationHeaders,
        origin: "https://attacker.test",
        "sec-fetch-site": "cross-site",
      },
      body: "{}",
    }));
    assert.equal(crossSite.status, 403);
    assert.equal((await crossSite.json() as ApiFailure).error.code, "FORBIDDEN");
    assert.equal(await activationCount(), 0);

    const withoutConsent = await recordActivation(new Request(`${baseUrl}/api/workspaces/current/activation`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({
        monthlyTotals: [{ amount: { currency: "INR", minor: "999999", exponent: 2, display: "₹9,999.99" } }],
        activeCommitmentCount: 99,
      }),
    }));
    assert.equal(withoutConsent.status, 202);
    const withoutConsentPayload = await withoutConsent.json() as ApiSuccess<{ recorded: boolean; id: string | null; outcome: string }>;
    assert.equal(withoutConsentPayload.data.recorded, false);
    assert.equal(withoutConsentPayload.data.id, null);
    assert.equal(withoutConsentPayload.data.outcome, "deferred-no-consent");
    assert.equal(await activationCount(), 0);

    await recordConsentGrant({
      workspaceId,
      userId: ownerUserId,
      subjectEmail: email,
      purpose: "product-analytics-opt-in",
      noticeVersion: "privacy-2026-07-11",
      source: "activation-integrity-test",
      scopes: ["privacy-safe-product-events"],
    });

    const trusted = await recordActivation(new Request(`${baseUrl}/api/workspaces/current/activation`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({
        monthlyTotals: [{ amount: { currency: "INR", minor: "1", exponent: 2, display: "₹0.01" } }],
        activeCommitmentCount: 99,
        evidenceWritten: 99,
      }),
    }));
    assert.equal(trusted.status, 201);
    const trustedPayload = await trusted.json() as ApiSuccess<{ recorded: boolean; id: string | null; outcome: string }>;
    assert.equal(trustedPayload.data.recorded, true);
    assert.equal(trustedPayload.data.outcome, "recorded");
    assert.equal(await activationCount(), 1);
    const metrics = await pool.query<{ commitments_touched: number; evidence_written: number }>(
      `select (metrics->>'commitmentsTouched')::int as commitments_touched,
              (metrics->>'evidenceWritten')::int as evidence_written
       from product_events
       where workspace_id = $1 and event_name = 'workspace.activated'`,
      [workspaceId],
    );
    assert.equal(metrics.rows[0]?.commitments_touched, 1);
    assert.notEqual(metrics.rows[0]?.commitments_touched, 99);
    assert.equal(metrics.rows[0]?.evidence_written, 1);
    assert.notEqual(metrics.rows[0]?.evidence_written, 99);

    const replay = await recordActivation(new Request(`${baseUrl}/api/workspaces/current/activation`, {
      method: "POST",
      headers: mutationHeaders,
      body: "{}",
    }));
    assert.equal(replay.status, 200);
    const replayPayload = await replay.json() as ApiSuccess<{ recorded: boolean; outcome: string }>;
    assert.equal(replayPayload.data.recorded, false);
    assert.equal(replayPayload.data.outcome, "already-recorded");
    assert.equal(await activationCount(), 1);

    await assert.rejects(
      () => pool.query(
        `insert into product_events (workspace_id, user_id, event_name, source, status, metrics)
         values ($1, $2, 'workspace.activated', 'workspace-api', 'succeeded', '{}'::jsonb)`,
        [workspaceId, ownerUserId],
      ),
      /activation_semantic_version|semantic version|check|unique|duplicate/i,
    );
    await assert.rejects(
      () => pool.query(
        `insert into product_events (workspace_id, user_id, event_name, source, status, metrics, activation_semantic_version)
         values ($1, $2, 'workspace.activated', 'workspace-api', 'succeeded', '{}'::jsonb, 1)`,
        [workspaceId, ownerUserId],
      ),
      /unique|duplicate/i,
    );
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("concurrent workspace activation attempts persist exactly one non-null row", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);

  await pool.query(`insert into users (id, email) values ($1, $2)`, [ownerUserId, `activation-race-${suffix}@example.test`]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Activation race')`, [workspaceId, ownerUserId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, ownerUserId]);

  try {
    await recordConsentGrant({
      workspaceId,
      userId: ownerUserId,
      subjectEmail: `activation-race-${suffix}@example.test`,
      purpose: "product-analytics-opt-in",
      noticeVersion: "privacy-2026-07-11",
      source: "activation-race-test",
      scopes: ["privacy-safe-product-events"],
    });
    const attempts = await Promise.all(Array.from({ length: 8 }, (_, index) => recordWorkspaceActivationOnce({
      workspaceId,
      userId: ownerUserId,
      commitmentsTouched: index + 1,
      evidenceWritten: index + 1,
    })));
    assert.equal(attempts.filter((attempt) => attempt.recorded).length, 1);
    const count = Number((await pool.query<{ n: string }>(
      `select count(*)::text as n from product_events where workspace_id = $1 and event_name = 'workspace.activated'`,
      [workspaceId],
    )).rows[0]?.n ?? 0);
    assert.equal(count, 1);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("version-1 workspace activation cannot be deleted while the workspace exists and retention skips it", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);

  await pool.query(`insert into users (id, email) values ($1, $2)`, [ownerUserId, `activation-retain-${suffix}@example.test`]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Activation retain')`, [workspaceId, ownerUserId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, ownerUserId]);

  try {
    await recordConsentGrant({
      workspaceId,
      userId: ownerUserId,
      subjectEmail: `activation-retain-${suffix}@example.test`,
      purpose: "product-analytics-opt-in",
      noticeVersion: "privacy-2026-07-11",
      source: "activation-retain-test",
      scopes: ["privacy-safe-product-events"],
    });
    const recorded = await recordWorkspaceActivationOnce({
      workspaceId,
      userId: ownerUserId,
      commitmentsTouched: 1,
      evidenceWritten: 1,
    });
    assert.equal(recorded.recorded, true);
    await pool.query(
      `insert into product_events (workspace_id, user_id, event_name, source, status, metrics, occurred_at)
       values ($1, $2, 'ledger.viewed', 'product-ui', 'succeeded', '{}'::jsonb, now() - interval '120 days')`,
      [workspaceId, ownerUserId],
    );
    await pool.query(
      `update product_events
       set occurred_at = now() - interval '120 days'
       where workspace_id = $1 and event_name = 'workspace.activated'`,
      [workspaceId],
    );
    await assert.rejects(
      pool.query(
        `delete from product_events where workspace_id = $1 and event_name = 'workspace.activated'`,
        [workspaceId],
      ),
      /cannot be deleted directly/i,
    );
    const executed = await executeRetentionPolicies({
      dryRun: false,
      workspaceId,
      afterWorkspaceId: null,
      workspaceLimit: 1,
      batchSize: 100,
    }, "internal-api");
    assert.equal(executed.results[0]?.status, "completed");
    assert.equal(executed.results[0]?.counts.productEventsDeleted, 1);
    const remaining = await pool.query<{ event_name: string }>(
      `select event_name from product_events where workspace_id = $1 order by event_name`,
      [workspaceId],
    );
    assert.deepEqual(remaining.rows.map((row) => row.event_name), ["workspace.activated"]);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("activation writer refuses a withdrawn analytics consent", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const email = `activation-withdrawn-${randomUUID().slice(0, 8)}@example.test`;
  await pool.query(`insert into users (id, email) values ($1, $2)`, [ownerUserId, email]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Activation withdrawn')`, [workspaceId, ownerUserId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, ownerUserId]);
  try {
    await recordConsentGrant({
      workspaceId,
      userId: ownerUserId,
      subjectEmail: email,
      purpose: "product-analytics-opt-in",
      noticeVersion: "privacy-2026-07-11",
      source: "activation-withdrawn-test",
      scopes: ["privacy-safe-product-events"],
    });
    await pool.query(
      `update consent_grants set withdrawn_at = now()
       where workspace_id = $1 and user_id = $2 and purpose = 'product-analytics-opt-in'`,
      [workspaceId, ownerUserId],
    );
    const result = await recordWorkspaceActivationOnce({
      workspaceId,
      userId: ownerUserId,
      commitmentsTouched: 1,
      evidenceWritten: 1,
    });
    assert.equal(result.recorded, false);
    assert.equal(result.consentCurrent, false);
    assert.equal(Number((await pool.query<{ total: number }>(
      `select count(*)::int as total from product_events
       where workspace_id = $1 and event_name = 'workspace.activated'`,
      [workspaceId],
    )).rows[0]?.total ?? -1), 0);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("activation writer waits for concurrent consent withdrawal and then refuses the event", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const email = `activation-withdraw-race-${randomUUID().slice(0, 8)}@example.test`;
  await pool.query(`insert into users (id, email) values ($1, $2)`, [ownerUserId, email]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Activation withdraw race')`, [workspaceId, ownerUserId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, ownerUserId]);
  const consent = await recordConsentGrant({
    workspaceId,
    userId: ownerUserId,
    subjectEmail: email,
    purpose: "product-analytics-opt-in",
    noticeVersion: "privacy-2026-07-11",
    source: "activation-withdraw-race-test",
    scopes: ["privacy-safe-product-events"],
  });
  const withdrawClient = await pool.connect();
  try {
    await withdrawClient.query("begin");
    await withdrawClient.query(
      `update consent_grants set withdrawn_at = now() where id = $1`,
      [consent.id],
    );
    let writerFinished = false;
    const writerPromise = recordWorkspaceActivationOnce({
      workspaceId,
      userId: ownerUserId,
      commitmentsTouched: 1,
      evidenceWritten: 1,
    });
    void writerPromise.then(() => { writerFinished = true; });
    let waiting = false;
    for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
      const locks = await pool.query<{ waiting: number }>(
        `select count(*)::int as waiting from pg_locks where not granted`,
      );
      waiting = (locks.rows[0]?.waiting ?? 0) > 0;
      if (!waiting) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.equal(waiting, true, "activation insertion must wait for in-flight consent withdrawal");
    assert.equal(writerFinished, false);
    await withdrawClient.query("commit");
    const result = await writerPromise;
    assert.equal(result.recorded, false);
    assert.equal(result.consentCurrent, false);
    assert.equal(Number((await pool.query<{ total: number }>(
      `select count(*)::int as total from product_events
       where workspace_id = $1 and event_name = 'workspace.activated'`,
      [workspaceId],
    )).rows[0]?.total ?? -1), 0);
  } catch (error) {
    await withdrawClient.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    withdrawClient.release();
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});
