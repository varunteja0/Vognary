import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { classifyCommitment } from "../src/lib/commitment-policy";
import { canTransitionCandidate } from "../src/lib/recovery/candidate-machine";
import { evaluateCoveredWindowProof, debitObservationWindow } from "../src/lib/recovery/covered-window";
import { billingYearStart, feePeriodCrossesBillingAnniversary } from "../src/lib/recovery/billing-year";
import {
  autopilotNoticePayloadVersion,
  autopilotNoticeResendTag,
  candidateClockAuthorizes,
  freezeAutopilotNotice,
  frozenAutopilotNoticeFromPersistence,
  hasAutopilotNoticeTag,
  hashAutopilotNoticeProviderPayload,
  noticeClockMayStart,
  resendIdempotencyWindowOpen,
  unboundNoticeEventRetentionMs,
} from "../src/lib/recovery/notice-payload";
import { liveProvenProviderIds } from "../scripts/lib/autopilot-funnel.mjs";
import {
  isAutopilotExecutionEnabled,
  isAutopilotNoticeEnabled,
} from "../src/lib/recovery/autopilot-switch";
import {
  countsAsConnectedMandate,
  countsAsEligibleCandidate,
  countsAsProtectedLeakage,
  evaluateShadowGate,
  executionMayProceedPastShadowGate,
  shadowGateCounts,
} from "../src/lib/recovery/shadow-gate";
import { executionBlockReason } from "../src/lib/recovery/execution-gate";
import {
  bindExecutionIdempotency,
  executionOperationKey,
  resolveExecutionReplay,
} from "../src/lib/recovery/execution-idempotency";
import {
  computeCumulativeFirstYearCharge,
  computeFirstYearCharge,
  feePeriodsOverlap,
  invoiceReplayDecision,
  monitoringFeeMinor,
} from "../src/lib/recovery/fee-ledger";
import { deriveNextDebit } from "../src/lib/recovery/next-debit";
import {
  applyNoticeDeliveryEvent,
  productionVetoHours,
  vetoDeadlineFromDelivery,
} from "../src/lib/recovery/notice-delivery";
import {
  canonicalProvenProviderIds,
  catalogProvenProviderIds,
  isCatalogProviderProven,
  isProviderExecutable,
  isProviderRouteProven,
  isTestContractAdapterActivatable,
  lookupCatalogProviderById,
  providerProofStatus,
  supportedProviders,
  testContractAdapterId,
} from "../src/lib/recovery/provider-registry";
import { isVetoTokenSecretValid, signVetoToken, verifyVetoToken } from "../src/lib/recovery/veto-token";
import { autopilotSloBreaches } from "../src/lib/recovery/autopilot-metrics";

const openaiMinor = BigInt(199_900);

test("historical evidence dates alone do not make next debit stable", () => {
  const derived = deriveNextDebit({
    occurrences: [
      { evidenceDate: "2026-07-06", amountMinor: openaiMinor, currency: "INR", merchant: "OpenAI", cadence: "MONTHLY", citedNextExpectedDate: null, explicitProviderRenewal: false },
      { evidenceDate: "2026-08-06", amountMinor: openaiMinor, currency: "INR", merchant: "OpenAI", cadence: "MONTHLY", citedNextExpectedDate: null, explicitProviderRenewal: false },
    ],
  });
  assert.equal(derived.stable, false);
  assert.equal(derived.nextDebitDate, null);
  assert.equal(derived.reason, "MISSING_NEXT");
});

test("stable monthly cadence uses cited recurrence, including month-end and leap years", () => {
  const monthly = deriveNextDebit({
    occurrences: [
      { evidenceDate: "2026-07-06", amountMinor: openaiMinor, currency: "INR", merchant: "OpenAI", cadence: "MONTHLY", citedNextExpectedDate: "2026-08-06", explicitProviderRenewal: false },
      { evidenceDate: "2026-08-06", amountMinor: openaiMinor, currency: "INR", merchant: "OpenAI", cadence: "MONTHLY", citedNextExpectedDate: "2026-09-06", explicitProviderRenewal: false },
    ],
  });
  assert.equal(monthly.stable, true);
  assert.equal(monthly.nextDebitDate, "2026-09-06");
  assert.equal(monthly.cadence, "MONTHLY");
  assert.equal(monthly.inputsHash.length, 64);

  const monthEnd = deriveNextDebit({
    occurrences: [
      { evidenceDate: "2026-01-31", amountMinor: openaiMinor, currency: "INR", merchant: "OpenAI", cadence: "MONTHLY", citedNextExpectedDate: "2026-02-28", explicitProviderRenewal: false },
      { evidenceDate: "2026-02-28", amountMinor: openaiMinor, currency: "INR", merchant: "OpenAI", cadence: "MONTHLY", citedNextExpectedDate: "2026-03-31", explicitProviderRenewal: false },
    ],
  });
  assert.equal(monthEnd.stable, true);
  assert.equal(monthEnd.nextDebitDate, "2026-03-31");

  const leap = deriveNextDebit({
    occurrences: [
      { evidenceDate: "2024-02-29", amountMinor: openaiMinor, currency: "INR", merchant: "OpenAI", cadence: "YEARLY", citedNextExpectedDate: "2025-02-28", explicitProviderRenewal: false },
    ],
  });
  assert.equal(leap.stable, false, "one annual occurrence still needs a second dated occurrence or explicit renewal");

  const leapRenewal = deriveNextDebit({
    occurrences: [
      { evidenceDate: "2024-02-29", amountMinor: openaiMinor, currency: "INR", merchant: "OpenAI", cadence: "YEARLY", citedNextExpectedDate: "2025-02-28", explicitProviderRenewal: true },
    ],
  });
  assert.equal(leapRenewal.stable, true);
  assert.equal(leapRenewal.nextDebitDate, "2025-02-28");
  assert.equal(leapRenewal.reason, "CITED_RENEWAL");

  const annual = deriveNextDebit({
    occurrences: [
      { evidenceDate: "2025-08-15", amountMinor: openaiMinor, currency: "INR", merchant: "OpenAI", cadence: "YEARLY", citedNextExpectedDate: "2026-08-15", explicitProviderRenewal: false },
      { evidenceDate: "2026-08-15", amountMinor: openaiMinor, currency: "INR", merchant: "OpenAI", cadence: "YEARLY", citedNextExpectedDate: "2027-08-15", explicitProviderRenewal: false },
    ],
  });
  assert.equal(annual.stable, true);
  assert.equal(annual.nextDebitDate, "2027-08-15");
});

