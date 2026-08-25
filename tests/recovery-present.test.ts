import assert from "node:assert/strict";
import test from "node:test";
import type { AttentionItemDto, ExpectedVsObservedDto, HomeProjectionDto } from "../src/lib/recovery/contracts";
import { errorCopy } from "../src/app/workspace/recovery/labels";
import {
  chargeWhenLine,
  citedEvidenceLine,
  customerInboxStatus,
  customerStatusForCommitment,
  gmailWizardStep,
  comingLaterItems,
  homeAttentionItems,
  homeHasAttention,
  inboxFailureCopy,
  presentExpectedObservation,
  shouldOfferKeepCurrent,
  shouldShowRecentChange,
  toCustomerStatus,
} from "../src/app/workspace/recovery/present";

const money = { currency: "INR", minor: "199900", exponent: 2, display: "₹1,999.00" } as const;
const confidence = { state: "HIGH" as const, score: 90, scale: "PERCENT_0_100" as const, reasons: ["Two receipts"] };

const home = (overrides: Partial<HomeProjectionDto> = {}): HomeProjectionDto => ({
  workspace: { id: "workspace-1", name: "Founder workspace", role: "owner", version: 4 },
  generatedAt: "2026-08-09T10:00:00.000Z",
  recentObservations: [],
  monthlyTotals: [{ amount: money, provenance: "RECEIPT", commitmentIds: ["commitment-1"] as const, evidenceIds: ["evidence-1"] as const, correctionIds: [] }],
  annualizedEstimateTotals: [],
  next30DayTotals: [],
  confidenceLayers: [],
  needsMe: [],
  changed: { state: "NO_PRIOR_BASELINE", fromVersion: null, toVersion: 4, items: [] },
  next: [],
  coverage: { state: "CURRENT", sourceCount: 1, evidenceCount: 2, lastEvidenceAt: null, coverageStart: null, coverageEnd: null, limitations: [] },
  activeCommitmentCount: 1,
  unknownCadenceCommitmentCount: 0,
  uncertainDuplicateCommitmentCount: 0,
  reviewItemCount: 0,
  possibleOverlaps: [],
  evidenceSources: [],
  decisionQueue: [],
  decisionOutcomes: [],
  nextQuietCharge: null,
  ...overrides,
});

const attention = (reason: AttentionItemDto["reason"]): AttentionItemDto => ({
  id: `${reason}:commitment-1:1`,
  commitmentId: "commitment-1",
  priority: "MEDIUM",
  reason,
  title: "Review OpenAI",
  detail: "Look at this.",
  amount: money,
  dueDate: "2026-09-06",
  evidenceIds: ["evidence-1"],
});

test("toCustomerStatus stays quiet unless a founder should act", () => {
  assert.equal(toCustomerStatus({ savedDecision: "KEEP", recommendedDecision: "KEEP", confidenceState: "HIGH", overlap: false }), "ON_TRACK");
  assert.equal(toCustomerStatus({ savedDecision: "CANCEL", recommendedDecision: "KEEP", confidenceState: "HIGH", overlap: false }), "PLANNED_CANCELLATION");
  assert.equal(toCustomerStatus({ savedDecision: null, recommendedDecision: "MONITOR", confidenceState: "HIGH", overlap: false }), "NEEDS_ATTENTION");
  assert.equal(toCustomerStatus({ savedDecision: "KEEP", recommendedDecision: "KEEP", confidenceState: "HIGH", overlap: true }), "NEEDS_ATTENTION");
  assert.equal(toCustomerStatus({ savedDecision: null, recommendedDecision: "KEEP", confidenceState: "LOW", overlap: false }), "ESTIMATE");
  assert.equal(toCustomerStatus({ savedDecision: null, recommendedDecision: "KEEP", confidenceState: "HIGH", overlap: false }), "ON_TRACK");
});

test("customerStatusForCommitment reads saved and recommended decisions from the published commitment", () => {
  assert.equal(customerStatusForCommitment({
    decision: null,
    recommendedDecision: "KEEP",
    confidence,
  }, false), "ON_TRACK");
  assert.equal(customerStatusForCommitment({
    decision: { value: "CANCEL", decidedAt: "2026-08-09T10:00:00.000Z", updatedAt: "2026-08-09T10:00:00.000Z" },
    recommendedDecision: "KEEP",
    confidence,
  }, false), "PLANNED_CANCELLATION");
});

test("Home hides renewals from Needs attention and hides empty last-visit changes", () => {
  const populated = home({
    needsMe: [attention("RENEWS_SOON"), attention("PRICE_INCREASE")],
    possibleOverlaps: [],
    changed: { state: "COMPARED", fromVersion: 3, toVersion: 4, items: [] },
  });
  assert.deepEqual(homeAttentionItems(populated).map((item) => item.reason), ["PRICE_INCREASE"]);
  assert.equal(homeHasAttention(populated), true);
  assert.equal(shouldShowRecentChange(populated), false);
  assert.equal(shouldShowRecentChange(home({ changed: { state: "COMPARED", fromVersion: 3, toVersion: 4, items: [{
    id: "change-1",
    commitmentId: "commitment-1",
    merchant: "OpenAI",
    detectedAt: "2026-08-09T10:00:00.000Z",
    provenance: { kind: "EVIDENCE", submissionId: "sub-1", evidenceIds: ["evidence-1"] },
    kind: "AMOUNT",
    before: money,
    after: { ...money, display: "₹2,099.00", minor: "209900" },
  }] } })), true);
});

