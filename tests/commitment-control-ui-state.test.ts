import assert from "node:assert/strict";
import test from "node:test";
import type {
  CommitmentControlBriefDto,
  ControlDecisionDto,
  ControlEvaluationDto,
  ControlExceptionReviewDto,
  ControlOutcomeObservationDto,
  ControlPolicyDto,
  ControlProposalDto,
  ControlReconciliationDto,
  CreateControlProposalRequest,
} from "../src/lib/commitment-control/contracts";
import {
  controlDecisionRequest,
  controlExceptionReviewRequest,
  controlOutcomeObservationRequest,
  controlPolicyRequest,
  controlProposalRequest,
  controlReconciliationRequest,
  controlReducer,
  initialControlState,
  policyDraftFrom,
  resolveIdempotencyKey,
  type ControlPolicyDraft,
  type ControlProposalDraft,
  type ControlState,
} from "../src/app/workspace/recovery/control/control-state";
import { formatControlMoney, parseControlAmount } from "../src/app/workspace/recovery/control/control-format";
import type { TransportFailure } from "../src/app/workspace/recovery/transport";
import { completeControlCategoryRules } from "./commitment-control-policy-fixture";

const meta = { requestId: "request-1", workspaceVersion: 7 };

const proposal: ControlProposalDto = {
  id: "6f1a1f2c-7f52-4a76-9b0c-9d5b6a7c1d20",
  submittedByUserId: "1b1a1f2c-7f52-4a76-9b0c-9d5b6a7c1d21",
  submittedByDisplayName: "Control member",
  merchant: "Anthropic",
  purpose: "Claude API for the product loop",
  category: "AI_MODEL",
  amountMinor: "4500000",
  currency: "INR",
  firstChargeDate: "2026-09-01",
  cadence: "MONTHLY",
  asOfDate: "2026-08-25",
  projectedThirteenWeekMinor: "13500000",
  projectedAnnualMinor: "54000000",
  intendedOutcome: {
    metric: "Resolved support cases",
    targetDirection: "AT_LEAST",
    targetValue: "1200",
    unit: "cases",
    reviewOn: "2026-10-15",
  },
  assumptionBasis: "USER_ENTERED_ASSUMPTION",
  createdAt: "2026-08-25T09:00:00.000Z",
};

const evaluation: ControlEvaluationDto = {
  id: "2c1a1f2c-7f52-4a76-9b0c-9d5b6a7c1d22",
  proposalId: proposal.id,
  policyVersion: 3,
  status: "OUTSIDE_POLICY",
  humanDecisionRequired: true,
  assumptionFields: ["amountMinor", "currency", "category", "thirteenWeekMinor", "annualMinor"],
  citedEvidenceIds: ["3c1a1f2c-7f52-4a76-9b0c-9d5b6a7c1d23"],
  citedExposureBasis: "PROJECTED",
  reasonCodes: ["PER_CHARGE_LIMIT_EXCEEDED"],
  currencyResults: [{
    currency: "INR",
    existingThirteenWeekMinor: "600000",
    proposedThirteenWeekMinor: "13500000",
    combinedThirteenWeekMinor: "14100000",
    thirteenWeekHeadroomMinor: "0",
    existingAnnualMinor: "2400000",
    proposedAnnualMinor: "54000000",
    combinedAnnualMinor: "56400000",
    annualHeadroomMinor: "0",
  }],
  evaluatedAt: "2026-08-25T09:00:00.000Z",
};

const decision: ControlDecisionDto = {
  id: "4c1a1f2c-7f52-4a76-9b0c-9d5b6a7c1d24",
  evaluationId: evaluation.id,
  proposalId: proposal.id,
  evaluationPolicyVersion: 3,
  action: "APPROVE_WITH_CAP",
  approvedCapMinor: "4000000",
  currency: "INR",
  expectedAmountMinor: "4500000",
  decidedByUserId: "1b1a1f2c-7f52-4a76-9b0c-9d5b6a7c1d21",
  decidedByDisplayName: "Control owner",
  overrideReason: null,
  decidedAt: "2026-08-25T10:00:00.000Z",
  authorizationExpiresOn: "2026-09-30",
};

