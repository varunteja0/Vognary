import assert from "node:assert/strict";
import test from "node:test";
import type {
  CommitmentControlBriefDto,
  ControlDecisionDto,
  ControlEvaluationDto,
  ControlPolicyDto,
  ControlProposalDto,
  ControlReconciliationDto,
  CreateControlProposalRequest,
} from "../src/lib/commitment-control/contracts";
import {
  controlDecisionRequest,
  controlPolicyRequest,
  controlProposalRequest,
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
  assert.equal(formatControlMoney("4500000", "INR"), "₹45,000.00");
  // Beyond Number.MAX_SAFE_INTEGER: the trailing 93 paise survive intact.
  assert.equal(formatControlMoney("9007199254740993", "INR"), "₹9,00,71,99,25,47,409.93");
  assert.equal(formatControlMoney(null, null), "Not published");
  // A value this device cannot render is echoed, never rounded into a guess.
  assert.equal(formatControlMoney("12.5", "INR"), "12.5 minor units INR");
  assert.equal(formatControlMoney("100", "RUPEES"), "100 minor units RUPEES");
});

test("a proposal request trims text, converts money once, and reports each missing field", () => {
  const built = controlProposalRequest(draft);
  assert.equal(built.ok, true);
  if (built.ok) assert.deepEqual(built.request, submitted);

  const rejected = controlProposalRequest({ ...draft, merchant: " ", purpose: "", amountText: "abc", firstChargeDate: "2026-02-30" });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.ok(rejected.errors.merchant);
    assert.ok(rejected.errors.purpose);
    assert.ok(rejected.errors.amountText);
    assert.ok(rejected.errors.firstChargeDate);
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

test("a recorded decision never rewrites the evaluation and a later observation never rewrites the cap", () => {
  const withProposal = ready({ brief: { ...brief, proposals: [{ proposal, evaluation, decision: null, reconciliations: [] }] } });
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

test("an approved cap must be exact, positive, and never above the proposed per-charge amount", () => {
  const within = { ...evaluation, status: "WITHIN_POLICY" as const, reasonCodes: [] };
  assert.deepEqual(controlDecisionRequest({ action: "APPROVE", capText: "", overrideReason: "", error: null }, proposal, within), {
    ok: true,
    request: { action: "APPROVE" },
  });
  assert.deepEqual(controlDecisionRequest({ action: "DECLINE", capText: "999", overrideReason: "", error: null }, proposal, within), {
    ok: true,
    request: { action: "DECLINE" },
  });
  assert.deepEqual(controlDecisionRequest({ action: "APPROVE_WITH_CAP", capText: "40000", overrideReason: "", error: null }, proposal, within), {
    ok: true,
    request: { action: "APPROVE_WITH_CAP", approvedCapMinor: "4000000" },
  });
  assert.equal(controlDecisionRequest({ action: "APPROVE_WITH_CAP", capText: "45000.01", overrideReason: "", error: null }, proposal, within).ok, false);
  assert.equal(controlDecisionRequest({ action: "APPROVE_WITH_CAP", capText: "0", overrideReason: "", error: null }, proposal, within).ok, false);
  assert.equal(controlDecisionRequest({ action: "APPROVE", capText: "", overrideReason: "", error: null }, proposal, evaluation).ok, false);
  assert.deepEqual(controlDecisionRequest({
    action: "APPROVE_WITH_CAP",
    capText: "40000",
    overrideReason: "Board-approved exception for this vendor.",
    error: null,
  }, proposal, evaluation), {
    ok: true,
    request: {
      action: "APPROVE_WITH_CAP",
      approvedCapMinor: "4000000",
      overrideReason: "Board-approved exception for this vendor.",
    },
  });
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
  const withDecision = ready({ brief: { ...brief, proposals: [{ proposal, evaluation, decision, reconciliations: [] }] } });
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