test("corrections, conflicting dates, and caller-supplied dates cannot invent a next debit", () => {
  const corrected = deriveNextDebit({
    occurrences: [
      { evidenceDate: "2026-07-06", amountMinor: openaiMinor, currency: "INR", merchant: "OpenAI", cadence: "MONTHLY", citedNextExpectedDate: "2026-08-06", explicitProviderRenewal: false },
      { evidenceDate: "2026-08-06", amountMinor: openaiMinor, currency: "INR", merchant: "OpenAI", cadence: "MONTHLY", citedNextExpectedDate: "2026-09-06", explicitProviderRenewal: false },
    ],
    correctionInvalidates: true,
  });
  assert.equal(corrected.stable, false);
  assert.equal(corrected.reason, "CORRECTED");

  const conflict = deriveNextDebit({
    occurrences: [
      { evidenceDate: "2026-07-06", amountMinor: openaiMinor, currency: "INR", merchant: "OpenAI", cadence: "MONTHLY", citedNextExpectedDate: "2026-08-06", explicitProviderRenewal: false },
      { evidenceDate: "2026-08-20", amountMinor: openaiMinor, currency: "INR", merchant: "OpenAI", cadence: "MONTHLY", citedNextExpectedDate: "2026-09-20", explicitProviderRenewal: false },
    ],
  });
  assert.equal(conflict.stable, false);
  assert.equal(conflict.reason, "CONFLICTING_DATES");

  const stableOccurrences = [
    { evidenceDate: "2026-07-06", amountMinor: openaiMinor, currency: "INR", merchant: "OpenAI", cadence: "MONTHLY" as const, citedNextExpectedDate: "2026-08-06", explicitProviderRenewal: false },
    { evidenceDate: "2026-08-06", amountMinor: openaiMinor, currency: "INR", merchant: "OpenAI", cadence: "MONTHLY" as const, citedNextExpectedDate: "2026-09-06", explicitProviderRenewal: false },
  ];
  const persisted = deriveNextDebit({ occurrences: stableOccurrences });
  const overridden = deriveNextDebit({
    occurrences: stableOccurrences,
    callerSuppliedDate: "2026-12-01",
    persistedDerivation: persisted,
  });
  assert.equal(overridden.nextDebitDate, "2026-09-06");
  assert.equal(overridden.stable, true);
});

test("shadow gate connected mandates require an active source, not merely an ACTIVE row", () => {
  assert.equal(countsAsConnectedMandate({
    mandateStatus: "ACTIVE",
    workspaceCurrent: true,
    hasActiveRecoverySource: false,
    consentCurrent: true,
  }), false);
  assert.equal(countsAsConnectedMandate({
    mandateStatus: "REVOKED",
    workspaceCurrent: true,
    hasActiveRecoverySource: true,
    consentCurrent: true,
  }), false);
  assert.equal(countsAsConnectedMandate({
    mandateStatus: "ACTIVE",
    workspaceCurrent: true,
    hasActiveRecoverySource: true,
    consentCurrent: true,
  }), true);
});

test("two eligible candidates in one workspace count as one canonical eligible account", () => {
  const eligible = {
    mandateActive: true,
    classificationCurrent: true,
    evidenceFresh: true,
    nonTerminal: true,
    nonWithdrawn: true,
    evaluatorEligible: true,
    providerExecutable: true,
    providerProven: true,
    providerEnabled: true,
    noticeDeliverable: true,
    sourceConnected: true,
    consentCurrent: true,
  };
  assert.equal(countsAsEligibleCandidate({ ...eligible, mandateActive: false }), false);
  assert.equal(countsAsEligibleCandidate({ ...eligible, sourceConnected: false }), false);
  assert.equal(countsAsEligibleCandidate({ ...eligible, consentCurrent: false }), false);
  const snapshot = shadowGateCounts({
    connectedMandateFacts: [
      { mandateStatus: "ACTIVE", workspaceCurrent: true, hasActiveRecoverySource: true, consentCurrent: true },
    ],
    eligibleCandidateFacts: [
      { ...eligible, workspaceId: "ws-1" },
      { ...eligible, workspaceId: "ws-1" },
    ],
    leakageFacts: [],
  });
  assert.equal(snapshot.connectedMandates, 1);
  assert.equal(snapshot.eligibleCandidates, 1);
  assert.equal(evaluateShadowGate(snapshot).passed, false);
});

test("protected leakage is computed from cited facts, not from the candidate class constraint", () => {
  assert.equal(countsAsProtectedLeakage({
    citedClass: "usage-based-cloud",
    protectedOverride: true,
    conflictingProtected: false,
    recordedEligibility: "ELIGIBLE",
  }), true);
  assert.equal(countsAsProtectedLeakage({
    citedClass: "discretionary-subscription",
    protectedOverride: false,
    conflictingProtected: false,
    recordedEligibility: "ELIGIBLE",
  }), false);
  assert.equal(classifyCommitment("AWS subscription", "Amazon Web Services"), "usage-based-cloud");
  const leak = shadowGateCounts({
    connectedMandateFacts: Array.from({ length: 10 }, () => ({
      mandateStatus: "ACTIVE" as const,
      workspaceCurrent: true,
      hasActiveRecoverySource: true,
      consentCurrent: true,
    })),
    eligibleCandidateFacts: Array.from({ length: 5 }, (_, index) => ({
      workspaceId: `ws-${index}`,
      mandateActive: true,
      classificationCurrent: true,
      evidenceFresh: true,
      nonTerminal: true,
      nonWithdrawn: true,
      evaluatorEligible: true,
      providerExecutable: true,
      providerProven: true,
      providerEnabled: true,
      noticeDeliverable: true,
      sourceConnected: true,
      consentCurrent: true,
    })),
    leakageFacts: [{
      citedClass: "usage-based-cloud",
      protectedOverride: true,
      conflictingProtected: false,
      recordedEligibility: "ELIGIBLE",
    }],
  });
  assert.equal(evaluateShadowGate(leak).passed, false);
  assert.equal(leak.protectedLeakage, 1);
});

test("fee periods overlap inclusively, adjacent days do not, and currencies/workspaces are independent", () => {
  assert.equal(feePeriodsOverlap({ start: "2026-08-01", end: "2026-08-31" }, { start: "2026-08-15", end: "2026-09-15" }), true);
  assert.equal(feePeriodsOverlap({ start: "2026-08-01", end: "2026-08-31" }, { start: "2026-09-01", end: "2026-09-30" }), false);
  assert.equal(feePeriodsOverlap({ start: "2026-08-01", end: "2026-08-31" }, { start: "2026-08-31", end: "2026-09-30" }), true);
  assert.throws(() => feePeriodsOverlap({ start: "2026-09-01", end: "2026-08-01" }, { start: "2026-09-01", end: "2026-09-30" }));
});

test("identical fee invoices replay; changed inputs conflict; finalized rows are not mutated", () => {
  const first = computeFirstYearCharge(BigInt(1_000_000));
  const inputsHash = createHash("sha256").update("INR|2026-08-01|2026-08-31|1000000").digest("hex");
  assert.equal(invoiceReplayDecision({
    existing: { inputsHash, retainedMinor: first.retainedMinor },
    incomingInputsHash: inputsHash,
  }), "REPLAY");
  assert.equal(invoiceReplayDecision({
    existing: { inputsHash, retainedMinor: first.retainedMinor },
    incomingInputsHash: createHash("sha256").update("changed").digest("hex"),
  }), "CONFLICT");
});

test("first-year retained charge is cumulative across the year, not independent monthly caps", () => {
  const backLoaded = computeCumulativeFirstYearCharge({
    periods: [
      { monitoringMinor: monitoringFeeMinor, verifiedSavingMinor: BigInt(0) },
      { monitoringMinor: monitoringFeeMinor, verifiedSavingMinor: BigInt(1_000_000) },
    ],
  });
  const independentSecond = computeFirstYearCharge(BigInt(1_000_000));
  assert.equal(independentSecond.retainedMinor, BigInt(150_000));
  assert.equal(backLoaded.verifiedSavingMinor, BigInt(1_000_000));
  assert.equal(backLoaded.monitoringMinor, monitoringFeeMinor + monitoringFeeMinor);
  assert.equal(backLoaded.retainedMinor, BigInt(199_800));
  assert.equal(backLoaded.thisPeriodRetainedMinor, BigInt(199_800));
  const zeroYear = computeCumulativeFirstYearCharge({
    periods: [
      { monitoringMinor: monitoringFeeMinor, verifiedSavingMinor: BigInt(0) },
      { monitoringMinor: monitoringFeeMinor, verifiedSavingMinor: BigInt(0) },
    ],
  });
  assert.equal(zeroYear.retainedMinor, BigInt(0));
});