const reconciliation: ControlReconciliationDto = {
  id: "5c1a1f2c-7f52-4a76-9b0c-9d5b6a7c1d25",
  proposalId: proposal.id,
  decisionId: decision.id,
  evidenceId: "3c1a1f2c-7f52-4a76-9b0c-9d5b6a7c1d23",
  verdict: "OVER_CAP",
  expectedAmountMinor: "4500000",
  approvedCapMinor: "4000000",
  authorizationCurrency: "INR",
  observedAmountMinor: "5100000",
  observedCurrency: "INR",
  observedEvidenceDate: "2026-09-15",
  outcome: {
    ...proposal.intendedOutcome!,
    observedValue: "1000",
    observedOn: "2026-10-15",
    observationBasis: "USER_ENTERED_OBSERVATION",
    verdict: "MISSED",
  },
  reconciledByUserId: "1b1a1f2c-7f52-4a76-9b0c-9d5b6a7c1d21",
  reconciledAt: "2026-08-26T10:00:00.000Z",
};

const policy: ControlPolicyDto = {
  policyVersion: 3,
  categoryRules: completeControlCategoryRules.map((rule) => (
    rule.category === "AI_MODEL" ? { ...rule, posture: "REVIEW" as const } : rule
  )),
  currencyLimits: [{ currency: "INR", maxPerChargeMinor: "2000000", maxThirteenWeekMinor: "6000000", maxAnnualMinor: "24000000" }],
  createdByUserId: "1b1a1f2c-7f52-4a76-9b0c-9d5b6a7c1d21",
  createdAt: "2026-08-20T09:00:00.000Z",
};

const brief: CommitmentControlBriefDto = {
  policy,
  proposals: [],
  capabilities: { canSubmitProposal: true, canDecide: true, canConfigurePolicy: true },
};

const draft: ControlProposalDraft = {
  merchant: "  Anthropic  ",
  purpose: "  Claude API for the product loop ",
  category: "AI_MODEL",
  amountText: "45000.00",
  currency: "INR",
  firstChargeDate: "2026-09-01",
  cadence: "MONTHLY",
  existingCommitmentIds: ["7c1a1f2c-7f52-4a76-9b0c-9d5b6a7c1d26"],
  outcomeMetric: " Resolved support cases ",
  outcomeDirection: "AT_LEAST",
  outcomeTargetText: "01200.5000",
  outcomeUnit: " cases ",
  outcomeReviewOn: "2026-10-15",
};

const submitted: CreateControlProposalRequest = {
  merchant: "Anthropic",
  purpose: "Claude API for the product loop",
  category: "AI_MODEL",
  amountMinor: "4500000",
  currency: "INR",
  firstChargeDate: "2026-09-01",
  cadence: "MONTHLY",
  existingCommitmentIds: ["7c1a1f2c-7f52-4a76-9b0c-9d5b6a7c1d26"],
  intendedOutcome: {
    metric: "Resolved support cases",
    targetDirection: "AT_LEAST",
    targetValue: "1200.5",
    unit: "cases",
    reviewOn: "2026-10-15",
  },
};

const failure = (code: TransportFailure["error"]["code"], extra: Record<string, unknown> = {}): TransportFailure => ({
  ok: false,
  origin: "SERVER",
  error: { code, message: `${code} reported`, retryable: false, requestId: "request-failure", ...extra } as TransportFailure["error"],
});

const ready = (overrides: Partial<ControlState> = {}): ControlState => ({
  ...initialControlState,
  status: { kind: "READY" },
  brief,
  workspaceVersion: 7,
  ...overrides,
});

test("major-unit text converts to exact minor units and refuses anything that is not money", () => {
  assert.deepEqual(parseControlAmount("45000.00", "INR"), { ok: true, minor: "4500000" });
  assert.deepEqual(parseControlAmount(" 1999 ", "INR"), { ok: true, minor: "199900" });
  assert.deepEqual(parseControlAmount("20.5", "USD"), { ok: true, minor: "2050" });
  assert.equal(parseControlAmount("0", "INR").ok, false);
  assert.equal(parseControlAmount("", "INR").ok, false);
  assert.equal(parseControlAmount("-5", "INR").ok, false);
  assert.equal(parseControlAmount("1,999", "INR").ok, false);
  assert.equal(parseControlAmount("19.999", "INR").ok, false);
});

