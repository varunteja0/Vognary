import assert from "node:assert/strict";
import test from "node:test";
import { commitmentControlEndpoints, type CreateControlProposalRequest } from "../src/lib/commitment-control/contracts";
import { completeControlCategoryRules, testControlOutcome } from "./commitment-control-policy-fixture";
import {
  createControlTransport,
  isFeatureUnavailable,
  isStaleWorkspace,
} from "../src/app/workspace/recovery/control/control-transport";
import type { FetchLike } from "../src/app/workspace/recovery/transport";

type Call = { path: string; init: RequestInit | undefined };

function recorder(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (path, init) => {
    const call = { path, init };
    calls.push(call);
    return handler(call);
  };
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const meta = { requestId: "request-1", workspaceVersion: 7 };
const proposalId = "6f1a1f2c-7f52-4a76-9b0c-9d5b6a7c1d20";

const proposalRequest: CreateControlProposalRequest = {
  merchant: "Anthropic",
  purpose: "Claude API",
  category: "AI_MODEL",
  amountMinor: "4500000",
  currency: "INR",
  firstChargeDate: "2026-09-01",
  cadence: "MONTHLY",
  existingCommitmentIds: [],
  intendedOutcome: testControlOutcome(),
};

test("the brief is read without a cache and returns the server payload verbatim", async () => {
  const brief = { policy: null, proposals: [], capabilities: { canSubmitProposal: true, canDecide: false, canConfigurePolicy: false } };
  const { calls, fetchImpl } = recorder(() => json({ data: brief, meta }));

  const result = await createControlTransport(fetchImpl).brief();

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data, brief);
    assert.deepEqual(result.meta, meta);
  }
  assert.equal(calls[0].path, "/api/workspaces/current/control/brief");
  assert.equal(calls[0].init?.cache, "no-store");
  assert.equal(calls[0].init?.method, undefined);
});

test("an attention projection retry status survives the success envelope", async () => {
  const brief = { policy: null, proposals: [], capabilities: { canSubmitProposal: true, canDecide: false, canConfigurePolicy: false } };
  const attentionMeta = { ...meta, attentionProjection: "pending-worker-retry" } as const;
  const { fetchImpl } = recorder(() => json({ data: brief, meta: attentionMeta }));

  const result = await createControlTransport(fetchImpl).brief();

  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.meta, attentionMeta);
});

test("every mutation carries the exact content type, idempotency key, and quoted If-Match", async () => {
  const { calls, fetchImpl } = recorder(() => json({ data: { proposal: {}, evaluation: {} }, meta }, 201));

  await createControlTransport(fetchImpl).createProposal(proposalRequest, { workspaceVersion: 6, idempotencyKey: "key-1" });

  assert.equal(calls[0].path, commitmentControlEndpoints.proposals.path);
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(calls[0].init?.headers, {
    "Content-Type": "application/json",
    "Idempotency-Key": "key-1",
    "If-Match": '"workspace:6"',
  });
  assert.equal(calls[0].init?.body, JSON.stringify(proposalRequest));
});

test("decision and reconciliation post to the encoded proposal path", async () => {
  const { calls, fetchImpl } = recorder(() => json({ data: {}, meta }, 201));
  const transport = createControlTransport(fetchImpl);

  await transport.decideProposal(proposalId, {
    action: "APPROVE_WITH_CAP",
    approvedCapMinor: "4000000",
    authorizationExpiresOn: "2099-12-30",
  }, { workspaceVersion: 6, idempotencyKey: "key-2" });
  await transport.reconcileProposal(proposalId, { evidenceId: "3c1a1f2c-7f52-4a76-9b0c-9d5b6a7c1d23" }, { workspaceVersion: 7, idempotencyKey: "key-3" });

  assert.equal(calls[0].path, `/api/workspaces/current/control/proposals/${proposalId}/decision`);
  assert.equal(calls[0].init?.body, JSON.stringify({
    action: "APPROVE_WITH_CAP",
    approvedCapMinor: "4000000",
    authorizationExpiresOn: "2099-12-30",
  }));
  assert.equal(calls[1].path, `/api/workspaces/current/control/proposals/${proposalId}/reconciliations`);
  assert.deepEqual(calls[1].init?.headers, {
    "Content-Type": "application/json",
    "Idempotency-Key": "key-3",
    "If-Match": '"workspace:7"',
  });
});

test("outcome observations and exception dispositions use versioned idempotent Control writes", async () => {
  const { calls, fetchImpl } = recorder(() => json({ data: {}, meta }, 201));
  const transport = createControlTransport(fetchImpl);

  await transport.recordOutcome(proposalId, {
    observedOutcome: { value: "900", observedOn: "2026-10-15" },
  }, { workspaceVersion: 8, idempotencyKey: "key-outcome" });
  await transport.reviewException(proposalId, {
    targetKind: "OUTCOME_OBSERVATION",
    targetId: "0a000000-0000-4000-8000-000000000001",
    disposition: "NEW_PROPOSAL_REQUIRED",
    note: "The missed target requires a fresh proposal.",
  }, { workspaceVersion: 9, idempotencyKey: "key-review" });

  assert.equal(calls[0].path, commitmentControlEndpoints.outcome(proposalId).path);
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[0].init?.headers?.["Idempotency-Key" as keyof HeadersInit], "key-outcome");
  assert.equal(calls[0].init?.headers?.["If-Match" as keyof HeadersInit], '"workspace:8"');
  assert.equal(calls[1].path, commitmentControlEndpoints.exceptionReviews(proposalId).path);
  assert.equal(calls[1].init?.method, "POST");
  assert.equal(calls[1].init?.headers?.["Idempotency-Key" as keyof HeadersInit], "key-review");
  assert.equal(calls[1].init?.headers?.["If-Match" as keyof HeadersInit], '"workspace:9"');
});