test("covered windows require Recovery evidence, same currency, continuous coverage, and never invent ₹0 saved", () => {
  const base = {
    workspaceId: "ws-1",
    candidateWorkspaceId: "ws-1",
    commitmentId: "c-1",
    candidateCommitmentId: "c-1",
    currency: "INR",
    candidateCurrency: "INR",
    sourceKind: "REGULATED_STATEMENT" as const,
    sourceWorkspaceId: "ws-1",
    sourceRegulated: true,
    coverageStart: "2026-09-01",
    coverageEnd: "2026-09-30",
    expectedDebitDate: "2026-09-06",
    baselineDebitMinor: openaiMinor,
    observedDebits: [] as const,
  };
  const history = [{ date: "2026-08-06", amountMinor: openaiMinor, currency: "INR" }] as const;
  assert.equal(evaluateCoveredWindowProof({ ...base, historicalDebits: history, sourceWorkspaceId: "ws-other" }).status, "PENDING");
  assert.equal(evaluateCoveredWindowProof({ ...base, historicalDebits: history, coverageStart: "2026-09-01", coverageEnd: "2026-09-03" }).status, "MISSING_COVERAGE");
  assert.equal(evaluateCoveredWindowProof({ ...base, historicalDebits: history, candidateCurrency: "USD" }).status, "MISSING_COVERAGE");
  assert.equal(evaluateCoveredWindowProof({ ...base, historicalDebits: history, sourceRegulated: false }).status, "PENDING");
  assert.equal(evaluateCoveredWindowProof({
    ...base,
    sourceKind: "CSV_IMPORT",
    sourceRegulated: true,
    historicalDebits: history,
  }).status, "PENDING");
  assert.equal(evaluateCoveredWindowProof({
    ...base,
    historicalDebits: history,
    observedDebits: [
      { date: "2026-09-06", amountMinor: BigInt(99_950), currency: "INR", evidenceId: "debit-a" },
      { date: "2026-09-06", amountMinor: BigInt(99_950), currency: "INR", evidenceId: "debit-b" },
    ],
  }).savingMinor, BigInt(0));
  assert.equal(evaluateCoveredWindowProof({
    ...base,
    historicalDebits: history,
    observedDebits: [
      { date: "2026-09-06", amountMinor: openaiMinor, currency: "INR", evidenceId: "same-row" },
      { date: "2026-09-06", amountMinor: openaiMinor, currency: "INR", evidenceId: "same-row" },
    ],
  }).savingMinor, BigInt(0));
  assert.equal(evaluateCoveredWindowProof({
    ...base,
    historicalDebits: history,
    observedDebits: [{ date: "2026-09-06", amountMinor: openaiMinor, currency: "INR" }],
  }).savingMinor, BigInt(0));
  assert.equal(evaluateCoveredWindowProof({
    ...base,
    historicalDebits: history,
    observedDebits: [{ date: "2026-09-06", amountMinor: BigInt(99_900), currency: "INR" }],
  }).savingMinor, openaiMinor - BigInt(99_900));
  const missing = evaluateCoveredWindowProof({ ...base, coverageStart: null, coverageEnd: null });
  assert.equal(missing.status, "PENDING");
  assert.equal(missing.savingMinor, null);
  const clean = evaluateCoveredWindowProof({
    ...base,
    historicalDebits: [{ date: "2026-08-06", amountMinor: openaiMinor, currency: "INR" }],
  });
  assert.equal(clean.status, "COVERED_CLEAN");
  assert.equal(clean.savingMinor, openaiMinor);
  const lateDebit = evaluateCoveredWindowProof({
    ...base,
    historicalDebits: history,
    observedDebits: [{ date: "2026-09-07", amountMinor: openaiMinor, currency: "INR" }],
  });
  assert.equal(lateDebit.status, "NOT_ELIMINATED");
  assert.equal(lateDebit.savingMinor, BigInt(0));
  const expectedOnlyCoverage = evaluateCoveredWindowProof({
    ...base,
    historicalDebits: history,
    coverageStart: "2026-09-06",
    coverageEnd: "2026-09-06",
  });
  assert.equal(expectedOnlyCoverage.status, "MISSING_COVERAGE");
  assert.equal(expectedOnlyCoverage.savingMinor, null);
  assert.deepEqual(debitObservationWindow("2026-09-06"), { start: "2026-09-05", end: "2026-09-09" });
});

test("receipt paste, gmail silence, forwarded mail, and missing historical baseline cannot prove rupees saved", () => {
  const base = {
    workspaceId: "ws-1",
    candidateWorkspaceId: "ws-1",
    commitmentId: "c-1",
    candidateCommitmentId: "c-1",
    currency: "INR",
    candidateCurrency: "INR",
    sourceKind: "REGULATED_STATEMENT" as const,
    sourceWorkspaceId: "ws-1",
    sourceRegulated: true,
    coverageStart: "2026-09-01",
    coverageEnd: "2026-09-30",
    expectedDebitDate: "2026-09-06",
    baselineDebitMinor: openaiMinor,
    observedDebits: [] as const,
    historicalDebits: [{ date: "2026-08-06", amountMinor: openaiMinor, currency: "INR" }],
  };
  assert.equal(evaluateCoveredWindowProof({ ...base, sourceKind: "RECEIPT_PASTE", sourceRegulated: true }).status, "PENDING");
  assert.equal(evaluateCoveredWindowProof({ ...base, sourceKind: "CSV_IMPORT", sourceRegulated: true }).status, "PENDING");
  assert.equal(evaluateCoveredWindowProof({ ...base, sourceKind: "GMAIL_OAUTH", sourceRegulated: true }).status, "PENDING");
  assert.equal(evaluateCoveredWindowProof({ ...base, sourceKind: "FORWARDED_EMAIL", sourceRegulated: true }).status, "PENDING");
  assert.equal(evaluateCoveredWindowProof({ ...base, historicalDebits: [] }).status, "PENDING");
  assert.equal(evaluateCoveredWindowProof({
    ...base,
    coverageGaps: [{ start: "2026-09-04", end: "2026-09-05" }],
  }).status, "MISSING_COVERAGE");
  assert.equal(evaluateCoveredWindowProof({
    ...base,
    observedDebits: [{ date: "2026-09-06", amountMinor: openaiMinor, currency: "INR", corrected: true }],
  }).status, "COVERED_CLEAN");
});

test("catalog providers stay hypotheses; the test adapter cannot activate in production", () => {
  for (const provider of supportedProviders) {
    assert.equal(providerProofStatus(provider), "hypothesis");
    assert.equal(provider.routeProven, false);
    assert.equal(provider.zeroCustomerWork, false);
    assert.equal(isProviderExecutable(provider), false);
  }
  const previous = process.env.NODE_ENV;
  Reflect.set(process.env, "NODE_ENV", "production");
  process.env.AUTOPILOT_TEST_ADAPTER = "true";
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
  try {
    assert.equal(isTestContractAdapterActivatable(), false);
    assert.equal(testContractAdapterId, "vognary-test-adapter");
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", previous);
    delete process.env.AUTOPILOT_TEST_ADAPTER;
    delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
  }
});

