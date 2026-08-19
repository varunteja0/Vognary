import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { GET as getHome } from "../../src/app/api/workspaces/current/brief/route";
import { GET as getCommitment } from "../../src/app/api/workspaces/current/commitments/[commitmentId]/route";
import { PUT as putDecision } from "../../src/app/api/workspaces/current/decisions/route";
import { POST as submitEvidence } from "../../src/app/api/workspaces/current/evidence/route";
import type {
  ApiFailure,
  ApiSuccess,
  CommitmentDetailDto,
  HomeProjectionDto,
  PutDecisionResponse,
} from "../../src/lib/recovery/contracts";
import { getDatabasePool } from "../../src/lib/server/database";
import { createSessionCookie } from "../../src/lib/server/session";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const baseUrl = "https://vognary.test";

test("decision cycles persist per due date, stay tenant-isolated, and publish Home queue/outcomes", {
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
       ($1, $2, 'Decision owner'),
       ($3, $4, 'Other decision owner')`,
    [ownerUserId, `recovery-cycle-${suffix}@example.test`, otherUserId, `recovery-cycle-other-${suffix}@example.test`],
  );
  await pool.query(
    `insert into workspaces (id, owner_user_id, name) values
       ($1, $2, 'Decision workspace'),
       ($3, $4, 'Other decision workspace')`,
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
      headers: mutationHeaders(0, `cycle-evidence-${suffix}`),
      body: JSON.stringify({
        kind: "RECEIPT_PASTE",
        receipts: [
          {
            clientRef: "openai-july",
            text: "From: OpenAI; Invoice date: 6 July 2026; ChatGPT Plus monthly subscription. Amount: INR 1,999.00; Next billing date: 6 August 2026.",
          },
          {
            clientRef: "openai-august",
            text: "From: OpenAI; Invoice date: 6 August 2026; ChatGPT Plus monthly subscription. Amount: INR 2,499.00; Next billing date: 6 September 2026.",
          },
          {
            clientRef: "anthropic-july",
            text: "Anthropic invoice paid INR 2,499.00 on 6 July 2026. Claude Pro renews monthly.",
          },
          {
            clientRef: "anthropic-august",
            text: "Anthropic invoice paid INR 2,499.00 on 6 August 2026. Claude Pro renews monthly on 6 September 2026.",
          },
        ],
      }),
    }));
    assert.equal(submitted.status, 201);
    const submittedPayload = await submitted.json() as ApiSuccess<{ home: HomeProjectionDto }>;
    assert.ok(submittedPayload.data.home.decisionQueue.length >= 1);
    const openaiCard = submittedPayload.data.home.decisionQueue.find((card) => /openai|chatgpt/i.test(card.merchant));
    assert.ok(openaiCard);
    assert.ok(openaiCard.reasonKeys.includes("PRICE_INCREASE") || openaiCard.reasonKeys.includes("OVERLAP_NO_PURPOSE") || openaiCard.reasonKeys.includes("RENEWS_SOON"));
    assert.match(openaiCard.charge.display, /₹/);
    assert.doesNotMatch(JSON.stringify(submittedPayload.data.home.decisionOutcomes), /Cancelled/);

    const keepRequest = () => new Request(`${baseUrl}/api/workspaces/current/decisions`, {
      method: "PUT",
      headers: mutationHeaders(1, `cycle-keep-${suffix}`),
      body: JSON.stringify({ commitmentId: openaiCard.commitmentId, action: "KEEP" }),
    });
    const kept = await putDecision(keepRequest());
    assert.equal(kept.status, 200);
    const keptPayload = await kept.json() as PutDecisionResponse;
    assert.equal(keptPayload.data.decision.value, "KEEP");
    assert.equal(keptPayload.data.commitment.cycle?.action, "KEEP");
    assert.equal(keptPayload.data.home.decisionQueue.some((card) => card.commitmentId === openaiCard.commitmentId), false);

    const replay = await putDecision(keepRequest());
    assert.equal(replay.status, 200);
    const replayPayload = await replay.json() as PutDecisionResponse;
    assert.equal(replayPayload.meta.workspaceVersion, keptPayload.meta.workspaceVersion);

    const unique = await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_decision_cycles
       where workspace_id = $1 and commitment_id = $2 and due_date = $3::date`,
      [workspaceId, openaiCard.commitmentId, openaiCard.dueDate],
    );
    assert.equal(unique.rows[0]?.n, "1");

    const leaked = await pool.query<{ n: string }>(
      `select count(*)::text as n from recovery_decision_cycles where workspace_id = $1`,
      [otherWorkspaceId],
    );
    assert.equal(leaked.rows[0]?.n, "0");

    const foreign = await putDecision(new Request(`${baseUrl}/api/workspaces/current/decisions`, {
      method: "PUT",
      headers: mutationHeaders(0, `cycle-foreign-${suffix}`, otherCookieHeader),
      body: JSON.stringify({ commitmentId: openaiCard.commitmentId, action: "PLAN_TO_CANCEL" }),
    }));
    assert.equal(foreign.status, 404);
    assertContractFailure(await foreign.json(), "NOT_FOUND");

    const remaining = keptPayload.data.home.decisionQueue.find((card) => card.commitmentId !== openaiCard.commitmentId);
    if (remaining) {
      const cancel = await putDecision(new Request(`${baseUrl}/api/workspaces/current/decisions`, {
        method: "PUT",
        headers: mutationHeaders(keptPayload.meta.workspaceVersion, `cycle-cancel-${suffix}`),
        body: JSON.stringify({ commitmentId: remaining.commitmentId, action: "PLAN_TO_CANCEL" }),
      }));
      assert.equal(cancel.status, 200);
      const cancelPayload = await cancel.json() as PutDecisionResponse;
      assert.equal(cancelPayload.data.decision.value, "CANCEL");
      assert.equal(cancelPayload.data.home.decisionQueue.some((card) => card.commitmentId === remaining.commitmentId), false);
      assert.ok(cancelPayload.data.home.decisionOutcomes.some((outcome) => outcome.commitmentId === remaining.commitmentId));
      assert.doesNotMatch(JSON.stringify(cancelPayload.data.home.decisionOutcomes), /\bCancelled\b/);
    }

    const detail = await getCommitment(
      new Request(`${baseUrl}/api/workspaces/current/commitments/${openaiCard.commitmentId}`, { headers: { cookie: cookieHeader } }),
      { params: Promise.resolve({ commitmentId: openaiCard.commitmentId }) },
    );
    assert.equal(detail.status, 200);
    const detailPayload = await detail.json() as ApiSuccess<CommitmentDetailDto>;
    assert.ok(detailPayload.data.decisionHistory.some((item) => item.action === "KEEP"));

    const home = await getHome(new Request(`${baseUrl}/api/workspaces/current/brief`, { headers: { cookie: cookieHeader } }));
    const homePayload = await home.json() as ApiSuccess<HomeProjectionDto>;
    assert.ok(Array.isArray(homePayload.data.decisionQueue));
    assert.ok(Array.isArray(homePayload.data.decisionOutcomes));
    assert.doesNotMatch(JSON.stringify(homePayload.data), /\bCancelled\b/);

    await pool.query(`delete from recovery_decision_cycles where workspace_id = $1`, [workspaceId]);
    const backfill = await pool.query<{ user_action: string }>(
      `insert into recovery_decision_cycles (
         workspace_id, commitment_id, due_date, stake_minor, currency, reason_keys,
         user_action, review_at, decided_at, decided_by_user_id, created_at, updated_at
       )
       select
         decision.workspace_id,
         decision.commitment_id,
         (commitment.effective_next_expected_date)::date,
         case
           when commitment.effective_cadence = 'IRREGULAR' then null
           when commitment.effective_monthly_minor > 9223372036854775807 / 12 then null
           else commitment.effective_monthly_minor * 12
         end,
         commitment.base_currency,
         '{}'::text[],
         case decision.decision
           when 'KEEP' then 'KEEP'
           when 'MONITOR' then 'REVIEW_LATER'
           else 'PLAN_TO_CANCEL'
         end,
         case when decision.decision = 'MONITOR' then current_date else null end,
         decision.decided_at,
         decision.decided_by_user_id,
         now(),
         now()
       from recovery_decisions decision
       join recovery_commitments commitment
         on commitment.workspace_id = decision.workspace_id
        and commitment.id = decision.commitment_id
       where decision.workspace_id = $1
         and decision.decision in ('KEEP', 'MONITOR', 'CANCEL')
         and commitment.effective_next_expected_date is not null
       on conflict (workspace_id, commitment_id, due_date) do nothing
       returning user_action`,
      [workspaceId],
    );
    assert.ok(backfill.rowCount && backfill.rowCount >= 1);
    assert.ok(backfill.rows.some((row) => row.user_action === "KEEP"));

    await pool.query(
      `insert into recovery_decision_cycles (
         workspace_id, commitment_id, due_date, currency, reason_keys, user_action, decided_at
       ) values ($1, $2, '2026-07-06', 'INR', '{}', 'PLAN_TO_CANCEL', now())
       on conflict (workspace_id, commitment_id, due_date) do nothing`,
      [workspaceId, openaiCard.commitmentId],
    );
    const verifiedHome = await getHome(new Request(`${baseUrl}/api/workspaces/current/brief`, { headers: { cookie: cookieHeader } }));
    assert.equal(verifiedHome.status, 200);
    const verified = await pool.query<{ verification_outcome: string | null }>(
      `select verification_outcome from recovery_decision_cycles
       where workspace_id = $1 and commitment_id = $2 and due_date = '2026-07-06'`,
      [workspaceId, openaiCard.commitmentId],
    );
    assert.ok(verified.rows[0]?.verification_outcome);
    assert.doesNotMatch(verified.rows[0]?.verification_outcome ?? "", /CANCEL/);
  } finally {
    await pool.query(`delete from workspaces where id in ($1, $2)`, [workspaceId, otherWorkspaceId]);
    await pool.query(`delete from users where id in ($1, $2)`, [ownerUserId, otherUserId]);
  }
});

function assertContractFailure(payload: ApiFailure, code: ApiFailure["error"]["code"]) {
  assert.equal(payload.error.code, code);
}
