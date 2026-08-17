import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { GET as getHome } from "../../src/app/api/workspaces/current/brief/route";
import { DELETE as deleteLegacySnapshot, POST as saveLegacySnapshot } from "../../src/app/api/workspaces/current/audit-snapshot/route";
import { GET as getCommitment } from "../../src/app/api/workspaces/current/commitments/[commitmentId]/route";
import { DELETE as reverseCorrection } from "../../src/app/api/workspaces/current/commitments/[commitmentId]/corrections/[correctionId]/route";
import { POST as createCorrection } from "../../src/app/api/workspaces/current/commitments/[commitmentId]/corrections/route";
import { GET as listCommitments } from "../../src/app/api/workspaces/current/commitments/route";
import { GET as getDecisions, POST as postLegacyDecision, PUT as putDecision } from "../../src/app/api/workspaces/current/decisions/route";
import { POST as submitEvidence } from "../../src/app/api/workspaces/current/evidence/route";
import { GET as getEvidence } from "../../src/app/api/workspaces/current/evidence/[evidenceId]/route";
import type { ApiFailure, ApiSuccess, HomeProjectionDto } from "../../src/lib/recovery/contracts";
import { getDatabasePool } from "../../src/lib/server/database";
import { submitRecoveryEvidence } from "../../src/lib/server/recovery-store";
import { createSessionCookie } from "../../src/lib/server/session";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const baseUrl = "https://vognary.test";