test("notice send-acceptance is not delivery; the 48-hour clock starts only from a verified delivered event", () => {
  assert.equal(productionVetoHours(), 48);
  process.env.AUTOPILOT_VETO_HOURS = "1";
  assert.equal(productionVetoHours(), 48);
  delete process.env.AUTOPILOT_VETO_HOURS;

  const queued = { status: "QUEUED" as const, providerMessageId: null, deliveredAt: null, vetoDeadlineAt: null };
  const accepted = applyNoticeDeliveryEvent(queued, { type: "email.sent", providerMessageId: "resend-msg-1", occurredAt: "2026-08-24T01:00:00.000Z" });
  assert.equal(accepted.status, "ACCEPTED");
  assert.equal(accepted.vetoDeadlineAt, null);
  const delivered = applyNoticeDeliveryEvent(accepted, { type: "email.delivered", providerMessageId: "resend-msg-1", occurredAt: "2026-08-24T01:05:00.000Z" });
  assert.equal(delivered.status, "DELIVERED");
  assert.equal(delivered.vetoDeadlineAt, vetoDeadlineFromDelivery(new Date("2026-08-24T01:05:00.000Z")).toISOString());
  const bounced = applyNoticeDeliveryEvent(accepted, { type: "email.bounced", providerMessageId: "resend-msg-1", occurredAt: "2026-08-24T01:06:00.000Z" });
  assert.equal(bounced.status, "BOUNCED");
  assert.equal(bounced.vetoDeadlineAt, null);
  const duplicate = applyNoticeDeliveryEvent(delivered, { type: "email.delivered", providerMessageId: "resend-msg-1", occurredAt: "2026-08-24T01:07:00.000Z" });
  assert.equal(duplicate.status, "DELIVERED");
  assert.equal(duplicate.vetoDeadlineAt, delivered.vetoDeadlineAt);
  const delayedAlias = applyNoticeDeliveryEvent(accepted, {
    type: "email.delivery_delayed",
    providerMessageId: "resend-msg-1",
    occurredAt: "2026-08-24T01:03:00.000Z",
  });
  assert.equal(delayedAlias.status, "DELAYED");
  const outOfOrderComplaint = applyNoticeDeliveryEvent(delivered, {
    type: "email.complained",
    providerMessageId: "resend-msg-1",
    occurredAt: "2026-08-24T01:04:00.000Z",
  });
  assert.equal(outOfOrderComplaint.status, "DELIVERED");
  const laterComplaint = applyNoticeDeliveryEvent({
    ...delivered,
    lastEventOccurredAt: "2026-08-24T01:05:00.000Z",
  }, {
    type: "email.complained",
    providerMessageId: "resend-msg-1",
    occurredAt: "2026-08-24T01:08:00.000Z",
  });
  assert.equal(laterComplaint.status, "COMPLAINED");
  assert.equal(laterComplaint.deliveredAt, null);
  assert.equal(laterComplaint.vetoDeadlineAt, null);
  const laterDeliveredAfterBounce = applyNoticeDeliveryEvent({
    ...bounced,
    lastEventOccurredAt: "2026-08-24T01:06:00.000Z",
  }, {
    type: "email.delivered",
    providerMessageId: "resend-msg-1",
    occurredAt: "2026-08-24T01:09:00.000Z",
  });
  assert.equal(laterDeliveredAfterBounce.status, "BOUNCED");
  assert.equal(laterDeliveredAfterBounce.deliveredAt, null);
  assert.equal(laterDeliveredAfterBounce.vetoDeadlineAt, null);
  const laterDeliveredAfterComplaint = applyNoticeDeliveryEvent({
    ...laterComplaint,
    lastEventOccurredAt: "2026-08-24T01:08:00.000Z",
  }, {
    type: "email.delivered",
    providerMessageId: "resend-msg-1",
    occurredAt: "2026-08-24T01:10:00.000Z",
  });
  assert.equal(laterDeliveredAfterComplaint.status, "COMPLAINED");
  assert.equal(laterDeliveredAfterComplaint.vetoDeadlineAt, null);
});

test("a same-timestamp complaint, bounce, or failure takes precedence over an earlier delivered event", () => {
  const deliveredAt = "2026-08-24T01:05:00.000Z";
  const delivered = applyNoticeDeliveryEvent(
    { status: "ACCEPTED", providerMessageId: "resend-msg-same", deliveredAt: null, vetoDeadlineAt: null },
    { type: "email.delivered", providerMessageId: "resend-msg-same", occurredAt: deliveredAt },
  );
  assert.equal(delivered.status, "DELIVERED");
  assert.ok(delivered.vetoDeadlineAt);

  for (const [type, status] of [
    ["email.complained", "COMPLAINED"],
    ["email.bounced", "BOUNCED"],
    ["email.failed", "FAILED"],
  ] as const) {
    const terminal = applyNoticeDeliveryEvent(delivered, {
      type,
      providerMessageId: "resend-msg-same",
      occurredAt: deliveredAt,
    });
    assert.equal(terminal.status, status, `${type} at the delivered timestamp must become ${status}`);
    assert.equal(terminal.deliveredAt, null);
    assert.equal(terminal.vetoDeadlineAt, null);
    const duplicate = applyNoticeDeliveryEvent(terminal, {
      type,
      providerMessageId: "resend-msg-same",
      occurredAt: deliveredAt,
    });
    assert.equal(duplicate.status, status);
    const olderDelivered = applyNoticeDeliveryEvent(terminal, {
      type: "email.delivered",
      providerMessageId: "resend-msg-same",
      occurredAt: "2026-08-24T01:04:59.000Z",
    });
    assert.equal(olderDelivered.status, status);
    assert.equal(olderDelivered.vetoDeadlineAt, null);
  }
});

test("execution idempotency binds minutes, proof, and failure reason as well as the actor path", () => {
  const base = {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    candidateId: "22222222-2222-4222-8222-222222222222",
    actorUserId: "33333333-3333-4333-8333-333333333333",
    outcome: "EXECUTED" as const,
    providerId: "openai",
    minutes: 6,
    proofKind: "MERCHANT_CONFIRMATION_EMAIL",
    proofReference: "msg-1",
    failureReason: null as string | null,
  };
  const first = bindExecutionIdempotency(base);
  const replay = bindExecutionIdempotency(base);
  assert.equal(first.requestHash, replay.requestHash);
  assert.equal(resolveExecutionReplay(first.requestHash, replay.requestHash), "REPLAY");
  assert.equal(resolveExecutionReplay(first.requestHash, bindExecutionIdempotency({ ...base, minutes: 12 }).requestHash), "CONFLICT");
  assert.equal(resolveExecutionReplay(first.requestHash, bindExecutionIdempotency({ ...base, proofReference: "msg-2" }).requestHash), "CONFLICT");
  assert.equal(resolveExecutionReplay(first.requestHash, bindExecutionIdempotency({ ...base, proofKind: "CANCELLATION_RECEIPT" }).requestHash), "CONFLICT");
  assert.equal(resolveExecutionReplay(first.requestHash, bindExecutionIdempotency({ ...base, failureReason: "merchant-timeout" }).requestHash), "CONFLICT");
  const outcomeConflict = bindExecutionIdempotency({ ...base, outcome: "FAILED" });
  assert.equal(resolveExecutionReplay(first.requestHash, outcomeConflict.requestHash), "CONFLICT");
  assert.equal(
    executionOperationKey({ candidateId: "22222222-2222-4222-8222-222222222222", attemptNo: 1 }),
    "autopilot-execute:22222222-2222-4222-8222-222222222222:1",
  );
});

test("SHADOW and NOTICE_QUEUED can never execute, including after the veto clock", () => {
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
  assert.equal(executionBlockReason({ ...authorized, status: "SHADOW" }), "STATUS_NOT_AUTHORIZED");
  assert.equal(executionBlockReason({ ...authorized, status: "NOTICE_QUEUED" }), "STATUS_NOT_AUTHORIZED");
  assert.equal(canTransitionCandidate("SHADOW", "EXECUTED", {
    executionEnabled: true,
    noticeDelivered: true,
    noticeEnabled: true,
    now: deadline,
    vetoDeadline: deadline,
    vetoed: false,
    revoked: false,
  }), false);
  assert.equal(canTransitionCandidate("NOTICE_QUEUED", "EXECUTED", {
    executionEnabled: true,
    noticeDelivered: true,
    noticeEnabled: true,
    now: deadline,
    vetoDeadline: deadline,
    vetoed: false,
    revoked: false,
  }), false);
});

