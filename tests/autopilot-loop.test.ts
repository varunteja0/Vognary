import assert from "node:assert/strict";
import test from "node:test";
import { evaluateEligibility, highConfidenceFloor } from "../src/lib/recovery/eligibility";
import { executionBlockReason } from "../src/lib/recovery/execution-gate";
import { canTransitionCandidate, shadowEvaluatorAllowedStatuses } from "../src/lib/recovery/candidate-machine";
import { matchSupportedProvider, lookupSupportedProviderById, providerRequiresCustomerWork, supportedProviders } from "../src/lib/recovery/provider-registry";
import { evaluateCoveredWindow } from "../src/lib/recovery/covered-window";
import { computeFirstYearCharge, monitoringFeeMinor } from "../src/lib/recovery/fee-ledger";
import { isAutopilotExecutionEnabled, isAutopilotNoticeEnabled, canDeliverAutopilotNotice } from "../src/lib/recovery/autopilot-switch";
import { evaluateShadowGate } from "../src/lib/recovery/shadow-gate";
import { isRecoveryGmailOauthReady } from "../src/lib/recovery/gmail-oauth";
import { standingMandateSignedText, standingMandateTextHash, standingMandateVetoHours } from "../src/lib/recovery/standing-mandate";

const zeroMinor = BigInt(0);
const openaiMinor = BigInt(199_900);
const perActionCeilingMinor = BigInt(5_000_000);
const rolling30dCeilingMinor = BigInt(20_000_000);
const modestSavingMinor = BigInt(1_000_000);
const modestOutcomeMinor = BigInt(150_000);
const largeSavingMinor = BigInt(100_000_000);
const largeOutcomeMinor = BigInt(15_000_000);

const eligibleBase = {
  mandateActive: true,
  category: "AI tools",
  confidenceScore: highConfidenceFloor,
  datedOccurrenceCount: 2,
  explicitProviderRenewalEvidence: false,
  cadenceStable: true,
  amountStable: true,
  currencyStable: true,
  nextDebitStable: true,
  amountMinor: openaiMinor,
  rolling30dExecutedMinor: zeroMinor,
  perActionCeilingMinor,
  rolling30dCeilingMinor,
  merchant: "OpenAI",
  decision: null,
  noticeCanBeDelivered: true,
} as const;

test("shadow eligibility requires an active mandate, discretionary class, proven route, and stable cited facts", () => {
  const previous = process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
  try {
    const result = evaluateEligibility(eligibleBase);
    assert.equal(result.eligibility, "ELIGIBLE");
    assert.equal(result.providerId, "openai");
    assert.equal(result.vetoWindowHours, standingMandateVetoHours);
    assert.equal(result.commitmentClass, "discretionary-subscription");
  } finally {
    process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous;
  }
});

test("every protected class fails closed, including mixed and adversarial strings", () => {
  const protectedCases = [
    { category: "Debt", merchant: "HDFC" },
    { category: "Insurance", merchant: "LIC" },
    { category: "Investments", merchant: "Zerodha" },
    { category: "Utilities", merchant: "Airtel" },
    { category: "Cloud hosting", merchant: "AWS" },
    { category: "AWS subscription", merchant: "Amazon Web Services" },
    { category: "insurance SaaS", merchant: "Policybazaar" },
  ];
  for (const fixture of protectedCases) {
    const result = evaluateEligibility({ ...eligibleBase, ...fixture });
    assert.equal(result.eligibility, "PROTECTED", fixture.category);
    assert.ok(result.reasons.includes("PROTECTED_CLASS"), fixture.category);
  }
});

test("unknown merchants, unproven catalog routes, and KEEP decisions never become eligible", () => {
  assert.equal(evaluateEligibility({ ...eligibleBase, merchant: "Obscure Tool Co" }).eligibility, "UNSUPPORTED_ROUTE");
  assert.equal(evaluateEligibility(eligibleBase).eligibility, "UNSUPPORTED_ROUTE");
  assert.equal(evaluateEligibility({ ...eligibleBase, category: "OpenAI ऑटोपे subscription" }).eligibility, "PROTECTED");
  const previous = process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
  try {
    assert.equal(evaluateEligibility({ ...eligibleBase, decision: "KEEP" }).eligibility, "INELIGIBLE");
    assert.equal(evaluateEligibility({ ...eligibleBase, mandateActive: false }).eligibility, "INELIGIBLE");
    assert.equal(evaluateEligibility({ ...eligibleBase, datedOccurrenceCount: 1 }).eligibility, "INELIGIBLE");
    assert.equal(evaluateEligibility({ ...eligibleBase, datedOccurrenceCount: 1, explicitProviderRenewalEvidence: true }).eligibility, "ELIGIBLE");
    const crossCurrency = evaluateEligibility({
      ...eligibleBase,
      amountMinor: BigInt(5_000_000),
      amountCurrency: "USD",
      mandateCurrency: "INR",
    });
    assert.equal(crossCurrency.eligibility, "INELIGIBLE");
    assert.ok(crossCurrency.reasons.includes("CURRENCY_MISMATCH"));
    assert.equal(crossCurrency.reasons.includes("AMOUNT_OVER_CEILING"), false);
  } finally {
    process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous;
  }
});