test("reconciliation candidates are read without mutation headers or merchant matching claims", async () => {
  const candidates = {
    proposalId,
    matchingPerformed: false as const,
    candidates: [{
      evidenceId: "3c1a1f2c-7f52-4a76-9b0c-9d5b6a7c1d23",
      commitmentId: "4c1a1f2c-7f52-4a76-9b0c-9d5b6a7c1d24",
      commitmentMerchant: "Synthetic vendor",
      observedAmountMinor: "4500000",
      observedCurrency: "INR",
      observedEvidenceDate: "2026-09-01",
      basis: "SAME_CURRENCY_WITHIN_AUTHORIZATION_WINDOW" as const,
      requiresHumanConfirmation: true as const,
    }],
  };
  const { calls, fetchImpl } = recorder(() => json({ data: candidates, meta }));

  const result = await createControlTransport(fetchImpl).reconciliationCandidates(proposalId);

  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data, candidates);
  assert.equal(calls[0].path, commitmentControlEndpoints.reconciliationCandidates(proposalId).path);
  assert.equal(calls[0].init?.method, undefined);
  assert.equal(calls[0].init?.cache, "no-store");
});

test("a candidate response that claims matching was performed is refused", async () => {
  const { fetchImpl } = recorder(() => json({
    data: { proposalId, matchingPerformed: true, candidates: [] },
    meta,
  }));

  const result = await createControlTransport(fetchImpl).reconciliationCandidates(proposalId);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.origin, "CLIENT");
});

test("a policy version is written with PUT and the workspace version tag", async () => {
  const { calls, fetchImpl } = recorder(() => json({ data: { policy: {} }, meta }, 201));

  await createControlTransport(fetchImpl).putPolicy(
    { categoryRules: completeControlCategoryRules, currencyLimits: [{
      currency: "INR",
      maxPerChargeMinor: "2000000",
      maxThirteenWeekMinor: "6000000",
      maxAnnualMinor: "24000000",
    }] },
    { workspaceVersion: 4, idempotencyKey: "key-policy" },
  );

  assert.equal(calls[0].path, commitmentControlEndpoints.putPolicy.path);
  assert.equal(calls[0].init?.method, "PUT");
  assert.equal(calls[0].init?.headers?.["If-Match" as keyof HeadersInit], '"workspace:4"');
});

test("a 503 FEATURE_UNAVAILABLE envelope is recognised as the private-pilot gate", async () => {
  const { fetchImpl } = recorder(() => json({
    error: { code: "FEATURE_UNAVAILABLE", message: "not enrolled", retryable: false, requestId: "request-gate" },
  }, 503));

  const result = await createControlTransport(fetchImpl).brief();

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(isFeatureUnavailable(result), true);
    assert.equal(result.origin, "SERVER");
  }
});

test("an unreachable database is a retryable failure, not a missing feature", async () => {
  const { fetchImpl } = recorder(() => json({
    error: { code: "DATABASE_UNAVAILABLE", message: "unreachable", retryable: true, requestId: "request-db" },
  }, 503));

  const result = await createControlTransport(fetchImpl).brief();

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(isFeatureUnavailable(result), false);
    assert.equal(result.error.retryable, true);
  }
});

test("a stale workspace envelope is recognised and carries the server's current version", async () => {
  const { fetchImpl } = recorder(() => json({
    error: { code: "STALE_STATE", message: "moved on", retryable: true, requestId: "request-stale", currentVersion: 9 },
  }, 412));

  const result = await createControlTransport(fetchImpl).createProposal(proposalRequest, { workspaceVersion: 6, idempotencyKey: "key-1" });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(isStaleWorkspace(result), true);
    assert.equal(result.error.code === "STALE_STATE" ? result.error.currentVersion : null, 9);
  }
});

test("an unreachable device reports a client-side failure and never invents a success", async () => {
  const fetchImpl: FetchLike = async () => {
    throw new Error("network down");
  };

  const result = await createControlTransport(fetchImpl).brief();

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.origin, "CLIENT");
    assert.equal(result.error.retryable, true);
    assert.equal(result.error.requestId, "client-device");
  }
});

test("an unrecognised success shape is refused rather than rendered as money", async () => {
  const { fetchImpl } = recorder(() => json({ proposal: {} }));

  const result = await createControlTransport(fetchImpl).brief();

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.origin, "CLIENT");
});

test("a valid envelope with malformed Control money is refused before render", async () => {
  const { fetchImpl } = recorder(() => json({
    data: {
      policy: null,
      proposals: [{
        proposal: { amountMinor: 199900 },
        evaluation: null,
        decision: null,
        reconciliations: [],
      }],
      capabilities: { canSubmitProposal: true, canDecide: true, canConfigurePolicy: true },
    },
    meta,
  }));

  const result = await createControlTransport(fetchImpl).brief();

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.origin, "CLIENT");
    assert.match(result.error.message, /shape|recognise|money/i);
  }
});

test("mutation success data must satisfy its exact Control DTO guard", async () => {
  const { fetchImpl } = recorder(() => json({ data: { proposal: {}, evaluation: {} }, meta }, 201));

  const result = await createControlTransport(fetchImpl).createProposal(
    proposalRequest,
    { workspaceVersion: 6, idempotencyKey: "key-guard" },
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.origin, "CLIENT");
});