test("honest EXCEPTION can be recorded for unsupported routes without inventing an executable provider", () => {
  const deadline = new Date("2026-08-16T00:00:00.000Z");
  const exception = {
    executionEnabled: true,
    shadowGatePassed: false,
    mandateActive: true,
    eligibility: "UNSUPPORTED_ROUTE" as const,
    status: "SHADOW" as const,
    noticeDelivered: false,
    vetoDeadline: null as Date | null,
    now: deadline,
    vetoed: false,
    revoked: false,
    providerExecutable: false,
    providerDisabled: false,
    outcome: "EXCEPTION" as const,
  };
  assert.equal(executionBlockReason(exception), null);
  assert.equal(executionBlockReason({ ...exception, executionEnabled: false }), null);
  assert.equal(executionBlockReason({ ...exception, outcome: "EXECUTED" }), "SHADOW_GATE");
  assert.equal(executionBlockReason({ ...exception, executionEnabled: false, outcome: "EXECUTED" }), "EXECUTION_DISABLED");
  assert.equal(executionBlockReason({ ...exception, eligibility: "PROTECTED" }), "INELIGIBLE");
  assert.equal(canTransitionCandidate("SHADOW", "EXCEPTION", {
    executionEnabled: true,
    noticeDelivered: false,
    noticeEnabled: false,
    now: deadline,
    vetoDeadline: null,
    vetoed: false,
    revoked: false,
  }), true);
});

test("signed veto tokens are bound to workspace and candidate and reject tampering", () => {
  const secret = "veto-signing-secret-for-tests-32bytes!!";
  const token = signVetoToken({
    workspaceId: "11111111-1111-4111-8111-111111111111",
    candidateId: "22222222-2222-4222-8222-222222222222",
    expiresAt: "2026-08-26T01:00:00.000Z",
  }, secret);
  const verified = verifyVetoToken(token, secret, new Date("2026-08-25T00:00:00.000Z"));
  assert.equal(verified?.candidateId, "22222222-2222-4222-8222-222222222222");
  assert.equal(verifyVetoToken(`${token}x`, secret, new Date("2026-08-25T00:00:00.000Z")), null);
  assert.equal(verifyVetoToken(token, secret, new Date("2026-08-27T00:00:00.000Z")), null);
  assert.equal(isVetoTokenSecretValid("x"), false);
  assert.equal(isVetoTokenSecretValid("é".repeat(16)), true);
  assert.throws(() => signVetoToken({
    workspaceId: "11111111-1111-4111-8111-111111111111",
    candidateId: "22222222-2222-4222-8222-222222222222",
    expiresAt: "2026-08-26T01:00:00.000Z",
  }, "x"), /32 bytes/i);
  assert.equal(verifyVetoToken(token, "x", new Date("2026-08-25T00:00:00.000Z")), null);
});

test("production cannot skip the measured shadow gate with a test switch", () => {
  const previous = process.env.NODE_ENV;
  const previousPass = process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS;
  Reflect.set(process.env, "NODE_ENV", "production");
  process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS = "true";
  try {
    assert.equal(executionMayProceedPastShadowGate(false), false);
    assert.equal(executionMayProceedPastShadowGate(true), true);
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", previous);
    if (previousPass === undefined) delete process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS;
    else process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS = previousPass;
  }
});

test("AWS and Hindi protected strings cannot leak into eligible shadow counts", () => {
  assert.equal(classifyCommitment("AWS subscription"), "usage-based-cloud");
  assert.equal(classifyCommitment("OpenAI ऑटोपे subscription"), "debt-emi");
  assert.equal(countsAsProtectedLeakage({
    citedClass: classifyCommitment("AWS subscription"),
    protectedOverride: false,
    conflictingProtected: false,
    recordedEligibility: "ELIGIBLE",
  }), true);
  assert.equal(countsAsProtectedLeakage({
    citedClass: classifyCommitment("OpenAI ऑटोपे subscription"),
    protectedOverride: true,
    conflictingProtected: false,
    recordedEligibility: "ELIGIBLE",
  }), true);
});

test("production veto hours stay 48 even if env tries to shorten the clock", () => {
  const previous = process.env.AUTOPILOT_VETO_HOURS;
  process.env.AUTOPILOT_VETO_HOURS = "1";
  try {
    assert.equal(productionVetoHours(), 48);
  } finally {
    if (previous === undefined) delete process.env.AUTOPILOT_VETO_HOURS;
    else process.env.AUTOPILOT_VETO_HOURS = previous;
  }
});