test("Recovery HTTP routes enforce session, version, replay, isolation, and safe envelopes", {
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
       ($1, $2, 'Recovery route owner'),
       ($3, $4, 'Other Recovery owner')`,
     [ownerUserId, `recovery-route-${suffix}@example.test`, otherUserId, `recovery-route-other-${suffix}@example.test`],
  );
  await pool.query(
     `insert into workspaces (id, owner_user_id, name) values
       ($1, $2, 'Recovery route workspace'),
       ($3, $4, 'Other Recovery route workspace')`,
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
    const mutationHeaders = (version: number, key: string) => ({
      cookie: cookieHeader,
      origin: baseUrl,
      "content-type": "application/json",
      "idempotency-key": key,
      "if-match": `"workspace:${version}"`,
    });
    const evidenceBody = {
      kind: "RECEIPT_PASTE",
      receipts: [{
        clientRef: "route-openai-july",
        text: "From: OpenAI; Invoice date: 6 July 2026; ChatGPT Plus monthly subscription. Amount: INR 1,999.00; Next billing date: 6 August 2026.",
      }],
    };

    const retiredSnapshot = await saveLegacySnapshot(new Request(`${baseUrl}/api/workspaces/current/audit-snapshot`, {
      method: "POST",
      headers: { cookie: cookieHeader, origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify({ snapshot: { version: 1, statementSources: [], manualItems: [] } }),
    }));
    assert.equal(retiredSnapshot.status, 410);
    assert.equal((await retiredSnapshot.json()).canonicalOwner, "RECOVERY_V1");

    const retiredSnapshotDelete = await deleteLegacySnapshot(new Request(`${baseUrl}/api/workspaces/current/audit-snapshot`, {
      method: "DELETE",
      headers: { cookie: cookieHeader, origin: baseUrl },
    }));
    assert.equal(retiredSnapshotDelete.status, 410);

    const retiredDecision = await postLegacyDecision(new Request(`${baseUrl}/api/workspaces/current/decisions`, {
      method: "POST",
      headers: { cookie: cookieHeader, origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify({ recurringItemId: randomUUID(), action: "keep" }),
    }));
    assert.equal(retiredDecision.status, 410);
    assert.equal((await retiredDecision.json()).canonicalOwner, "RECOVERY_V1");

    const unauthenticated = await getHome(new Request(`${baseUrl}/api/workspaces/current/brief`));
    assert.equal(unauthenticated.status, 401);
    assertContractFailure(await unauthenticated.json(), "AUTH_REQUIRED");

    const crossSite = await submitEvidence(new Request(`${baseUrl}/api/workspaces/current/evidence`, {
      method: "POST",
      headers: {
        ...mutationHeaders(0, `route-cross-${suffix}`),
        origin: "https://attacker.test",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify(evidenceBody),
    }));
    assert.equal(crossSite.status, 403);
    assertContractFailure(await crossSite.json(), "FORBIDDEN");

    const firstRequest = () => new Request(`${baseUrl}/api/workspaces/current/evidence`, {
      method: "POST",
      headers: mutationHeaders(0, `route-first-${suffix}`),
      body: JSON.stringify(evidenceBody),
    });
    const first = await submitEvidence(firstRequest());
    assert.equal(first.status, 201);
    assert.equal(first.headers.get("etag"), '"workspace:1"');
    const firstPayload = await first.json() as ApiSuccess<{ home: HomeProjectionDto; submission: { id: string } }>;
    assert.equal(firstPayload.meta.workspaceVersion, 1);
    assert.equal(firstPayload.data.home.changed.state, "NO_PRIOR_BASELINE");
    assert.deepEqual(firstPayload.data.home.changed.items, []);
    assert.equal(firstPayload.data.home.activeCommitmentCount, 1);
    assert.deepEqual(firstPayload.data.home.annualizedEstimateTotals.map((total) => [total.amount.currency, total.amount.minor]), [["INR", "2398800"]]);
    assert.equal(firstPayload.data.home.monthlyTotals[0]?.provenance, "RECEIPT");
    const activationCount = async () => Number((await pool.query<{ n: string }>(
      `select count(*)::text as n from product_events where workspace_id = $1 and event_name = 'workspace.activated'`,
      [workspaceId],
    )).rows[0]?.n ?? 0);
    assert.equal(await activationCount(), 0);

    const replay = await submitEvidence(firstRequest());
    assert.equal(replay.status, 200);
    const replayPayload = await replay.json() as typeof firstPayload;
    assert.equal(replayPayload.data.submission.id, firstPayload.data.submission.id);
    assert.equal(replayPayload.meta.workspaceVersion, 1);

    const conflictingReplay = await submitEvidence(new Request(`${baseUrl}/api/workspaces/current/evidence`, {
      method: "POST",
      headers: mutationHeaders(0, `route-first-${suffix}`),
      body: JSON.stringify({
        kind: "RECEIPT_PASTE",
        receipts: [{ clientRef: "different-request", text: "GitHub charged USD 100 on 1 July 2026. Renews yearly." }],
      }),
    }));
    assert.equal(conflictingReplay.status, 409);
    assertContractFailure(await conflictingReplay.json(), "CONFLICT");

    const home = await getHome(authenticatedRequest("/api/workspaces/current/brief", cookieHeader));
    assert.equal(home.status, 200);
    const homePayload = await home.json() as ApiSuccess<HomeProjectionDto>;
    assert.equal(homePayload.data.workspace.version, 1);
    assert.equal(homePayload.data.activeCommitmentCount, 1);
    assert.equal(homePayload.data.monthlyTotals[0]?.provenance, "RECEIPT");
    assert.doesNotMatch(JSON.stringify(homePayload.data), /recovery-source:[0-9a-f-]{36}/i);
    assert.match(JSON.stringify(homePayload.data), /Pasted receipt/);
    assert.equal(await activationCount(), 0);

    const list = await listCommitments(authenticatedRequest("/api/workspaces/current/commitments?limit=1", cookieHeader));
    assert.equal(list.status, 200);
    const listPayload = await list.json() as ApiSuccess<{ items: { id: string }[]; total: number; nextCursor: string | null }>;
    assert.equal(listPayload.data.items.length, 1);
    assert.equal(listPayload.data.total, 1);
    const commitmentId = listPayload.data.items[0].id;

    const detail = await getCommitment(
      authenticatedRequest(`/api/workspaces/current/commitments/${commitmentId}?evidenceLimit=1`, cookieHeader),
      { params: Promise.resolve({ commitmentId }) },
    );
    assert.equal(detail.status, 200);
    const detailPayload = await detail.json() as ApiSuccess<{ evidence: { items: Array<{ id: string }> } }>;
    assert.equal(detailPayload.data.evidence.items.length, 1);
    const evidenceId = detailPayload.data.evidence.items[0].id;

    const exactEvidence = await getEvidence(
      authenticatedRequest(`/api/workspaces/current/evidence/${evidenceId}`, cookieHeader),
      { params: Promise.resolve({ evidenceId }) },
    );
    assert.equal(exactEvidence.status, 200);
    assert.equal((await exactEvidence.json() as ApiSuccess<{ id: string }>).data.id, evidenceId);

    const unauthenticatedEvidence = await getEvidence(
      new Request(`${baseUrl}/api/workspaces/current/evidence/${evidenceId}`),
      { params: Promise.resolve({ evidenceId }) },
    );
    assert.equal(unauthenticatedEvidence.status, 401);

    await submitRecoveryEvidence({
      workspaceId: otherWorkspaceId,
      actorUserId: otherUserId,
      expectedVersion: 0,
      idempotencyKey: `route-other-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{ clientRef: "other-receipt", text: "Netflix charged INR 649 on 1 July 2026. Renews monthly on 1 August 2026." }],
      },
    });
    const foreignEvidenceId = (await pool.query<{ id: string }>(
      `select id from recovery_evidence where workspace_id = $1 limit 1`,
      [otherWorkspaceId],
    )).rows[0]!.id;
    const foreignEvidence = await getEvidence(
      authenticatedRequest(`/api/workspaces/current/evidence/${foreignEvidenceId}`, cookieHeader),
      { params: Promise.resolve({ evidenceId: foreignEvidenceId }) },
    );
    assert.equal(foreignEvidence.status, 404);
    assertContractFailure(await foreignEvidence.json(), "NOT_FOUND");

    const correction = await createCorrection(new Request(
      `${baseUrl}/api/workspaces/current/commitments/${commitmentId}/corrections`,
      {
        method: "POST",
        headers: mutationHeaders(1, `route-correction-${suffix}`),
        body: JSON.stringify({ patch: { field: "AMOUNT", value: { amountMinor: "175000" } } }),
      },
    ), { params: Promise.resolve({ commitmentId }) });
    assert.equal(correction.status, 201);
    const correctionPayload = await correction.json() as ApiSuccess<{ correction: { id: string }; commitment: { amount: { minor: number } } }>;
    assert.equal(correctionPayload.data.commitment.amount.minor, "175000");
    const correctedHome = await getHome(authenticatedRequest("/api/workspaces/current/brief", cookieHeader));
    const correctedHomePayload = await correctedHome.json() as ApiSuccess<HomeProjectionDto>;
    assert.equal(correctedHomePayload.data.monthlyTotals[0]?.provenance, "USER_CORRECTED");
    assert.equal(correctedHomePayload.data.monthlyTotals[0]?.correctionIds[0], correctionPayload.data.correction.id);
    assert.equal(await activationCount(), 0);

    const decision = await putDecision(new Request(`${baseUrl}/api/workspaces/current/decisions`, {
      method: "PUT",
      headers: mutationHeaders(2, `route-decision-${suffix}`),
      body: JSON.stringify({ commitmentId, decision: "MONITOR" }),
    }));
    assert.equal(decision.status, 200);
    assert.equal((await decision.json() as ApiSuccess<{ decision: { value: string } }>).data.decision.value, "MONITOR");
    const listedDecisions = await getDecisions(authenticatedRequest("/api/workspaces/current/decisions", cookieHeader));
    assert.equal(listedDecisions.status, 200);
    const listedDecisionPayload = await listedDecisions.json() as ApiSuccess<{ decisions: Array<{ commitmentId: string; value: string; decidedAt: string; updatedAt: string }> }>;
    assert.equal(listedDecisionPayload.data.decisions.length, 1);
    assert.equal(listedDecisionPayload.data.decisions[0].commitmentId, commitmentId);
    assert.equal(listedDecisionPayload.data.decisions[0].value, "MONITOR");

    const reversed = await reverseCorrection(new Request(
      `${baseUrl}/api/workspaces/current/commitments/${commitmentId}/corrections/${correctionPayload.data.correction.id}`,
      {
        method: "DELETE",
        headers: mutationHeaders(3, `route-reverse-${suffix}`),
      },
    ), { params: Promise.resolve({ commitmentId, correctionId: correctionPayload.data.correction.id }) });
    assert.equal(reversed.status, 200);
    assert.equal((await reversed.json() as ApiSuccess<{ correction: { status: string } }>).data.correction.status, "REVERSED");
    const reversedHome = await getHome(authenticatedRequest("/api/workspaces/current/brief", cookieHeader));
    assert.equal((await reversedHome.json() as ApiSuccess<HomeProjectionDto>).data.monthlyTotals[0]?.provenance, "RECEIPT");

    const stale = await putDecision(new Request(`${baseUrl}/api/workspaces/current/decisions`, {
      method: "PUT",
      headers: mutationHeaders(1, `route-stale-${suffix}`),
      body: JSON.stringify({ commitmentId, decision: "KEEP" }),
    }));
    assert.equal(stale.status, 412);
    const stalePayload = await stale.json() as ApiFailure;
    assert.equal(stalePayload.error.code, "STALE_STATE");
    assert.equal(stalePayload.error.currentVersion, 4);
  } finally {
    await pool.query(`delete from workspaces where id = any($1::uuid[])`, [[workspaceId, otherWorkspaceId]]);
    await pool.query(`delete from users where id = any($1::uuid[])`, [[ownerUserId, otherUserId]]);
  }
});