test("server minor units render India-first without a floating point anywhere", () => {
  // The same notation MoneyValue prints, so a cap never appears twice in two
  // different forms on one screen.
  assert.equal(formatControlMoney("4500000", "INR"), "INR 45,000");
  assert.equal(formatControlMoney("135000", "INR"), "INR 1,350");
  assert.equal(formatControlMoney("199950", "INR"), "INR 1,999.50");
  // Beyond Number.MAX_SAFE_INTEGER: the trailing 93 paise survive intact.
  assert.equal(formatControlMoney("9007199254740993", "INR"), "INR 9,00,71,99,25,47,409.93");
  assert.equal(formatControlMoney(null, null), "Not published");
  // A value this device cannot render is echoed, never rounded into a guess.
  assert.equal(formatControlMoney("12.5", "INR"), "12.5 minor units INR");
  assert.equal(formatControlMoney("100", "RUPEES"), "100 minor units RUPEES");
});

test("a proposal request trims text, converts money once, and reports each missing field", () => {
  const built = controlProposalRequest(draft);
  assert.equal(built.ok, true);
  if (built.ok) assert.deepEqual(built.request, submitted);

  const rejected = controlProposalRequest({
    ...draft,
    merchant: " ",
    purpose: "",
    amountText: "abc",
    firstChargeDate: "2026-02-30",
    outcomeMetric: "",
    outcomeTargetText: "not-a-value",
    outcomeUnit: "",
    outcomeReviewOn: "2026-02-30",
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.ok(rejected.errors.merchant);
    assert.ok(rejected.errors.purpose);
    assert.ok(rejected.errors.amountText);
    assert.ok(rejected.errors.firstChargeDate);
    assert.ok(rejected.errors.outcomeMetric);
    assert.ok(rejected.errors.outcomeTargetText);
    assert.ok(rejected.errors.outcomeUnit);
    assert.ok(rejected.errors.outcomeReviewOn);
  }
});

test("an unchanged retry keeps one idempotency key and a changed body takes a new one", () => {
  let issued = 0;
  const newKey = () => `key-${++issued}`;
  const store = { PROPOSAL: { signature: "a", key: "key-original" } } as const;
  assert.equal(resolveIdempotencyKey(store, "PROPOSAL", "a", newKey), "key-original");
  assert.equal(resolveIdempotencyKey(store, "PROPOSAL", "b", newKey), "key-1");
  assert.equal(resolveIdempotencyKey({}, "DECISION", "a", newKey), "key-2");
});

test("a 503 FEATURE_UNAVAILABLE brief hides the desk for the session without a retryable failure", () => {
  const next = controlReducer(initialControlState, { type: "BRIEF_FAILED", failure: failure("FEATURE_UNAVAILABLE") });
  assert.deepEqual(next.status, { kind: "UNAVAILABLE" });
  assert.equal(next.brief, null);
  assert.equal(next.failure, null);
});

test("a 503 DATABASE_UNAVAILABLE brief stays an honest, retryable failure", () => {
  const next = controlReducer(initialControlState, { type: "BRIEF_FAILED", failure: failure("DATABASE_UNAVAILABLE") });
  assert.equal(next.status.kind, "FAILED");
});

test("a stale workspace preserves the unsent draft, drops the key, and asks for a review", () => {
  const started = controlReducer(
    ready({ draft }),
    { type: "PROPOSAL_STARTED", idempotencyKey: "key-1", signature: "signature-1" },
  );
  assert.deepEqual(started.idempotency.PROPOSAL, { signature: "signature-1", key: "key-1" });

  const stale = controlReducer(started, { type: "PROPOSAL_FAILED", failure: failure("STALE_STATE", { currentVersion: 9 }) });
  assert.deepEqual(stale.draft, draft);
  assert.equal(stale.pending, null);
  assert.equal(stale.idempotency.PROPOSAL, undefined);
  assert.match(stale.staleNotice ?? "", /kept exactly as you typed it/);

  const reloaded = controlReducer(stale, { type: "BRIEF_LOADED", brief, meta: { requestId: "request-2", workspaceVersion: 9 } });
  assert.deepEqual(reloaded.draft, draft);
  assert.equal(reloaded.workspaceVersion, 9);
  assert.match(reloaded.staleNotice ?? "", /kept exactly as you typed it/);
});

test("a conflicting key is dropped and an unreachable device keeps the key for a safe retry", () => {
  const started = controlReducer(ready(), { type: "PROPOSAL_STARTED", idempotencyKey: "key-1", signature: "signature-1" });
  assert.equal(controlReducer(started, { type: "PROPOSAL_FAILED", failure: failure("CONFLICT") }).idempotency.PROPOSAL, undefined);
  assert.deepEqual(
    controlReducer(started, { type: "PROPOSAL_FAILED", failure: { ok: false, origin: "CLIENT", error: { code: "UNKNOWN", message: "offline", retryable: true, requestId: "client-device" } } }).idempotency.PROPOSAL,
    { signature: "signature-1", key: "key-1" },
  );
});

test("only the fields the server echoed back are cleared from the composer", () => {
  const started = controlReducer(ready({ draft }), { type: "PROPOSAL_STARTED", idempotencyKey: "key-1", signature: "signature-1" });
  const saved = controlReducer(started, { type: "PROPOSAL_SAVED", proposal, evaluation, submitted, meta });
  assert.equal(saved.draft.merchant, "");
  assert.equal(saved.draft.purpose, "");
  assert.equal(saved.draft.amountText, "");
  assert.deepEqual(saved.draft.existingCommitmentIds, []);
  assert.equal(saved.draft.currency, "INR");
  assert.equal(saved.draft.firstChargeDate, "2026-09-01");
  assert.equal(saved.focusProposalId, proposal.id);
  assert.equal(saved.workspaceVersion, meta.workspaceVersion);

  const echoedDifferently = controlReducer(started, {
    type: "PROPOSAL_SAVED",
    proposal: { ...proposal, merchant: "Anthropic PBC" },
    evaluation,
    submitted,
    meta,
  });
  assert.equal(echoedDifferently.draft.merchant, draft.merchant);
});

test("a saved Control write keeps an explicit reminder projection retry notice", () => {
  const started = controlReducer(ready({ draft }), {
    type: "PROPOSAL_STARTED",
    idempotencyKey: "key-attention-retry",
    signature: "signature-attention-retry",
  });
  const saved = controlReducer(started, {
    type: "PROPOSAL_SAVED",
    proposal,
    evaluation,
    submitted,
    meta: { ...meta, attentionProjection: "pending-worker-retry" },
  });

  assert.equal(saved.brief?.proposals[0]?.proposal.id, proposal.id);
  assert.equal(saved.attentionProjection, "pending-worker-retry");
});

test("a recorded decision never rewrites the evaluation and a later observation never rewrites the cap", () => {
  const withProposal = ready({ brief: { ...brief, proposals: [{ proposal, evaluation, decision: null, reconciliations: [], outcomeObservations: [], exceptionReviews: [] }] } });
  const decided = controlReducer(withProposal, { type: "DECISION_SAVED", decision, meta });
  const entry = decided.brief?.proposals[0];
  assert.deepEqual(entry?.evaluation, evaluation);
  assert.equal(entry?.decision?.approvedCapMinor, "4000000");
  assert.equal(decided.dialog, null);

  const reconciled = controlReducer(decided, { type: "RECONCILIATION_SAVED", reconciliation, meta });
  const settled = reconciled.brief?.proposals[0];
  assert.equal(settled?.decision?.approvedCapMinor, "4000000");
  assert.equal(settled?.reconciliations[0]?.verdict, "OVER_CAP");
  assert.equal(settled?.reconciliations[0]?.approvedCapMinor, "4000000");
});

test("an approval requires a bounded expiry and an exact cap", () => {
  const within = { ...evaluation, status: "WITHIN_POLICY" as const, reasonCodes: [] };
  assert.deepEqual(controlDecisionRequest({ action: "APPROVE", capText: "", authorizationExpiresOn: "2026-09-30", overrideReason: "", error: null }, proposal, within, "2026-08-25"), {
    ok: true,
    request: { action: "APPROVE", authorizationExpiresOn: "2026-09-30" },
  });
  assert.deepEqual(controlDecisionRequest({ action: "DECLINE", capText: "999", authorizationExpiresOn: "", overrideReason: "", error: null }, proposal, within, "2026-08-25"), {
    ok: true,
    request: { action: "DECLINE" },
  });
  assert.deepEqual(controlDecisionRequest({ action: "APPROVE_WITH_CAP", capText: "40000", authorizationExpiresOn: "2026-09-30", overrideReason: "", error: null }, proposal, within, "2026-08-25"), {
    ok: true,
    request: { action: "APPROVE_WITH_CAP", approvedCapMinor: "4000000", authorizationExpiresOn: "2026-09-30" },
  });
  assert.equal(controlDecisionRequest({ action: "APPROVE_WITH_CAP", capText: "45000.01", authorizationExpiresOn: "2026-09-30", overrideReason: "", error: null }, proposal, within, "2026-08-25").ok, false);
  assert.equal(controlDecisionRequest({ action: "APPROVE_WITH_CAP", capText: "0", authorizationExpiresOn: "2026-09-30", overrideReason: "", error: null }, proposal, within, "2026-08-25").ok, false);
  assert.equal(controlDecisionRequest({ action: "APPROVE", capText: "", authorizationExpiresOn: "", overrideReason: "", error: null }, proposal, within, "2026-08-25").ok, false);
  assert.equal(controlDecisionRequest({ action: "APPROVE", capText: "", authorizationExpiresOn: "2026-10-16", overrideReason: "", error: null }, proposal, within, "2026-08-25").ok, false);
  assert.equal(controlDecisionRequest({ action: "APPROVE", capText: "", authorizationExpiresOn: "2026-09-30", overrideReason: "", error: null }, proposal, evaluation, "2026-08-25").ok, false);
  assert.equal(controlDecisionRequest({ action: "APPROVE", capText: "", authorizationExpiresOn: "2026-09-30", overrideReason: "", error: null }, proposal, within, "2026-10-16").ok, false);
  assert.deepEqual(controlDecisionRequest({
    action: "APPROVE_WITH_CAP",
    capText: "40000",
    authorizationExpiresOn: "2026-09-30",
    overrideReason: "Board-approved exception for this vendor.",
    error: null,
  }, proposal, evaluation, "2026-08-25"), {
    ok: true,
    request: {
      action: "APPROVE_WITH_CAP",
      approvedCapMinor: "4000000",
      authorizationExpiresOn: "2026-09-30",
      overrideReason: "Board-approved exception for this vendor.",
    },
  });
});

test("an observed outcome is optional but its exact value and date travel together", () => {
  const evidenceId = "3c1a1f2c-7f52-4a76-9b0c-9d5b6a7c1d23";
  assert.deepEqual(controlReconciliationRequest({
    commitmentId: null,
    evidenceId,
    outcomeValueText: "",
    outcomeObservedOn: "",
    error: null,
  }, proposal, "2026-10-15"), { ok: true, request: { evidenceId } });
  assert.deepEqual(controlReconciliationRequest({
    commitmentId: null,
    evidenceId,
    outcomeValueText: "001250.000",
    outcomeObservedOn: "2026-10-15",
    error: null,
  }, proposal, "2026-10-15"), {
    ok: true,
    request: { evidenceId, observedOutcome: { value: "1250", observedOn: "2026-10-15" } },
  });
  assert.equal(controlReconciliationRequest({
    commitmentId: null,
    evidenceId,
    outcomeValueText: "1250",
    outcomeObservedOn: "",
    error: null,
  }, proposal, "2026-10-15").ok, false);
  assert.equal(controlReconciliationRequest({
    commitmentId: null,
    evidenceId,
    outcomeValueText: "1250",
    outcomeObservedOn: "2026-10-14",
    error: null,
  }, proposal, "2026-10-15").ok, false);
  assert.equal(controlReconciliationRequest({
    commitmentId: null,
    evidenceId,
    outcomeValueText: "1250",
    outcomeObservedOn: "2026-10-16",
    error: null,
  }, proposal, "2026-10-15").ok, false);
});

test("a standalone outcome request is exact, due, and independent of receipt evidence", () => {
  assert.deepEqual(controlOutcomeObservationRequest({
    valueText: "001250.000",
    observedOn: "2026-10-15",
  }, proposal, "2026-10-15"), {
    ok: true,
    request: { observedOutcome: { value: "1250", observedOn: "2026-10-15" } },
  });
  assert.equal(controlOutcomeObservationRequest({ valueText: "", observedOn: "2026-10-15" }, proposal, "2026-10-15").ok, false);
  assert.equal(controlOutcomeObservationRequest({ valueText: "1250", observedOn: "2026-10-14" }, proposal, "2026-10-15").ok, false);
  assert.equal(controlOutcomeObservationRequest({ valueText: "1250", observedOn: "2026-10-16" }, proposal, "2026-10-15").ok, false);
});

test("an exception disposition requires an explicit outcome and a bounded note", () => {
  const target = { targetKind: "RECONCILIATION" as const, targetId: reconciliation.id };
  assert.deepEqual(controlExceptionReviewRequest({
    disposition: "NEW_PROPOSAL_REQUIRED",
    note: "  A fresh authorization is required. ",
  }, target), {
    ok: true,
    request: {
      ...target,
      disposition: "NEW_PROPOSAL_REQUIRED",
      note: "A fresh authorization is required.",
    },
  });
  assert.equal(controlExceptionReviewRequest({ disposition: null, note: "Review complete." }, target).ok, false);
  assert.equal(controlExceptionReviewRequest({ disposition: "NO_FURTHER_ACTION", note: " " }, target).ok, false);
});

test("follow-through writes append records without rewriting authorization or reconciliation", () => {
  const observation: ControlOutcomeObservationDto = {
    id: "0a000000-0000-4000-8000-000000000001",
    proposalId: proposal.id,
    decisionId: decision.id,
    observedValue: "900",
    observedOn: "2026-10-15",
    target: proposal.intendedOutcome!,
    observationBasis: "USER_ENTERED_OBSERVATION",
    verdict: "MISSED",
    observedByUserId: decision.decidedByUserId,
    observedAt: "2026-10-15T10:00:00.000Z",
  };
  const review: ControlExceptionReviewDto = {
    id: "0b000000-0000-4000-8000-000000000001",
    proposalId: proposal.id,
    decisionId: decision.id,
    targetKind: "OUTCOME_OBSERVATION",
    targetId: observation.id,
    disposition: "NEW_PROPOSAL_REQUIRED",
    note: "The missed target needs a fresh proposal.",
    reviewedByUserId: decision.decidedByUserId,
    reviewedAt: "2026-10-15T11:00:00.000Z",
  };
  const starting = ready({ brief: {
    ...brief,
    proposals: [{ proposal, evaluation, decision, reconciliations: [reconciliation], outcomeObservations: [], exceptionReviews: [] }],
  } });
  const observed = controlReducer(starting, { type: "OUTCOME_SAVED", observation, meta });
  assert.deepEqual(observed.brief?.proposals[0]?.outcomeObservations, [observation]);
  assert.equal(observed.brief?.proposals[0]?.decision?.approvedCapMinor, decision.approvedCapMinor);
  assert.deepEqual(observed.brief?.proposals[0]?.reconciliations, [reconciliation]);

  const reviewed = controlReducer(observed, { type: "EXCEPTION_REVIEW_SAVED", review, meta });
  assert.deepEqual(reviewed.brief?.proposals[0]?.exceptionReviews, [review]);
  assert.deepEqual(reviewed.brief?.proposals[0]?.outcomeObservations, [observation]);
});

test("a policy draft round-trips exact minor units and refuses a silent duplicate currency", () => {
  const drafted = policyDraftFrom(policy, (minor, currency) => (currency === "INR" ? (Number(minor) / 100).toFixed(2) : minor));
  assert.deepEqual(drafted.currencyLimits, [{
    currency: "INR",
    maxPerChargeText: "20000.00",
    maxThirteenWeekText: "60000.00",
    maxAnnualText: "240000.00",
  }]);

  const built = controlPolicyRequest(drafted);
  assert.equal(built.ok, true);
  if (built.ok) {
    assert.deepEqual(built.request.currencyLimits, [{
      currency: "INR",
      maxPerChargeMinor: "2000000",
      maxThirteenWeekMinor: "6000000",
      maxAnnualMinor: "24000000",
    }]);
    assert.deepEqual(built.request.categoryRules, completeControlCategoryRules.map((rule) => (
      rule.category === "AI_MODEL" ? { ...rule, posture: "REVIEW" as const } : rule
    )));
  }

  const duplicated: ControlPolicyDraft = {
    ...drafted,
    currencyLimits: [...drafted.currencyLimits, { currency: "inr", maxPerChargeText: "1", maxThirteenWeekText: "1", maxAnnualText: "1" }],
  };
  assert.equal(controlPolicyRequest(duplicated).ok, false);
});

test("a new policy version replaces only the published policy, never a recorded decision", () => {
  const withDecision = ready({ brief: { ...brief, proposals: [{ proposal, evaluation, decision, reconciliations: [], outcomeObservations: [], exceptionReviews: [] }] } });
  const next = controlReducer(withDecision, {
    type: "POLICY_SAVED",
    policy: { ...policy, policyVersion: 4 },
    meta: { requestId: "request-policy", workspaceVersion: 8 },
  });
  assert.equal(next.brief?.policy?.policyVersion, 4);
  assert.equal(next.brief?.proposals[0]?.decision?.evaluationPolicyVersion, 3);
  assert.equal(next.brief?.proposals[0]?.evaluation?.policyVersion, 3);
  assert.equal(next.policyDraft, null);
});