test("store contracts keep pasted next dates from inventing renewal, start execution events, and ignore unknown webhooks", () => {
  const store = readFileSync(new URL("../src/lib/server/recovery-autopilot-store.ts", import.meta.url), "utf8");
  const recoveryStore = readFileSync(new URL("../src/lib/server/recovery-store.ts", import.meta.url), "utf8");
  assert.match(store, /receiptNextDateIsExplicit/);
  assert.match(store, /provenance_kind === "PROVIDER_RECEIVED"/);
  assert.doesNotMatch(store, /coalesce\(candidate\.next_debit_date, commitment\.effective_next_expected_date\)/);
  const applyPendingFn = store.slice(
    store.indexOf("async function applyPendingNoticeEvents"),
    store.indexOf("export async function expireUnboundNoticeEvents"),
  );
  assert.doesNotMatch(applyPendingFn, /delete from recovery_notice_pending_events where provider_message_id/);
  const sessionVeto = store.slice(
    store.indexOf("export async function vetoAutopilotCandidate("),
    store.indexOf("export async function refreshAutopilotCandidates"),
  );
  assert.match(sessionVeto, /status in \('SHADOW', 'NOTICE_QUEUED', 'AUTHORIZED_BY_RULE'\)/);
  assert.match(store, /eventName: "execution.started"/);
  assert.match(store, /status: "ignored" as const/);
  assert.match(store, /recovery_autopilot_dead_letters/);
  assert.match(store, /standingMandateConsentPurpose/);
  const funnelSource = readFileSync(new URL("../src/lib/recovery/autopilot-funnel.ts", import.meta.url), "utf8");
  assert.match(funnelSource, /standing-mandate-autopilot/);
  assert.match(store, /begin isolation level serializable/);
  assert.match(store, /sourceRegulated: false/);
  assert.doesNotMatch(store, /sourceRegulated: covering\?\.source_type === "CSV_IMPORT"/);
  assert.match(store, /feePeriodCrossesBillingAnniversary/);
  assert.match(store, /freezeAutopilotNotice/);
  assert.match(store, /veto_expires_at/);
  assert.match(store, /notice_body_hash/);
  assert.match(store, /AUTOPILOT_TEST_NOTICE_PERSIST_CRASH/);
  assert.match(store, /NODE_ENV !== "production"[\s\S]{0,120}AUTOPILOT_TEST_NOTICE_PERSIST_CRASH/);
  assert.match(store, /pg_advisory_lock\(hashtextextended\('autopilot-shadow-gate', 0\)\)/);
  assert.match(store, /pg_advisory_unlock\(hashtextextended\('autopilot-shadow-gate', 0\)\)/);
  for (const [start, end] of [
    ["export async function materializeForwardedEmailEvidence", "export async function getRecoveryHome"],
    ["export async function submitRecoveryEvidence", "export async function createRecoveryCorrection"],
    ["export async function putRecoveryDecision", "type PutDecisionMutationData"],
    ["async function mutateCorrection", "async function persistSubmissionSources"],
  ]) {
    const mutation = recoveryStore.slice(recoveryStore.indexOf(start), recoveryStore.indexOf(end));
    assert.ok(mutation.indexOf("lockAutopilotAuthorityGate(client)") > mutation.indexOf('client.query("begin")'));
    assert.ok(mutation.indexOf("lockAutopilotAuthorityGate(client)") < mutation.indexOf("lockRecoveryWorkspace(client"));
  }
  const consentRevocation = store.slice(
    store.indexOf("export async function revokeActiveStandingMandateForConsentWithdrawal"),
    store.indexOf("export async function disconnectRecoverySource"),
  );
  assert.ok(consentRevocation.indexOf("lockAutopilotAuthorityGate(client)") < consentRevocation.indexOf("lockWorkspace(client"));
  const freezeIndex = store.indexOf("freezeAutopilotNotice");
  const sendIndex = store.indexOf("sendAutopilotNotice");
  assert.ok(freezeIndex >= 0 && sendIndex > freezeIndex);
  assert.match(store, /executionMayProceedPastShadowGate/);
  assert.match(store, /KIND_NOT_REPLAYABLE/);
  assert.match(store, /billingYearStart/);
  assert.match(store, /candidateClockAuthorizes/);
  assert.match(store, /candidate\.notice_delivered_at is not null/);
  assert.match(store, /candidate\.veto_deadline_at is not null/);
  assert.match(store, /candidate\.veto_deadline_at <= \$1/);
  assert.doesNotMatch(store, /notice\.delivered_at \+ make_interval\(hours => \$2\)/);
  assert.match(store, /NOTICE_TOKEN_COVERAGE_INVALID/);
  assert.match(store, /expireUnboundNoticeEvents/);
  assert.match(store, /UNBOUND_NOTICE_EVENT/);
  const expireFn = store.slice(
    store.indexOf("export async function expireUnboundNoticeEvents"),
    store.indexOf("export async function applyAutopilotNoticeEvent"),
  );
  assert.match(expireFn, /applyAutopilotNoticeEvent/);
  assert.ok(expireFn.indexOf("applyAutopilotNoticeEvent") < expireFn.lastIndexOf("UNBOUND_NOTICE_EVENT"));
  assert.match(store, /frozenAutopilotNoticeFromPersistence/);
  assert.match(store, /notice_tags/);
  assert.match(store, /disconnectRecoverySource/);
  assert.match(store, /source-disconnected/);
  assert.doesNotMatch(store, /assertRole\(client, input.actorUserId, input.workspaceId, "admin"\);\n    const catalog = lookupCatalogProviderById/);
  const workspaceDisable = readFileSync(new URL("../src/app/api/workspaces/current/autopilot/providers/[providerId]/disable/route.ts", import.meta.url), "utf8");
  assert.match(workspaceDisable, /founder\/internal-operator only/);
  assert.doesNotMatch(workspaceDisable, /disableProviderEmergency/);
  const internalDisable = readFileSync(new URL("../src/app/api/internal/autopilot/providers/[providerId]/disable/route.ts", import.meta.url), "utf8");
  assert.match(internalDisable, /requireInternalSecret/);
  const funnel = readFileSync(new URL("../src/lib/recovery/autopilot-funnel.ts", import.meta.url), "utf8");
  assert.match(funnel, /currentlyEligibleAccountsSql/);
  assert.match(funnel, /d30ConnectedRetentionReturnedSql/);
  assert.match(funnel, /recovery_connected_mandate_cohort/);
  assert.match(funnel, /candidateClassificationCurrentSql/);
  assert.doesNotMatch(funnel, /current_date - 90/);
  assert.match(funnel, /candidateCitedSourcesCurrentSql/);
  const eligibleSql = funnel.slice(
    funnel.indexOf("export const currentlyEligibleAccountsSql"),
    funnel.indexOf("export const d30ConnectedRetentionEligibleSql"),
  );
  assert.match(eligibleSql, /candidateCitedSourcesCurrentSql/);
  assert.match(eligibleSql, /candidateClassificationCurrentSql/);
  assert.doesNotMatch(eligibleSql, /currentlyConnectedSourceSql/);
  const connectedSql = funnel.slice(
    funnel.indexOf("export const connectedActiveMandatesSql"),
    funnel.indexOf("export const currentlyEligibleAccountsSql"),
  );
  assert.match(connectedSql, /currentlyConnectedSourceSql/);
  const withdrawFn = store.slice(
    store.indexOf("async function withdrawQueuedCandidatesForMissingSource"),
    store.indexOf("async function restoreCandidatesAfterSourceReconnect"),
  );
  assert.match(withdrawFn, /candidateCitedSourcesCurrentSql/);
  assert.doesNotMatch(withdrawFn, /countCurrentSources/);
  const restoreFn = store.slice(
    store.indexOf("async function restoreCandidatesAfterSourceReconnect"),
    store.indexOf("function toSourceDisconnectionDto"),
  );
  assert.match(restoreFn, /candidateCitedSourcesCurrentSql/);
  assert.match(restoreFn, /candidateClassificationCurrentSql/);
  assert.match(restoreFn, /const nextStatus = "SHADOW"/);
  assert.doesNotMatch(restoreFn, /\? "NOTICE_QUEUED"/);
  assert.doesNotMatch(restoreFn, /countCurrentSources/);
  const executeFn = store.slice(
    store.indexOf("export async function recordOperatorExecution"),
    store.indexOf("export async function listAutopilotDeadLetters"),
  );
  assert.match(executeFn, /SOURCE_DISCONNECTED/);
  assert.match(executeFn, /candidateCitedSourcesCurrentSql/);
  assert.match(executeFn, /candidateClassificationCurrentSql/);
  assert.ok(executeFn.indexOf("readIdempotent") < executeFn.indexOf("SOURCE_DISCONNECTED"));
  const queueFn = store.slice(
    store.indexOf("export async function queueDueNotices"),
    store.indexOf("export async function sendQueuedAutopilotNotices"),
  );
  assert.match(queueFn, /candidateCitedSourcesCurrentSql/);
  assert.match(queueFn, /candidateClassificationCurrentSql/);
  assert.match(queueFn, /standingMandateConsentExistsSql/);
  const authorizeFn = store.slice(
    store.indexOf("export async function authorizeSilentCases"),
    store.indexOf("export async function recordOperatorExecution"),
  );
  assert.match(authorizeFn, /standingMandateConsentExistsSql/);
  const readiness = readFileSync(new URL("../src/lib/server/feature-readiness.ts", import.meta.url), "utf8");
  assert.match(readiness, /isAutopilotExecutionEnabled\(\)/);
  assert.match(readiness, /isVetoTokenSecretValid/);
  assert.match(readiness, /0040_autopilot_review_integrity/);
  assert.doesNotMatch(readiness, /migrationId: "0039_autopilot_frozen_notice_integrity"/);
  const privacy = readFileSync(new URL("../src/lib/server/privacy-lifecycle-store.ts", import.meta.url), "utf8");
  assert.doesNotMatch(privacy, /as "noticeFingerprint"/);
  assert.doesNotMatch(privacy, /as "payloadHash"/);
  assert.doesNotMatch(privacy, /veto_token_hash|notice_body_hash|proof_reference_hash|notice_fingerprint/);
  assert.match(privacy, /as provider_controls/);
  assert.match(privacy, /connected_mandate_cohort/);
  assert.match(privacy, /source_disconnections/);
  assert.doesNotMatch(privacy, /notice_text|notice_from_email|notice_to_email|notice_subject|notice_tags/);
});

