import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { GET as getHome } from "../../src/app/api/workspaces/current/brief/route";
import { PUT as putContext } from "../../src/app/api/workspaces/current/commitments/[commitmentId]/context/route";
import { GET as getCommitment } from "../../src/app/api/workspaces/current/commitments/[commitmentId]/route";
import { POST as submitEvidence } from "../../src/app/api/workspaces/current/evidence/route";
import type {
  ApiFailure,
  ApiSuccess,
  CommitmentDetailDto,
  HomeProjectionDto,
  PutCommitmentContextResponse,
} from "../../src/lib/recovery/contracts";
import { getDatabasePool } from "../../src/lib/server/database";
import { createSessionCookie } from "../../src/lib/server/session";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const baseUrl = "https://vognary.test";

test("purpose context persists, replays, and never leaks across workspaces", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const otherUserId = randomUUID();
  const otherWorkspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);

  await pool.query(
    `insert into users (id, email, display_name) values
       ($1, $2, 'Context owner'),
       ($3, $4, 'Other context owner')`,
    [ownerUserId, `recovery-context-${suffix}@example.test`, otherUserId, `recovery-context-other-${suffix}@example.test`],
  );
  await pool.query(
    `insert into workspaces (id, owner_user_id, name) values
       ($1, $2, 'Context workspace'),
       ($3, $4, 'Other context workspace')`,
    [workspaceId, ownerUserId, otherWorkspaceId, otherUserId],
  );
  await pool.query(
    `insert into workspace_members (workspace_id, user_id, role) values
       ($1, $2, 'owner'),
       ($3, $4, 'owner')`,
    [workspaceId, ownerUserId, otherWorkspaceId, otherUserId],
  );

  try {
    const cookie = await createSessionCookie({ userId: ownerUserId, workspaceId });
    const cookieHeader = `${cookie.name}=${encodeURIComponent(cookie.value)}`;
    const otherCookie = await createSessionCookie({ userId: otherUserId, workspaceId: otherWorkspaceId });
    const otherCookieHeader = `${otherCookie.name}=${encodeURIComponent(otherCookie.value)}`;
    const mutationHeaders = (version: number, key: string, cookieValue = cookieHeader) => ({
      cookie: cookieValue,
      origin: baseUrl,
      "content-type": "application/json",
      "idempotency-key": key,
      "if-match": `"workspace:${version}"`,
    });

    const submitted = await submitEvidence(new Request(`${baseUrl}/api/workspaces/current/evidence`, {
      method: "POST",
      headers: mutationHeaders(0, `context-evidence-${suffix}`),
      body: JSON.stringify({
        kind: "RECEIPT_PASTE",
        receipts: [
          {
            clientRef: "openai-july",
            text: "From: OpenAI; Invoice date: 6 July 2026; ChatGPT Plus monthly subscription. Amount: INR 1,999.00; Next billing date: 6 August 2026.",
          },
          {
            clientRef: "anthropic-july",
            text: "Anthropic invoice paid INR 2,499.00 on 6 July 2026. Claude Pro renews monthly.",
          },
        ],
      }),
    }));
    assert.equal(submitted.status, 201);
    const submittedPayload = await submitted.json() as ApiSuccess<{ home: HomeProjectionDto }>;
    assert.equal(submittedPayload.data.home.activeCommitmentCount, 2);
    assert.equal(submittedPayload.data.home.possibleOverlaps.length, 1);
    assert.equal(submittedPayload.data.home.possibleOverlaps[0]?.family, "AI_RESEARCH");
    assert.equal(submittedPayload.data.home.possibleOverlaps[0]?.missingPurposeCount, 2);

    const openaiId = submittedPayload.data.home.possibleOverlaps[0]!.items.find((item) => /openai|chatgpt/i.test(item.merchant))?.commitmentId;
    const anthropicId = submittedPayload.data.home.possibleOverlaps[0]!.items.find((item) => /anthropic|claude/i.test(item.merchant))?.commitmentId;
    assert.ok(openaiId);
    assert.ok(anthropicId);

    const unauthenticated = await putContext(new Request(`${baseUrl}/api/workspaces/current/commitments/${openaiId}/context`, {
      method: "PUT",
      headers: { origin: baseUrl, "content-type": "application/json", "idempotency-key": `context-anon-${suffix}`, "if-match": '"workspace:1"' },
      body: JSON.stringify({ purpose: "CODING" }),
    }), { params: Promise.resolve({ commitmentId: openaiId }) });
    assert.equal(unauthenticated.status, 401);

    const foreign = await putContext(new Request(`${baseUrl}/api/workspaces/current/commitments/${openaiId}/context`, {
      method: "PUT",
      headers: mutationHeaders(0, `context-foreign-${suffix}`, otherCookieHeader),
      body: JSON.stringify({ purpose: "CODING" }),
    }), { params: Promise.resolve({ commitmentId: openaiId }) });
    assert.equal(foreign.status, 404);
    assertContractFailure(await foreign.json(), "NOT_FOUND");

    const contextRequest = () => new Request(`${baseUrl}/api/workspaces/current/commitments/${openaiId}/context`, {
      method: "PUT",
      headers: mutationHeaders(1, `context-save-${suffix}`),
      body: JSON.stringify({ purpose: "CODING", importance: "PRODUCTIVITY_DECREASES", owner: "ENGINEERING" }),
    });
    const saved = await putContext(contextRequest(), { params: Promise.resolve({ commitmentId: openaiId }) });
    assert.equal(saved.status, 201);
    const savedPayload = await saved.json() as PutCommitmentContextResponse;
    assert.equal(savedPayload.meta.workspaceVersion, 2);
    assert.equal(savedPayload.data.context.purpose, "CODING");
    assert.equal(savedPayload.data.context.importance, "PRODUCTIVITY_DECREASES");
    assert.equal(savedPayload.data.context.owner, "ENGINEERING");
    assert.equal(savedPayload.data.commitment.context?.purpose, "CODING");
    assert.equal(savedPayload.data.home.possibleOverlaps[0]?.missingPurposeCount, 1);
    assert.equal(savedPayload.data.home.possibleOverlaps[0]?.sharedPurpose, false);

    const replay = await putContext(contextRequest(), { params: Promise.resolve({ commitmentId: openaiId }) });
    assert.equal(replay.status, 200);
    const replayPayload = await replay.json() as PutCommitmentContextResponse;
    assert.equal(replayPayload.meta.workspaceVersion, 2);
    assert.equal(replayPayload.data.context.purpose, "CODING");

    const stale = await putContext(new Request(`${baseUrl}/api/workspaces/current/commitments/${openaiId}/context`, {
      method: "PUT",
      headers: mutationHeaders(1, `context-stale-${suffix}`),
      body: JSON.stringify({ purpose: "RESEARCH" }),
    }), { params: Promise.resolve({ commitmentId: openaiId }) });
    assert.equal(stale.status, 412);
    assertContractFailure(await stale.json(), "STALE_STATE");

    const detail = await getCommitment(
      new Request(`${baseUrl}/api/workspaces/current/commitments/${openaiId}`, { headers: { cookie: cookieHeader } }),
      { params: Promise.resolve({ commitmentId: openaiId }) },
    );
    assert.equal(detail.status, 200);
    const detailPayload = await detail.json() as ApiSuccess<CommitmentDetailDto>;
    assert.equal(detailPayload.data.context?.purpose, "CODING");
    assert.equal(detailPayload.data.overlap?.family, "AI_RESEARCH");

    const foreignDetail = await getCommitment(
      new Request(`${baseUrl}/api/workspaces/current/commitments/${openaiId}`, { headers: { cookie: otherCookieHeader } }),
      { params: Promise.resolve({ commitmentId: openaiId }) },
    );
    assert.equal(foreignDetail.status, 404);

    const home = await getHome(new Request(`${baseUrl}/api/workspaces/current/brief`, { headers: { cookie: cookieHeader } }));
    const homePayload = await home.json() as ApiSuccess<HomeProjectionDto>;
    assert.equal(homePayload.data.possibleOverlaps[0]?.missingPurposeCount, 1);

    const leaked = await pool.query<{ n: string }>(
      `select count(*)::text as n
       from recovery_commitment_context
       where workspace_id = $1 and commitment_id = $2`,
      [otherWorkspaceId, openaiId],
    );
    assert.equal(leaked.rows[0]?.n, "0");
    const owned = await pool.query<{ purpose: string }>(
      `select purpose from recovery_commitment_context where workspace_id = $1 and commitment_id = $2`,
      [workspaceId, openaiId],
    );
    assert.equal(owned.rows[0]?.purpose, "CODING");
  } finally {
    await pool.query(`delete from workspaces where id = any($1::uuid[])`, [[workspaceId, otherWorkspaceId]]);
    await pool.query(`delete from users where id = any($1::uuid[])`, [[ownerUserId, otherUserId]]);
  }
});

function assertContractFailure(payload: unknown, code: string) {
  assert.equal(typeof payload, "object");
  const failure = payload as ApiFailure;
  assert.equal(failure.error.code, code);
  assert.equal(typeof failure.error.requestId, "string");
  assert.equal(typeof failure.error.message, "string");
  assert.equal(typeof failure.error.retryable, "boolean");
}