test("saving one observed receipt does not activate a workspace without a cited recurring picture", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);

  await pool.query(`insert into users (id, email) values ($1, $2)`, [ownerUserId, `recovery-activation-${suffix}@example.test`]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Activation workspace')`, [workspaceId, ownerUserId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, ownerUserId]);

  try {
    const cookie = await createSessionCookie({ userId: ownerUserId, workspaceId });
    const cookieHeader = `${cookie.name}=${encodeURIComponent(cookie.value)}`;
    const first = await submitEvidence(new Request(`${baseUrl}/api/workspaces/current/evidence`, {
      method: "POST",
      headers: {
        cookie: cookieHeader,
        origin: baseUrl,
        "content-type": "application/json",
        "idempotency-key": `activation-first-${suffix}`,
        "if-match": '"workspace:0"',
      },
      body: JSON.stringify({
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "activation-openai-july",
          text: "OpenAI\n\nChatGPT Plus subscription\n\nAmount: INR 1,999.00\n\nCharged on 6 July 2026",
        }],
      }),
    }));
    assert.equal(first.status, 201);
    const firstPayload = await first.json() as ApiSuccess<{ home: HomeProjectionDto }>;
    assert.equal(firstPayload.data.home.activeCommitmentCount, 0);
    assert.equal(hasCitedPicture(firstPayload.data.home), false);
    const activationCount = async () => Number((await pool.query<{ n: string }>(
      `select count(*)::text as n from product_events where workspace_id = $1 and event_name = 'workspace.activated'`,
      [workspaceId],
    )).rows[0]?.n ?? 0);
    assert.equal(await activationCount(), 0);

    const home = await getHome(authenticatedRequest("/api/workspaces/current/brief", cookieHeader));
    assert.equal(home.status, 200);
    assert.equal(await activationCount(), 0);
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

function hasCitedPicture(home: HomeProjectionDto) {
  return home.activeCommitmentCount > 0 && home.monthlyTotals.length > 0;
}

function authenticatedRequest(path: string, cookie: string) {
  return new Request(`${baseUrl}${path}`, { headers: { cookie } });
}

function assertContractFailure(payload: unknown, code: string) {
  assert.equal(typeof payload, "object");
  const failure = payload as ApiFailure;
  assert.equal(failure.error.code, code);
  assert.equal(typeof failure.error.requestId, "string");
  assert.equal(typeof failure.error.message, "string");
  assert.equal(typeof failure.error.retryable, "boolean");
}
