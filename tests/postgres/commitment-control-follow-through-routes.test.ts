import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { GET as getControlBrief } from "../../src/app/api/workspaces/current/control/brief/route";
import { PUT as putControlPolicy } from "../../src/app/api/workspaces/current/control/policy/route";
import { POST as postControlProposal } from "../../src/app/api/workspaces/current/control/proposals/route";
import { POST as postControlDecision } from "../../src/app/api/workspaces/current/control/proposals/[proposalId]/decision/route";
import { POST as postControlOutcome } from "../../src/app/api/workspaces/current/control/proposals/[proposalId]/outcome/route";
import { POST as postControlExceptionReview } from "../../src/app/api/workspaces/current/control/proposals/[proposalId]/exception-reviews/route";
import {
  isCommitmentControlBriefDto,
  isControlExceptionReviewWriteDto,
  isControlOutcomeObservationWriteDto,
} from "../../src/lib/commitment-control/contracts";
import type { ApiFailure, ApiSuccess } from "../../src/lib/recovery/contracts";
import { getDatabasePool } from "../../src/lib/server/database";
import { createSessionCookie } from "../../src/lib/server/session";
import { completeControlPolicyRequest, futureControlTestDate, testControlOutcome } from "../commitment-control-policy-fixture";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const baseUrl = "https://vognary.test";
const today = futureControlTestDate(0);
process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS = "*";