test("first-year billing uses a twelve-month customer anchor instead of calendar January", () => {
  assert.equal(billingYearStart("2026-08-15", "2026-08-15"), "2026-08-15");
  assert.equal(billingYearStart("2026-08-15", "2027-01-01"), "2026-08-15");
  assert.equal(billingYearStart("2026-08-15", "2027-08-14"), "2026-08-15");
  assert.equal(billingYearStart("2026-08-15", "2027-08-15"), "2027-08-15");
  assert.equal(billingYearStart("2024-02-29", "2025-02-27"), "2024-02-29");
  assert.equal(billingYearStart("2024-02-29", "2025-02-28"), "2025-02-28");
  assert.equal(feePeriodCrossesBillingAnniversary("2026-08-15", "2027-08-01", "2027-08-31"), true);
  assert.equal(feePeriodCrossesBillingAnniversary("2026-08-15", "2027-08-15", "2027-08-31"), false);
  assert.equal(feePeriodCrossesBillingAnniversary("2026-08-15", "2027-01-01", "2027-01-31"), false);
});

test("the same notice idempotency key keeps the veto token and body frozen across retries", () => {
  const input = {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    candidateId: "22222222-2222-4222-8222-222222222222",
    expiresAt: "2026-08-29T12:00:00.000Z",
    appUrl: "https://vognary.com",
    secret: "veto-signing-secret-for-tests-32bytes!!",
    from: "notices@vognary.com",
    to: "owner@example.test",
  };
  const first = freezeAutopilotNotice(input);
  const replay = freezeAutopilotNotice(input);
  assert.equal(first.token, replay.token);
  assert.equal(first.text, replay.text);
  assert.equal(first.bodyHash, replay.bodyHash);
  assert.equal(first.from, "notices@vognary.com");
  assert.equal(first.to, "owner@example.test");
  assert.equal(first.idempotencyKey, "notice:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222");
  assert.deepEqual(first.tags, [autopilotNoticeResendTag]);
  assert.equal(first.payloadVersion, autopilotNoticePayloadVersion);
  assert.equal(first.bodyHash, hashAutopilotNoticeProviderPayload({
    from: first.from,
    to: first.to,
    subject: first.subject,
    text: first.text,
    tags: first.tags,
    payloadVersion: first.payloadVersion,
  }));
  assert.equal(autopilotNoticeResendTag.name, "vognary");
  assert.equal(autopilotNoticeResendTag.value, "autopilot-notice");
  const later = freezeAutopilotNotice({ ...input, expiresAt: "2026-08-30T12:00:00.000Z" });
  assert.notEqual(later.token, first.token);
  assert.notEqual(later.text, first.text);
});

test("a frozen notice keeps its original Resend tags after the default tag definition changes", () => {
  const input = {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    candidateId: "22222222-2222-4222-8222-222222222222",
    expiresAt: "2026-08-29T12:00:00.000Z",
    appUrl: "https://vognary.com",
    secret: "veto-signing-secret-for-tests-32bytes!!",
    from: "notices@vognary.com",
    to: "owner@example.test",
  };
  const first = freezeAutopilotNotice(input);
  const afterDeploy = freezeAutopilotNotice({
    ...input,
    tags: [{ name: "vognary", value: "autopilot-notice-v2" }],
    payloadVersion: 2,
  });
  assert.notDeepEqual(afterDeploy.tags, first.tags);
  assert.notEqual(afterDeploy.bodyHash, first.bodyHash);
  const replayed = frozenAutopilotNoticeFromPersistence({
    workspaceId: input.workspaceId,
    candidateId: input.candidateId,
    tokenHash: first.tokenHash,
    from: first.from,
    to: first.to,
    subject: first.subject,
    text: first.text,
    tags: first.tags,
    payloadVersion: first.payloadVersion,
    bodyHash: first.bodyHash,
  });
  assert.deepEqual(replayed.tags, first.tags);
  assert.equal(replayed.payloadVersion, first.payloadVersion);
  assert.equal(replayed.bodyHash, first.bodyHash);
  assert.equal(replayed.idempotencyKey, first.idempotencyKey);
});

test("delivery does not start the 48-hour clock when the signed veto token expires before the deadline", () => {
  const deliveredAt = new Date("2026-08-24T00:00:00.000Z");
  assert.equal(noticeClockMayStart({ tokenExpiresAt: "2026-08-25T12:00:00.000Z", deliveredAt }), false);
  assert.equal(noticeClockMayStart({ tokenExpiresAt: "2026-08-26T00:00:00.000Z", deliveredAt }), true);
  assert.equal(noticeClockMayStart({ tokenExpiresAt: "not-a-date", deliveredAt }), false);
});

test("Resend retries outside the 24-hour idempotency window fail closed", () => {
  const frozenAt = new Date("2026-08-14T00:00:00.000Z");
  assert.equal(resendIdempotencyWindowOpen(frozenAt, new Date("2026-08-14T23:59:59.000Z")), true);
  assert.equal(resendIdempotencyWindowOpen(frozenAt, new Date("2026-08-15T00:00:01.000Z")), false);
});

test("notice crash contracts hold unmatched recognized events, freeze the full Resend payload, and do not overclaim scoreboard 9", () => {
  const store = readFileSync(new URL("../src/lib/server/recovery-autopilot-store.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../src/app/api/webhooks/resend/notice/route.ts", import.meta.url), "utf8");
  const mailer = readFileSync(new URL("../src/lib/server/autopilot-mailer.ts", import.meta.url), "utf8");
  const funnel = readFileSync(new URL("../src/lib/recovery/autopilot-funnel.ts", import.meta.url), "utf8");
  const scoreboard = readFileSync(new URL("../docs/execution/scoreboard.md", import.meta.url), "utf8");
  const handoff = readFileSync(new URL("../docs/CONTINUE-HERE.md", import.meta.url), "utf8");
  assert.match(store, /status: "pending" as const/);
  assert.match(store, /recovery_notice_pending_events/);
  assert.match(store, /notice_from_email/);
  assert.match(store, /notice_to_email/);
  assert.match(store, /notice_subject/);
  assert.match(store, /notice_text/);
  assert.match(store, /frozen_at/);
  assert.match(store, /IDEMPOTENCY_WINDOW_EXPIRED/);
  assert.match(store, /noticeClockMayStart/);
  assert.match(store, /recovery_connected_mandate_cohort/);
  assert.doesNotMatch(store, /values \('WEBHOOK', \$1, 'UNMATCHED_NOTICE'\)/);
  assert.match(route, /result\.status === "pending"/);
  assert.match(route, /503/);
  assert.match(route, /hasAutopilotNoticeTag/);
  assert.match(route, /hasControlAttentionTag/);
  assert.match(route, /applyControlAttentionProviderEvent/);
  assert.match(route, /controlResult\.result === "pending"/);
  assert.match(mailer, /from: input\.from/);
  assert.match(mailer, /tags: input\.tags/);
  assert.match(funnel, /recovery_provider_disables/);
  assert.match(funnel, /recovery_connected_mandate_cohort/);
  assert.match(funnel, /recovery_source_disconnections/);
  assert.match(funnel, /canonicalProvenProviderIds/);
  assert.doesNotMatch(funnel, /export function catalogProvenProviderIds/);
  assert.match(funnel, /unmeasured/);
  assert.match(funnel, /provenProviderIds/);
  assert.match(funnel, /noticeReady/);
  assert.doesNotMatch(funnel, /options\.provenProviderIds/);
  assert.match(scoreboard, /\| Backend readiness \| 8 \|/);
  assert.doesNotMatch(scoreboard, /\| Backend readiness \| 9 \|/);
  assert.doesNotMatch(handoff, /without survivorship bias/);
  assert.doesNotMatch(handoff, /the same idempotency key cannot change the veto payload after a crash between provider accept and persistence/);
});

