import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { GET as getControlBrief } from "../../src/app/api/workspaces/current/control/brief/route";
import { POST as postRecoveryEvidence } from "../../src/app/api/workspaces/current/evidence/route";
import { PUT as putControlPolicy } from "../../src/app/api/workspaces/current/control/policy/route";
import { POST as postControlProposal } from "../../src/app/api/workspaces/current/control/proposals/route";
import { POST as postControlDecision } from "../../src/app/api/workspaces/current/control/proposals/[proposalId]/decision/route";
import { POST as postControlReconciliation } from "../../src/app/api/workspaces/current/control/proposals/[proposalId]/reconciliations/route";
import { GET as getControlReconciliationCandidates } from "../../src/app/api/workspaces/current/control/proposals/[proposalId]/reconciliation-candidates/route";
import {
  isCommitmentControlBriefDto,
  isControlDecisionWriteDto,
  isControlPolicyWriteDto,
  isControlProposalWriteDto,
  isControlReconciliationWriteDto,
} from "../../src/lib/commitment-control/contracts";
import type { ApiFailure, ApiSuccess } from "../../src/lib/recovery/contracts";
import { getDatabasePool } from "../../src/lib/server/database";
import { createSessionCookie } from "../../src/lib/server/session";
import { completeControlPolicyRequest, futureControlTestDate, testControlOutcome } from "../commitment-control-policy-fixture";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const baseUrl = "https://vognary.test";
const futureFirstChargeDate = futureControlTestDate(0);
const outcomeReviewOn = futureControlTestDate(0);
process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS = "*";

