import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { GET as getControlBrief } from "../../src/app/api/workspaces/current/control/brief/route";
import { PUT as putControlPolicy } from "../../src/app/api/workspaces/current/control/policy/route";
import { POST as postControlProposal } from "../../src/app/api/workspaces/current/control/proposals/route";
import { POST as postControlDecision } from "../../src/app/api/workspaces/current/control/proposals/[proposalId]/decision/route";
import { POST as postControlReconciliation } from "../../src/app/api/workspaces/current/control/proposals/[proposalId]/reconciliations/route";
import {
  isCommitmentControlBriefDto,
  isControlDecisionWriteDto,
  isControlPolicyWriteDto,
  isControlProposalWriteDto,
  isControlReconciliationWriteDto,
} from "../../src/lib/commitment-control/contracts";
import type { ApiFailure, ApiSuccess } from "../../src/lib/recovery/contracts";
import { getDatabasePool } from "../../src/lib/server/database";
import { submitRecoveryEvidence } from "../../src/lib/server/recovery-store";
import { createSessionCookie } from "../../src/lib/server/session";
import { completeControlPolicyRequest } from "../commitment-control-policy-fixture";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const baseUrl = "https://vognary.test";
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
        firstChargeDate: "2026-09-01",
        cadence: "MONTHLY",
        existingCommitmentIds: [],
      }),
    }));
    assert.equal(proposed.status, 201);
    const proposalPayload = await proposed.json() as ApiSuccess<{ proposal: { id: string }; evaluation: { status: string } }>;
    assert.equal(isControlProposalWriteDto(proposalPayload.data), true);
    assert.equal(proposalPayload.meta.workspaceVersion, 2);
    assert.equal(proposalPayload.data.evaluation.status, "WITHIN_POLICY");
    const proposalId = proposalPayload.data.proposal.id;

    const memberDecision = await postControlDecision(new Request(`${baseUrl}/api/workspaces/current/control/proposals/${proposalId}/decision`, {
      method: "POST",
      headers: headers(memberCookieHeader, 2, `control-route-member-decision-${suffix}`),
      body: JSON.stringify({ action: "APPROVE" }),
    }), { params: Promise.resolve({ proposalId }) });
    assert.equal(memberDecision.status, 403);
    assert.equal((await memberDecision.json() as ApiFailure).error.code, "FORBIDDEN");

    const decided = await postControlDecision(new Request(`${baseUrl}/api/workspaces/current/control/proposals/${proposalId}/decision`, {
      method: "POST",
      headers: headers(ownerCookieHeader, 2, `control-route-owner-decision-${suffix}`),
      body: JSON.stringify({ action: "APPROVE_WITH_CAP", approvedCapMinor: "180000" }),
    }), { params: Promise.resolve({ proposalId }) });
    assert.equal(decided.status, 201);
    assert.equal(decided.headers.get("etag"), '"workspace:3"');
    assert.equal(isControlDecisionWriteDto((await decided.clone().json() as ApiSuccess<unknown>).data), true);

    const evidence = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 3,
      idempotencyKey: `control-route-evidence-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{ clientRef: "openai-observed", text: "OpenAI invoice paid INR 1,999.00 on 1 September 2026. Monthly." }],
      },
      now: new Date("2026-09-01T09:00:00.000Z"),
    });
    const evidenceId = (await pool.query<{ id: string }>(
      `select id from recovery_evidence where workspace_id = $1 order by created_at desc limit 1`,
      [workspaceId],
    )).rows[0]?.id;
    assert.ok(evidenceId);

    const reconciled = await postControlReconciliation(new Request(`${baseUrl}/api/workspaces/current/control/proposals/${proposalId}/reconciliations`, {
      method: "POST",
      headers: headers(ownerCookieHeader, evidence.workspaceVersion, `control-route-reconcile-${suffix}`),
      body: JSON.stringify({ evidenceId }),
    }), { params: Promise.resolve({ proposalId }) });
    assert.equal(reconciled.status, 201);
    const reconciliationPayload = await reconciled.json() as ApiSuccess<{ reconciliation: { verdict: string } }>;
    assert.equal(isControlReconciliationWriteDto(reconciliationPayload.data), true);
    assert.equal(reconciliationPayload.data.reconciliation.verdict, "OVER_CAP");
    assert.equal(reconciliationPayload.meta.workspaceVersion, 5);

    const brief = await getControlBrief(new Request(`${baseUrl}/api/workspaces/current/control/brief`, {
      headers: { cookie: memberCookieHeader },
    }));
    assert.equal(brief.status, 200);
    const briefPayload = await brief.json() as ApiSuccess<{
      capabilities: { canDecide: boolean };
      proposals: Array<{ decision: { approvedCapMinor: string } | null; reconciliations: Array<{ verdict: string }> }>;
    }>;
    assert.equal(isCommitmentControlBriefDto(briefPayload.data), true);
    assert.equal(briefPayload.data.capabilities.canDecide, false);
    assert.equal(briefPayload.data.proposals[0]?.decision?.approvedCapMinor, "180000");
    assert.equal(briefPayload.data.proposals[0]?.reconciliations[0]?.verdict, "OVER_CAP");
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]).catch(() => undefined);
    await pool.query(`delete from users where id = any($1::uuid[])`, [[ownerUserId, memberUserId]]).catch(() => undefined);
  }
});