test("founder switches stay off for 1 and yes; only literal true enables them", () => {
  const previousExecution = process.env.AUTOPILOT_EXECUTION_ENABLED;
  const previousNotice = process.env.AUTOPILOT_NOTICE_ENABLED;
  try {
    process.env.AUTOPILOT_EXECUTION_ENABLED = "1";
    process.env.AUTOPILOT_NOTICE_ENABLED = "yes";
    assert.equal(isAutopilotExecutionEnabled(), false);
    assert.equal(isAutopilotNoticeEnabled(), false);
    process.env.AUTOPILOT_EXECUTION_ENABLED = "TRUE";
    process.env.AUTOPILOT_NOTICE_ENABLED = " true";
    assert.equal(isAutopilotExecutionEnabled(), false);
    assert.equal(isAutopilotNoticeEnabled(), false);
  } finally {
    if (previousExecution === undefined) delete process.env.AUTOPILOT_EXECUTION_ENABLED;
    else process.env.AUTOPILOT_EXECUTION_ENABLED = previousExecution;
    if (previousNotice === undefined) delete process.env.AUTOPILOT_NOTICE_ENABLED;
    else process.env.AUTOPILOT_NOTICE_ENABLED = previousNotice;
  }
  const switchSource = readFileSync(new URL("../src/lib/recovery/autopilot-switch.ts", import.meta.url), "utf8");
  assert.match(switchSource, /process\.env\[name\] === "true"/);
  assert.doesNotMatch(switchSource, /value === "1"|value === "yes"/);
});

test("SLO breaches fire for queue age, delivery failure, protected leakage, and dead letters", () => {
  assert.deepEqual(autopilotSloBreaches({
    oldestQueuedNoticeSeconds: 60,
    noticesFailed24h: 0,
    noticesDelivered24h: 10,
    pendingVerifications: 0,
    deadLetters: 0,
    protectedLeakage: 0,
  }), []);
  assert.ok(autopilotSloBreaches({
    oldestQueuedNoticeSeconds: 16 * 60,
    noticesFailed24h: 3,
    noticesDelivered24h: 1,
    pendingVerifications: 0,
    deadLetters: 1,
    protectedLeakage: 1,
  }).includes("NOTICE_QUEUE_AGE"));
});

test("authorization requires the persisted candidate clock, not a recomputed notice.delivered_at deadline", () => {
  const deliveredAt = new Date("2026-08-24T01:00:00.000Z");
  const shortDeadline = new Date("2026-08-24T12:00:00.000Z");
  const afterFortyNineHours = new Date("2026-08-26T02:00:00.000Z");
  const fromNoticeOnly = candidateClockAuthorizes({
    noticeStatus: "DELIVERED",
    providerMessageId: "resend-msg-clock",
    noticeDeliveredAt: null,
    vetoDeadlineAt: null,
  });
  assert.equal(fromNoticeOnly.noticeDelivered, false);
  assert.equal(fromNoticeOnly.vetoDeadline, null);
  const fromCandidateClock = candidateClockAuthorizes({
    noticeStatus: "DELIVERED",
    providerMessageId: "resend-msg-clock",
    noticeDeliveredAt: deliveredAt,
    vetoDeadlineAt: shortDeadline,
  });
  assert.equal(fromCandidateClock.noticeDelivered, true);
  assert.equal(fromCandidateClock.vetoDeadline?.toISOString(), shortDeadline.toISOString());
  assert.equal(canTransitionCandidate("NOTICE_QUEUED", "AUTHORIZED_BY_RULE", {
    executionEnabled: true,
    noticeDelivered: fromNoticeOnly.noticeDelivered,
    noticeEnabled: true,
    now: afterFortyNineHours,
    vetoDeadline: fromNoticeOnly.vetoDeadline,
    vetoed: false,
    revoked: false,
  }), false);
  const schema = readFileSync(new URL("../infra/postgres/schema.sql", import.meta.url), "utf8");
  const evidenceFn = schema.slice(
    schema.indexOf("create or replace function reject_recovery_evidence_mutation()"),
    schema.indexOf("recovery_evidence_immutable_trigger"),
  );
  assert.match(evidenceFn, /not exists \(select 1 from workspaces where id = old.workspace_id\)/);
  assert.doesNotMatch(evidenceFn, /recovery_sources/);
  assert.match(schema, /reject_recovery_cohort_mutation/);
  assert.match(schema, /recovery_source_disconnections/);
  assert.match(schema, /notice_tags jsonb/);
  assert.match(schema, /reconnected_at timestamptz/);
});

test("Autopilot Resend tags are constant non-PII and required before a pending hold", () => {
  assert.equal(hasAutopilotNoticeTag([{ name: "vognary", value: "autopilot-notice" }]), true);
  assert.equal(hasAutopilotNoticeTag({ vognary: "autopilot-notice" }), true);
  assert.equal(hasAutopilotNoticeTag([{ name: "vognary", value: "other" }]), false);
  assert.equal(hasAutopilotNoticeTag([]), false);
  assert.equal(hasAutopilotNoticeTag(undefined), false);
  assert.equal(unboundNoticeEventRetentionMs, 24 * 60 * 60 * 1000);
  const dueRun = readFileSync(new URL("../src/app/api/internal/autopilot/due/run/route.ts", import.meta.url), "utf8");
  assert.match(dueRun, /expireUnboundNoticeEvents/);
});

test("production funnel proven IDs come from the catalog used by execution; test flags cannot activate production", () => {
  assert.deepEqual(catalogProvenProviderIds(), []);
  assert.equal(supportedProviders.filter((provider) => provider.routeProven && provider.proofStatus === "proven").length, 0);
  const openai = lookupCatalogProviderById("openai");
  assert.ok(openai);
  const previousEnv = process.env.NODE_ENV;
  const previousIds = process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
  try {
    Reflect.set(process.env, "NODE_ENV", "production");
    process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";
    assert.deepEqual(liveProvenProviderIds(), []);
    assert.deepEqual(canonicalProvenProviderIds(), []);
    assert.equal(isProviderRouteProven(openai), false);
    const loginProven = {
      ...openai,
      routeProven: true,
      proofStatus: "proven" as const,
      requiresLogin: true,
      zeroCustomerWork: false,
    };
    assert.equal(isCatalogProviderProven(loginProven), false);
    assert.equal(isProviderRouteProven(loginProven), false);
    assert.equal(isProviderExecutable(loginProven), false);
    const otpProven = { ...loginProven, requiresLogin: false, requiresOtp: true };
    assert.equal(isCatalogProviderProven(otpProven), false);
    const phoneProven = { ...loginProven, requiresLogin: false, requiresPhone: true };
    assert.equal(isCatalogProviderProven(phoneProven), false);
    const provenFixture = {
      ...openai,
      routeProven: true,
      proofStatus: "proven" as const,
      requiresLogin: false,
      requiresOtp: false,
      requiresPhone: false,
      zeroCustomerWork: true,
    };
    assert.equal(isCatalogProviderProven(provenFixture), true);
    assert.equal(isProviderRouteProven(provenFixture), true);
    assert.equal(isProviderExecutable(provenFixture), true);
  } finally {
    if (previousEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", previousEnv);
    if (previousIds === undefined) delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    else process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previousIds;
  }
});