test("Commitment Control HTTP routes preserve auth, RBAC, ETags, and the complete control loop", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const memberUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  await pool.query(
    `insert into users (id, email, display_name) values
       ($1, $2, 'Control route owner'),
       ($3, $4, 'Control route member')`,
    [ownerUserId, `control-route-owner-${suffix}@example.test`, memberUserId, `control-route-member-${suffix}@example.test`],
  );
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Control route workspace')`, [workspaceId, ownerUserId]);
  await pool.query(
    `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member')`,
    [workspaceId, ownerUserId, memberUserId],
  );
  await pool.query(
    `insert into recovery_notification_preferences (workspace_id, user_id, product_emails)
     values ($1, $2, true)`,
    [workspaceId, ownerUserId],
  );

  const attentionStates = async () => (await pool.query<{ attention_kind: string; delivery_state: string }>(
    `select attention_kind, delivery_state
     from commitment_control_attention_notifications
     where workspace_id = $1
     order by attention_kind, delivery_state`,
    [workspaceId],
  )).rows;

  try {
    const ownerCookie = await createSessionCookie({ userId: ownerUserId, workspaceId });
    const memberCookie = await createSessionCookie({ userId: memberUserId, workspaceId });
    const ownerCookieHeader = `${ownerCookie.name}=${encodeURIComponent(ownerCookie.value)}`;
    const memberCookieHeader = `${memberCookie.name}=${encodeURIComponent(memberCookie.value)}`;
    const headers = (cookie: string, version: number, idempotencyKey: string) => ({
      cookie,
      origin: baseUrl,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      "if-match": `"workspace:${version}"`,
    });

    const unauthenticated = await getControlBrief(new Request(`${baseUrl}/api/workspaces/current/control/brief`));
    assert.equal(unauthenticated.status, 401);

    process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS = "b1000000-0000-4000-8000-000000000001";
    const notEnrolled = await getControlBrief(new Request(`${baseUrl}/api/workspaces/current/control/brief`, {
      headers: { cookie: ownerCookieHeader },
    }));
    assert.equal(notEnrolled.status, 503);
    assert.equal((await notEnrolled.json() as ApiFailure).error.code, "FEATURE_UNAVAILABLE");
    process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS = "*";

    const previousNodeEnv = process.env.NODE_ENV;
    Reflect.set(process.env, "NODE_ENV", "production");
    process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS = workspaceId;
    process.env.COMMITMENT_CONTROL_PAID_WORKSPACE_IDS = workspaceId;
    try {
      const assessmentBlocked = await getControlBrief(new Request(`${baseUrl}/api/workspaces/current/control/brief`, {
        headers: { cookie: ownerCookieHeader },
      }));
      assert.equal(assessmentBlocked.status, 503);
      assert.equal((await assessmentBlocked.json() as ApiFailure).error.code, "FEATURE_UNAVAILABLE");
    } finally {
      if (previousNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
      else Reflect.set(process.env, "NODE_ENV", previousNodeEnv);
      process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS = "*";
      delete process.env.COMMITMENT_CONTROL_PAID_WORKSPACE_IDS;
    }

    const crossSite = await putControlPolicy(new Request(`${baseUrl}/api/workspaces/current/control/policy`, {
      method: "PUT",
      headers: {
        ...headers(ownerCookieHeader, 0, `control-route-cross-${suffix}`),
        origin: "https://attacker.test",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ categoryRules: [], currencyLimits: [] }),
    }));
    assert.equal(crossSite.status, 403);

    const oversized = await putControlPolicy(new Request(`${baseUrl}/api/workspaces/current/control/policy`, {
      method: "PUT",
      headers: headers(ownerCookieHeader, 0, `control-route-oversized-${suffix}`),
      body: JSON.stringify({ categoryRules: [], currencyLimits: [], padding: "x".repeat(70 * 1024) }),
    }));
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json() as ApiFailure).error.code, "REQUEST_TOO_LARGE");

    const incomplete = await putControlPolicy(new Request(`${baseUrl}/api/workspaces/current/control/policy`, {
      method: "PUT",
      headers: headers(ownerCookieHeader, 0, `control-route-incomplete-${suffix}`),
      body: JSON.stringify({
        categoryRules: [{ category: "AI_MODEL", posture: "ALLOW" }],
        currencyLimits: [{
          currency: "INR",
          maxPerChargeMinor: "500000",
          maxThirteenWeekMinor: "3000000",
          maxAnnualMinor: "12000000",
        }],
      }),
    }));
    assert.equal(incomplete.status, 400);
    assert.equal((await incomplete.json() as ApiFailure).error.code, "INVALID_EVIDENCE");

    const policyRequest = () => new Request(`${baseUrl}/api/workspaces/current/control/policy`, {
      method: "PUT",
      headers: headers(ownerCookieHeader, 0, `control-route-policy-${suffix}`),
      body: JSON.stringify(completeControlPolicyRequest()),
    });
    const policy = await putControlPolicy(policyRequest());
    assert.equal(policy.status, 201);
    assert.equal(policy.headers.get("etag"), '"workspace:1"');
    assert.equal(isControlPolicyWriteDto((await policy.clone().json() as ApiSuccess<unknown>).data), true);
    const policyReplay = await putControlPolicy(policyRequest());
    assert.equal(policyReplay.status, 200);
    assert.equal(policyReplay.headers.get("etag"), '"workspace:1"');

    const proposed = await postControlProposal(new Request(`${baseUrl}/api/workspaces/current/control/proposals`, {
      method: "POST",
      headers: headers(memberCookieHeader, 1, `control-route-proposal-${suffix}`),
      body: JSON.stringify({
        merchant: "OpenAI",
        purpose: "Production model capacity",
        category: "AI_MODEL",
        amountMinor: "199900",
        currency: "INR",
        firstChargeDate: futureFirstChargeDate,
        cadence: "MONTHLY",
        existingCommitmentIds: [],
        intendedOutcome: testControlOutcome({ reviewOn: outcomeReviewOn }),
      }),
    }));
    assert.equal(proposed.status, 201);
    const proposalPayload = await proposed.json() as ApiSuccess<{ proposal: { id: string }; evaluation: { status: string } }>;
    assert.equal(isControlProposalWriteDto(proposalPayload.data), true);
    assert.equal(proposalPayload.meta.workspaceVersion, 2);
    assert.equal(proposalPayload.meta.attentionProjection, "scheduled");
    assert.equal(proposalPayload.data.evaluation.status, "WITHIN_POLICY");
    const proposalId = proposalPayload.data.proposal.id;
    assert.deepEqual(await attentionStates(), [{ attention_kind: "DECISION_REQUIRED", delivery_state: "QUEUED" }]);

    const memberDecision = await postControlDecision(new Request(`${baseUrl}/api/workspaces/current/control/proposals/${proposalId}/decision`, {
      method: "POST",
      headers: headers(memberCookieHeader, 2, `control-route-member-decision-${suffix}`),
      body: JSON.stringify({ action: "APPROVE", authorizationExpiresOn: outcomeReviewOn }),
    }), { params: Promise.resolve({ proposalId }) });
    assert.equal(memberDecision.status, 403);
    assert.equal((await memberDecision.json() as ApiFailure).error.code, "FORBIDDEN");

    const decided = await postControlDecision(new Request(`${baseUrl}/api/workspaces/current/control/proposals/${proposalId}/decision`, {
      method: "POST",
      headers: headers(ownerCookieHeader, 2, `control-route-owner-decision-${suffix}`),
      body: JSON.stringify({
        action: "APPROVE_WITH_CAP",
        approvedCapMinor: "180000",
        authorizationExpiresOn: outcomeReviewOn,
      }),
    }), { params: Promise.resolve({ proposalId }) });
    assert.equal(decided.status, 201);
    assert.equal(decided.headers.get("etag"), '"workspace:3"');
    const decisionPayload = await decided.json() as ApiSuccess<unknown>;
    assert.equal(isControlDecisionWriteDto(decisionPayload.data), true);
    assert.equal(decisionPayload.meta.attentionProjection, "scheduled");
    assert.deepEqual(await attentionStates(), [
      { attention_kind: "DECISION_REQUIRED", delivery_state: "CANCELLED" },
      { attention_kind: "EVIDENCE_DUE", delivery_state: "QUEUED" },
    ]);

    await pool.query(`delete from commitment_control_attention_notifications where workspace_id = $1`, [workspaceId]);
    const evidenceResponse = await postRecoveryEvidence(new Request(`${baseUrl}/api/workspaces/current/evidence`, {
      method: "POST",
      headers: headers(ownerCookieHeader, 3, `control-route-evidence-${suffix}`),
      body: JSON.stringify({
        kind: "RECEIPT_PASTE",
        receipts: [{ clientRef: "openai-observed", text: `OpenAI invoice paid INR 1,999.00 on ${futureFirstChargeDate}. Monthly.` }],
      }),
    }));
    assert.equal(evidenceResponse.status, 201);
    const evidencePayload = await evidenceResponse.json() as ApiSuccess<unknown>;
    assert.equal(evidencePayload.meta.attentionProjection, "scheduled");
    assert.deepEqual(await attentionStates(), [
      { attention_kind: "EVIDENCE_DUE", delivery_state: "QUEUED" },
    ]);
    const evidenceId = (await pool.query<{ id: string }>(
      `select id from recovery_evidence where workspace_id = $1 order by created_at desc limit 1`,
      [workspaceId],
    )).rows[0]?.id;
    assert.ok(evidenceId);

    const candidates = await getControlReconciliationCandidates(new Request(
      `${baseUrl}/api/workspaces/current/control/proposals/${proposalId}/reconciliation-candidates`,
      { headers: { cookie: ownerCookieHeader } },
    ), { params: Promise.resolve({ proposalId }) });
    assert.equal(candidates.status, 200);
    const candidatePayload = await candidates.json() as ApiSuccess<{
      proposalId: string;
      matchingPerformed: false;
      candidates: Array<{
        evidenceId: string;
        observedCurrency: string;
        basis: string;
        requiresHumanConfirmation: boolean;
      }>;
    }>;
    assert.equal(candidatePayload.data.proposalId, proposalId);
    assert.equal(candidatePayload.data.matchingPerformed, false);
    assert.deepEqual(candidatePayload.data.candidates.map((candidate) => ({
      evidenceId: candidate.evidenceId,
      observedCurrency: candidate.observedCurrency,
      basis: candidate.basis,
      requiresHumanConfirmation: candidate.requiresHumanConfirmation,
    })), [{
      evidenceId,
      observedCurrency: "INR",
      basis: "SAME_CURRENCY_WITHIN_AUTHORIZATION_WINDOW",
      requiresHumanConfirmation: true,
    }]);

    const reconciled = await postControlReconciliation(new Request(`${baseUrl}/api/workspaces/current/control/proposals/${proposalId}/reconciliations`, {
      method: "POST",
      headers: headers(ownerCookieHeader, evidencePayload.meta.workspaceVersion ?? 0, `control-route-reconcile-${suffix}`),
      body: JSON.stringify({
        evidenceId,
        observedOutcome: { value: "12", observedOn: outcomeReviewOn },
      }),
    }), { params: Promise.resolve({ proposalId }) });
    assert.equal(reconciled.status, 201);
    const reconciliationPayload = await reconciled.json() as ApiSuccess<{
      reconciliation: { verdict: string; outcome: { verdict: string } | null };
    }>;
    assert.equal(isControlReconciliationWriteDto(reconciliationPayload.data), true);
    assert.equal(reconciliationPayload.data.reconciliation.verdict, "OVER_CAP");
    assert.equal(reconciliationPayload.data.reconciliation.outcome?.verdict, "MET");
    assert.equal(reconciliationPayload.meta.workspaceVersion, 5);
    assert.equal(reconciliationPayload.meta.attentionProjection, "scheduled");
    assert.deepEqual(await attentionStates(), [
      { attention_kind: "EVIDENCE_DUE", delivery_state: "CANCELLED" },
      { attention_kind: "RECONCILIATION_EXCEPTION", delivery_state: "QUEUED" },
    ]);
    const noCandidates = await getControlReconciliationCandidates(new Request(
      `${baseUrl}/api/workspaces/current/control/proposals/${proposalId}/reconciliation-candidates`,
      { headers: { cookie: ownerCookieHeader } },
    ), { params: Promise.resolve({ proposalId }) });
    assert.deepEqual((await noCandidates.json() as ApiSuccess<{ candidates: unknown[] }>).data.candidates, []);

    const brief = await getControlBrief(new Request(`${baseUrl}/api/workspaces/current/control/brief`, {
      headers: { cookie: memberCookieHeader },
    }));
    assert.equal(brief.status, 200);
    const briefPayload = await brief.json() as ApiSuccess<{
      capabilities: { canDecide: boolean };
      proposals: Array<{
        proposal: { intendedOutcome: { targetValue: string } | null };
        decision: { approvedCapMinor: string; authorizationExpiresOn: string | null } | null;
        reconciliations: Array<{ verdict: string; outcome: { verdict: string } | null }>;
      }>;
    }>;
    assert.equal(isCommitmentControlBriefDto(briefPayload.data), true);
    assert.equal(briefPayload.data.capabilities.canDecide, false);
    assert.equal(briefPayload.data.proposals[0]?.decision?.approvedCapMinor, "180000");
    assert.equal(briefPayload.data.proposals[0]?.proposal.intendedOutcome?.targetValue, "10");
    assert.equal(briefPayload.data.proposals[0]?.decision?.authorizationExpiresOn, outcomeReviewOn);
    assert.equal(briefPayload.data.proposals[0]?.reconciliations[0]?.verdict, "OVER_CAP");
    assert.equal(briefPayload.data.proposals[0]?.reconciliations[0]?.outcome?.verdict, "MET");

    await pool.query(
      `delete from workspace_members where workspace_id = $1 and user_id = $2`,
      [workspaceId, memberUserId],
    );
    const removedMember = await getControlBrief(new Request(`${baseUrl}/api/workspaces/current/control/brief`, {
      headers: { cookie: memberCookieHeader },
    }));
    assert.equal(removedMember.status, 401);
    assert.equal((await removedMember.json() as ApiFailure).error.code, "AUTH_REQUIRED");
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]).catch(() => undefined);
    await pool.query(`delete from users where id = any($1::uuid[])`, [[ownerUserId, memberUserId]]).catch(() => undefined);
  }
});