test("the follow-through routes require auth, an admin, CSRF safety, a bounded body, a version, and an idempotency key", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const memberUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  await pool.query(
    `insert into users (id, email, display_name) values ($1, $2, 'Follow-through route owner'), ($3, $4, 'Follow-through route member')`,
    [ownerUserId, `follow-route-owner-${suffix}@example.test`, memberUserId, `follow-route-member-${suffix}@example.test`],
  );
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Follow-through route workspace')`, [workspaceId, ownerUserId]);
  await pool.query(
    `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member')`,
    [workspaceId, ownerUserId, memberUserId],
  );

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

    await putControlPolicy(new Request(`${baseUrl}/api/workspaces/current/control/policy`, {
      method: "PUT",
      headers: headers(ownerCookieHeader, 0, `follow-route-policy-${suffix}`),
      body: JSON.stringify(completeControlPolicyRequest()),
    }));
    const proposed = await postControlProposal(new Request(`${baseUrl}/api/workspaces/current/control/proposals`, {
      method: "POST",
      headers: headers(ownerCookieHeader, 1, `follow-route-proposal-${suffix}`),
      body: JSON.stringify({
        merchant: "OpenAI",
        purpose: "Production model capacity",
        category: "AI_MODEL",
        amountMinor: "199900",
        currency: "INR",
        firstChargeDate: today,
        cadence: "MONTHLY",
        existingCommitmentIds: [],
        intendedOutcome: testControlOutcome({ reviewOn: today }),
      }),
    }));
    const proposalId = (await proposed.json() as ApiSuccess<{ proposal: { id: string } }>).data.proposal.id;
    await postControlDecision(new Request(`${baseUrl}/api/workspaces/current/control/proposals/${proposalId}/decision`, {
      method: "POST",
      headers: headers(ownerCookieHeader, 2, `follow-route-decision-${suffix}`),
      body: JSON.stringify({ action: "APPROVE_WITH_CAP", approvedCapMinor: "180000", authorizationExpiresOn: today }),
    }), { params: Promise.resolve({ proposalId }) });

    const params = { params: Promise.resolve({ proposalId }) };
    const outcomeUrl = `${baseUrl}/api/workspaces/current/control/proposals/${proposalId}/outcome`;
    const reviewUrl = `${baseUrl}/api/workspaces/current/control/proposals/${proposalId}/exception-reviews`;

    const unauthenticated = await postControlOutcome(new Request(outcomeUrl, {
      method: "POST",
      headers: { origin: baseUrl, "content-type": "application/json", "idempotency-key": `follow-route-anon-${suffix}`, "if-match": '"workspace:3"' },
      body: JSON.stringify({ observedOutcome: { value: "12", observedOn: today } }),
    }), params);
    assert.equal(unauthenticated.status, 401);

    const crossSite = await postControlOutcome(new Request(outcomeUrl, {
      method: "POST",
      headers: {
        ...headers(ownerCookieHeader, 3, `follow-route-cross-${suffix}`),
        origin: "https://attacker.test",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ observedOutcome: { value: "12", observedOn: today } }),
    }), params);
    assert.equal(crossSite.status, 403);

    const oversized = await postControlOutcome(new Request(outcomeUrl, {
      method: "POST",
      headers: headers(ownerCookieHeader, 3, `follow-route-oversized-${suffix}`),
      body: JSON.stringify({ observedOutcome: { value: "12", observedOn: today }, padding: "x".repeat(70 * 1024) }),
    }), params);
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json() as ApiFailure).error.code, "REQUEST_TOO_LARGE");

    const staleVersion = await postControlOutcome(new Request(outcomeUrl, {
      method: "POST",
      headers: headers(ownerCookieHeader, 1, `follow-route-stale-${suffix}`),
      body: JSON.stringify({ observedOutcome: { value: "12", observedOn: today } }),
    }), params);
    assert.equal(staleVersion.status, 412);
    assert.equal((await staleVersion.json() as ApiFailure).error.code, "STALE_STATE");

    const noKey = await postControlOutcome(new Request(outcomeUrl, {
      method: "POST",
      headers: { cookie: ownerCookieHeader, origin: baseUrl, "content-type": "application/json", "if-match": '"workspace:3"' },
      body: JSON.stringify({ observedOutcome: { value: "12", observedOn: today } }),
    }), params);
    assert.equal(noKey.status, 400);
    assert.equal((await noKey.json() as ApiFailure).error.code, "INVALID_EVIDENCE");

    const memberOutcome = await postControlOutcome(new Request(outcomeUrl, {
      method: "POST",
      headers: headers(memberCookieHeader, 3, `follow-route-member-outcome-${suffix}`),
      body: JSON.stringify({ observedOutcome: { value: "12", observedOn: today } }),
    }), params);
    assert.equal(memberOutcome.status, 403);
    assert.equal((await memberOutcome.json() as ApiFailure).error.code, "FORBIDDEN");

    const evidenceRejected = await postControlOutcome(new Request(outcomeUrl, {
      method: "POST",
      headers: headers(ownerCookieHeader, 3, `follow-route-evidence-${suffix}`),
      body: JSON.stringify({ observedOutcome: { value: "12", observedOn: today }, evidenceId: randomUUID() }),
    }), params);
    assert.equal(evidenceRejected.status, 400);

    const recordOutcome = () => new Request(outcomeUrl, {
      method: "POST",
      headers: headers(ownerCookieHeader, 3, `follow-route-outcome-${suffix}`),
      body: JSON.stringify({ observedOutcome: { value: "4", observedOn: today } }),
    });
    const recorded = await postControlOutcome(recordOutcome(), params);
    assert.equal(recorded.status, 201);
    assert.equal(recorded.headers.get("etag"), '"workspace:4"');
    const recordedPayload = await recorded.json() as ApiSuccess<{ observation: { id: string; verdict: string } }>;
    assert.equal(isControlOutcomeObservationWriteDto(recordedPayload.data), true);
    assert.equal(recordedPayload.data.observation.verdict, "MISSED");
    assert.equal(recordedPayload.meta.attentionProjection, "scheduled");
    const observationId = recordedPayload.data.observation.id;

    const replayed = await postControlOutcome(recordOutcome(), params);
    assert.equal(replayed.status, 200);
    assert.equal(replayed.headers.get("etag"), '"workspace:4"');
    assert.equal((await replayed.json() as ApiSuccess<{ observation: { id: string } }>).data.observation.id, observationId);

    const memberReview = await postControlExceptionReview(new Request(reviewUrl, {
      method: "POST",
      headers: headers(memberCookieHeader, 4, `follow-route-member-review-${suffix}`),
      body: JSON.stringify({
        targetKind: "OUTCOME_OBSERVATION",
        targetId: observationId,
        disposition: "NO_FURTHER_ACTION",
        note: "A member must not record a disposition.",
      }),
    }), params);
    assert.equal(memberReview.status, 403);

    const unknownDisposition = await postControlExceptionReview(new Request(reviewUrl, {
      method: "POST",
      headers: headers(ownerCookieHeader, 4, `follow-route-bad-disposition-${suffix}`),
      body: JSON.stringify({
        targetKind: "OUTCOME_OBSERVATION",
        targetId: observationId,
        disposition: "AUTO_RESOLVE",
        note: "Vognary never resolves anything on its own.",
      }),
    }), params);
    assert.equal(unknownDisposition.status, 400);
    assert.equal((await unknownDisposition.json() as ApiFailure).error.code, "INVALID_EVIDENCE");

    const recordReview = () => new Request(reviewUrl, {
      method: "POST",
      headers: headers(ownerCookieHeader, 4, `follow-route-review-${suffix}`),
      body: JSON.stringify({
        targetKind: "OUTCOME_OBSERVATION",
        targetId: observationId,
        disposition: "NEW_PROPOSAL_REQUIRED",
        note: "The target was missed; a fresh proposal will restate it.",
      }),
    });
    const reviewed = await postControlExceptionReview(recordReview(), params);
    assert.equal(reviewed.status, 201);
    assert.equal(reviewed.headers.get("etag"), '"workspace:5"');
    const reviewPayload = await reviewed.json() as ApiSuccess<{ review: { id: string; targetKind: string } }>;
    assert.equal(isControlExceptionReviewWriteDto(reviewPayload.data), true);
    assert.equal(reviewPayload.data.review.targetKind, "OUTCOME_OBSERVATION");
    assert.equal(reviewPayload.meta.attentionProjection, "scheduled");

    const reviewReplay = await postControlExceptionReview(recordReview(), params);
    assert.equal(reviewReplay.status, 200);
    assert.equal((await reviewReplay.json() as ApiSuccess<{ review: { id: string } }>).data.review.id, reviewPayload.data.review.id);

    const brief = await getControlBrief(new Request(`${baseUrl}/api/workspaces/current/control/brief`, {
      headers: { cookie: memberCookieHeader },
    }));
    assert.equal(brief.status, 200);
    const briefPayload = await brief.json() as ApiSuccess<{
      proposals: Array<{
        outcomeObservations: Array<{ verdict: string; observationBasis: string; target: { reviewOn: string } }>;
        exceptionReviews: Array<{ targetKind: string; disposition: string; note: string }>;
      }>;
    }>;
    assert.equal(isCommitmentControlBriefDto(briefPayload.data), true);
    assert.equal(briefPayload.data.proposals[0]?.outcomeObservations[0]?.verdict, "MISSED");
    assert.equal(briefPayload.data.proposals[0]?.outcomeObservations[0]?.observationBasis, "USER_ENTERED_OBSERVATION");
    assert.equal(briefPayload.data.proposals[0]?.outcomeObservations[0]?.target.reviewOn, today);
    assert.equal(briefPayload.data.proposals[0]?.exceptionReviews[0]?.disposition, "NEW_PROPOSAL_REQUIRED");
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]).catch(() => undefined);
    await pool.query(`delete from users where id = any($1::uuid[])`, [[ownerUserId, memberUserId]]).catch(() => undefined);
  }
});