test("the first ten catalog providers stay unproven in-app routes until a real cancellation succeeds", () => {
  assert.equal(supportedProviders.length, 10);
  for (const provider of supportedProviders) {
    assert.equal(provider.routeProven, false);
    assert.equal(provider.zeroCustomerWork, false);
    assert.equal(provider.requiresLogin, true);
    assert.equal(providerRequiresCustomerWork(provider), true);
    assert.equal(provider.emergencyDisabled, false);
    assert.equal(matchSupportedProvider(provider.displayName), null);
  }
  assert.equal(lookupSupportedProviderById("openai"), null);
  assert.equal(lookupSupportedProviderById("unknown"), null);
  assert.equal(matchSupportedProvider("Unknown Bank"), null);
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
  try {
    assert.equal(matchSupportedProvider("OpenAI")?.id, "openai");
    assert.equal(lookupSupportedProviderById("openai")?.displayName, "OpenAI ChatGPT");
  } finally {
    delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
  }
});

test("the shadow evaluator cannot write execution statuses", () => {
  assert.deepEqual([...shadowEvaluatorAllowedStatuses()], ["SHADOW"]);
  const blocked = canTransitionCandidate("SHADOW", "IN_PROGRESS", {
    executionEnabled: false,
    noticeDelivered: true,
    noticeEnabled: true,
    now: new Date("2026-08-16T00:00:00.000Z"),
    vetoDeadline: new Date("2026-08-15T00:00:00.000Z"),
    vetoed: false,
    revoked: false,
  });
  assert.equal(blocked, false);
});

test("authorized-by-rule requires delivered notice and a completed 48-hour clock; production clocks cannot be skipped", () => {
  const now = new Date("2026-08-15T11:00:00.000Z");
  const deadline = new Date("2026-08-15T12:00:00.000Z");
  assert.equal(canTransitionCandidate("NOTICE_QUEUED", "AUTHORIZED_BY_RULE", {
    executionEnabled: true,
    noticeDelivered: true,
    noticeEnabled: true,
    now,
    vetoDeadline: deadline,
    vetoed: false,
    revoked: false,
  }), false);
  assert.equal(canTransitionCandidate("NOTICE_QUEUED", "AUTHORIZED_BY_RULE", {
    executionEnabled: true,
    noticeDelivered: true,
    noticeEnabled: true,
    now: deadline,
    vetoDeadline: deadline,
    vetoed: false,
    revoked: false,
  }), true);
  assert.equal(canTransitionCandidate("NOTICE_QUEUED", "AUTHORIZED_BY_RULE", {
    executionEnabled: true,
    noticeDelivered: false,
    noticeEnabled: true,
    now: deadline,
    vetoDeadline: deadline,
    vetoed: false,
    revoked: false,
  }), false);
});

test("covered windows never treat missing coverage or merchant silence as rupees saved", () => {
  assert.deepEqual(evaluateCoveredWindow({
    expectedDebitDate: "2026-09-06",
    baselineDebitMinor: openaiMinor,
    observedDebitMinor: null,
    coverageStart: null,
    coverageEnd: null,
  }), { status: "PENDING", savingMinor: null });
  assert.deepEqual(evaluateCoveredWindow({
    expectedDebitDate: "2026-09-06",
    baselineDebitMinor: openaiMinor,
    observedDebitMinor: zeroMinor,
    coverageStart: "2026-08-01",
    coverageEnd: "2026-08-31",
  }), { status: "MISSING_COVERAGE", savingMinor: null });
  assert.deepEqual(evaluateCoveredWindow({
    expectedDebitDate: "2026-09-06",
    baselineDebitMinor: openaiMinor,
    observedDebitMinor: zeroMinor,
    coverageStart: "2026-09-01",
    coverageEnd: "2026-09-30",
  }), { status: "COVERED_CLEAN", savingMinor: openaiMinor });
  assert.deepEqual(evaluateCoveredWindow({
    expectedDebitDate: "2026-09-06",
    baselineDebitMinor: openaiMinor,
    observedDebitMinor: openaiMinor,
    coverageStart: "2026-09-01",
    coverageEnd: "2026-09-30",
  }), { status: "NOT_ELIMINATED", savingMinor: zeroMinor });
});