test("expected-vs-observed stays silent when matched and uses human sentences otherwise", () => {
  const matched: ExpectedVsObservedDto = {
    status: "MATCHED",
    expectedDate: "2026-09-06",
    expectedAmount: money,
    observedDate: "2026-09-06",
    observedAmount: money,
    windowStart: "2026-09-05",
    windowEnd: "2026-09-09",
    summary: "ignored",
    reasons: [],
  };
  assert.equal(presentExpectedObservation(matched), null);
  const missing = presentExpectedObservation({ ...matched, status: "NOT_YET_OBSERVED", observedDate: null, observedAmount: null });
  assert.equal(missing?.sentence, "We expect this around 6 Sept 2026.");
  assert.equal(missing?.detail, "We haven't seen it yet.");
  const changed = presentExpectedObservation({
    ...matched,
    status: "AMOUNT_CHANGED",
    observedAmount: { ...money, display: "₹2,299.00", minor: "229900" },
  });
  assert.equal(changed?.sentence, "This bill was ₹2,299.00 instead of the usual ₹1,999.00.");
});

test("decision-moment copy cites receipt count and charge timing without inventing a date", () => {
  assert.equal(citedEvidenceLine(0), "No cited receipt is attached yet.");
  assert.equal(citedEvidenceLine(1), "Based on 1 cited receipt.");
  assert.equal(citedEvidenceLine(2), "Based on 2 cited receipts.");
  assert.equal(chargeWhenLine(null, null, null), "Date not established");
  assert.equal(chargeWhenLine("2026-08-22", 0, "22 Aug 2026"), "Charges today · 22 Aug 2026");
  assert.equal(chargeWhenLine("2026-08-23", 1, "23 Aug 2026"), "Charges tomorrow · 23 Aug 2026");
  assert.equal(chargeWhenLine("2026-08-25", 3, "25 Aug 2026"), "Charges in 3 days · 25 Aug 2026");
  assert.equal(chargeWhenLine("2026-09-06", null, "6 Sept 2026"), "Charges 6 Sept 2026");
});

test("inbox failures never print PARSE_FAILED", () => {
  assert.equal(inboxFailureCopy("PARSE_FAILED").title, errorCopy.PARSE_FAILED.title);
  assert.doesNotMatch(inboxFailureCopy("PARSE_FAILED").title, /PARSE_FAILED/);
  assert.doesNotMatch(inboxFailureCopy("PARSE_FAILED").detail, /PARSE_FAILED/);
  assert.equal(inboxFailureCopy("MYSTERIOUS_CODE").title, errorCopy.PARSE_FAILED.title);
});

test("Coming later omits vendors that are already in the decision queue", () => {
  const queued = home({
    decisionQueue: [{
      commitmentId: "commitment-1",
      merchant: "OpenAI",
      dueDate: "2026-09-06",
      daysAway: 28,
      charge: money,
      stake: money,
      headline: "Decide before Sunday",
      sentence: "OpenAI charges ₹1,999.00.",
      excerpt: null,
      citedEvidenceId: "evidence-1",
      provisional: false,
      reasonKeys: ["RENEWS_SOON"],
      reasons: ["Expected in 28 days."],
      overlapMerchants: [],
      askPurpose: false,
      evidenceIds: ["evidence-1"],
    }],
    next: [
      {
        commitmentId: "commitment-1",
        merchant: "OpenAI",
        date: "2026-09-06",
        daysAway: 28,
        amount: money,
        decision: null,
        confidence,
        reminderEligible: true,
        evidenceIds: ["evidence-1"],
      },
      {
        commitmentId: "commitment-2",
        merchant: "GitHub",
        date: "2026-09-30",
        daysAway: 52,
        amount: money,
        decision: { value: "KEEP", decidedAt: "2026-08-09T10:00:00.000Z", updatedAt: "2026-08-09T10:00:00.000Z" },
        confidence,
        reminderEligible: true,
        evidenceIds: ["evidence-2"],
      },
    ],
  });
  const later = comingLaterItems(queued);
  assert.deepEqual(later.map((item) => item.merchant), ["GitHub"]);
});

test("keep-current is offered only before forwarding is verified", () => {
  assert.equal(shouldOfferKeepCurrent(false, null), false);
  assert.equal(shouldOfferKeepCurrent(true, null), true);
  assert.equal(shouldOfferKeepCurrent(true, {
    state: "READY",
    alias: null,
    lastReceivedAt: null,
    lastProcessedAt: null,
    lastFailureCode: null,
    setupCompletedAt: "2026-08-18T00:00:00.000Z",
    forwardingVerifiedAt: "2026-08-18T00:00:00.000Z",
    backfillCompletedAt: null,
  }), false);
});

test("Gmail wizard maps machine state to one human step", () => {
  assert.equal(gmailWizardStep(null), 1);
  assert.equal(customerInboxStatus(null), "NOT_SET_UP");
  assert.equal(gmailWizardStep({
    state: "WAITING",
    alias: { id: "alias-1", status: "ACTIVE", address: "rcpt@example.test", createdAt: "2026-08-10T10:00:00.000Z", rotatedAt: null, revokedAt: null },
    lastReceivedAt: null,
    lastProcessedAt: null,
    lastFailureCode: null,
    setupCompletedAt: null,
    forwardingVerifiedAt: null,
    backfillCompletedAt: null,
    gmailVerification: { code: null, verificationUrl: "https://example.test/confirm", receivedAt: "2026-08-10T10:00:00.000Z" },
  }), 2);
});