test("first-year retained charge uses monitoring credit, 15% outcome, and 33% cap", () => {
  const zero = computeFirstYearCharge(zeroMinor);
  assert.equal(zero.retainedMinor, zeroMinor);
  assert.equal(zero.refundCreditMinor, monitoringFeeMinor);
  const modest = computeFirstYearCharge(modestSavingMinor);
  assert.equal(modest.outcomeFeeMinor, modestOutcomeMinor);
  assert.equal(modest.retainedMinor, modestOutcomeMinor);
  assert.equal(modest.additionalChargeMinor, modestOutcomeMinor - monitoringFeeMinor);
  assert.equal(modest.refundCreditMinor, zeroMinor);
  const large = computeFirstYearCharge(largeSavingMinor);
  assert.equal(large.outcomeFeeMinor, largeOutcomeMinor);
  assert.equal(large.retainedMinor, largeOutcomeMinor);
  assert.equal(large.additionalChargeMinor, largeOutcomeMinor - monitoringFeeMinor);
});

test("execution, notice, and Gmail OAuth remain off unless founder-controlled flags are genuinely set", () => {
  assert.equal(isAutopilotExecutionEnabled(), false);
  assert.equal(isAutopilotNoticeEnabled(), false);
  assert.equal(canDeliverAutopilotNotice(), false);
  assert.equal(isRecoveryGmailOauthReady(), false);
  assert.ok(standingMandateSignedText.includes("48-hour"));
  assert.equal(standingMandateTextHash().length, 64);
});

test("operator execution cannot skip mandate, notice, deadline, veto, revocation, shadow gate, or provider disable", () => {
  const deadline = new Date("2026-08-16T00:00:00.000Z");
  const authorized = {
    executionEnabled: true,
    shadowGatePassed: true,
    mandateActive: true,
    eligibility: "ELIGIBLE" as const,
    status: "AUTHORIZED_BY_RULE" as const,
    noticeDelivered: true,
    vetoDeadline: deadline,
    now: deadline,
    vetoed: false,
    revoked: false,
    providerExecutable: true,
    providerDisabled: false,
    outcome: "EXECUTED" as const,
  };
  assert.equal(executionBlockReason(authorized), null);
  assert.equal(executionBlockReason({ ...authorized, status: "SHADOW" }), "STATUS_NOT_AUTHORIZED");
  assert.equal(executionBlockReason({ ...authorized, noticeDelivered: false, vetoDeadline: null }), "NOTICE_NOT_DELIVERED");
  assert.equal(executionBlockReason({ ...authorized, now: new Date("2026-08-15T00:00:00.000Z") }), "VETO_WINDOW_OPEN");
  assert.equal(executionBlockReason({ ...authorized, vetoed: true, status: "VETOED" }), "VETOED");
  assert.equal(executionBlockReason({ ...authorized, revoked: true }), "REVOKED");
  assert.equal(executionBlockReason({ ...authorized, mandateActive: false }), "MANDATE_INACTIVE");
  assert.equal(executionBlockReason({ ...authorized, shadowGatePassed: false }), "SHADOW_GATE");
  assert.equal(executionBlockReason({ ...authorized, providerDisabled: true }), "PROVIDER_DISABLED");
  assert.equal(executionBlockReason({ ...authorized, providerExecutable: false }), "UNSUPPORTED_ROUTE");
  assert.equal(executionBlockReason({ ...authorized, executionEnabled: false }), "EXECUTION_DISABLED");
});

test("the shadow gate requires 10 mandates, 5 eligible candidates, and zero protected leakage", () => {
  assert.equal(evaluateShadowGate({ connectedMandates: 9, eligibleCandidates: 5, protectedLeakage: 0 }).passed, false);
  assert.equal(evaluateShadowGate({ connectedMandates: 10, eligibleCandidates: 5, protectedLeakage: 1 }).passed, false);
  assert.equal(evaluateShadowGate({ connectedMandates: 10, eligibleCandidates: 5, protectedLeakage: 0 }).passed, true);
});
