import assert from "node:assert/strict";
import test from "node:test";

import type { ExpectedChargeEvaluation } from "../src/lib/recovery/absence";
import { IDENTITY_UNCERTAIN_REASON } from "../src/lib/recovery/commitment-relationship";
import type { DecisionCycleFact, SavedDecisionCycle } from "../src/lib/recovery/decision-cycle";
import {
  buildDecisionHome,
  collectReasonKeys,
  computeReviewAt,
  cycleActionFromStamp,
  decisionHistoryItems,
  isInDecisionWindow,
  outcomeCopyNeverClaimsCancellation,
  persistableCycleReasonKeys,
  stampForCycleAction,
  verificationFromEvaluation,
} from "../src/lib/recovery/decision-cycle";
import { toMoneyDto } from "../src/lib/recovery/domain";

const today = "2026-08-19";

function fact(overrides: Partial<DecisionCycleFact> & Pick<DecisionCycleFact, "commitmentId" | "merchant">): DecisionCycleFact {
  return {
    status: "ACTIVE",
    cadence: "MONTHLY",
    currency: "INR",
    amountMinor: BigInt(170_000),
    latestObservedMinor: null,
    nextExpectedDate: "2026-08-22",
    firstDetectedOn: "2026-06-01",
    observationCount: 4,
    purpose: null,
    stamp: null,
    identityUncertain: false,
    amountConflict: false,
    priceChange: null,
    overlapPeers: [],
    evidenceIds: ["evidence-1", "evidence-2"],
    excerpt: "Perplexity Pro · ₹1,700.00 · 22 Aug.",
    latestEvidenceId: "evidence-2",
    cycles: [],
    ...overrides,
  };
}

test("decision windows follow cadence lead days and exclude irregular renewals", () => {
  assert.equal(isInDecisionWindow(today, "2026-08-22", "MONTHLY"), true);
  assert.equal(isInDecisionWindow(today, "2026-08-27", "MONTHLY"), false);
  assert.equal(isInDecisionWindow(today, "2026-09-02", "YEARLY"), true);
  assert.equal(isInDecisionWindow(today, "2026-09-10", "YEARLY"), false);
  assert.equal(isInDecisionWindow(today, "2026-08-22", "IRREGULAR"), false);
  assert.equal(isInDecisionWindow(today, null, "MONTHLY"), false);
});

test("review-later snooze clamps into (today, dueDate]", () => {
  assert.equal(computeReviewAt(today, "2026-08-22", "TOMORROW"), "2026-08-20");
  assert.equal(computeReviewAt(today, "2026-08-22", "ONE_DAY_BEFORE"), "2026-08-21");
  assert.equal(computeReviewAt(today, "2026-08-22", "THREE_DAYS_BEFORE"), "2026-08-20");
  assert.equal(computeReviewAt(today, "2026-08-20", "THREE_DAYS_BEFORE"), "2026-08-20");
  assert.equal(computeReviewAt(today, today, "TOMORROW"), today);
});

test("PROVISIONAL_SINGLE stays on the card and is not written to the 0055 cycle check", () => {
  assert.deepEqual(
    persistableCycleReasonKeys(["PROVISIONAL_SINGLE", "RENEWS_SOON", "NO_PRIOR_DECISION"]),
    ["RENEWS_SOON", "NO_PRIOR_DECISION"],
  );
});

test("cycle actions map onto existing decision stamps without inventing cancel execution", () => {
  assert.equal(stampForCycleAction("KEEP"), "KEEP");
  assert.equal(stampForCycleAction("REVIEW_LATER"), "MONITOR");
  assert.equal(stampForCycleAction("PLAN_TO_CANCEL"), "CANCEL");
  assert.equal(cycleActionFromStamp("KEEP"), "KEEP");
  assert.equal(cycleActionFromStamp("MONITOR"), "REVIEW_LATER");
  assert.equal(cycleActionFromStamp("CANCEL"), "PLAN_TO_CANCEL");
  assert.equal(cycleActionFromStamp("DOWNGRADE"), null);
  assert.equal(cycleActionFromStamp("INVESTIGATE"), null);
});

test("acceptance 1: Perplexity due in 3 days with ChatGPT overlap and no purpose enters the queue with stake", () => {
  const home = buildDecisionHome([
    fact({
      commitmentId: "perplexity",
      merchant: "Perplexity",
      amountMinor: BigInt(170_000),
      nextExpectedDate: "2026-08-22",
      overlapPeers: [{ merchant: "ChatGPT", purpose: null }],
    }),
    fact({
      commitmentId: "chatgpt",
      merchant: "ChatGPT",
      amountMinor: BigInt(199_900),
      nextExpectedDate: "2026-09-06",
      overlapPeers: [{ merchant: "Perplexity", purpose: null }],
    }),
  ], today);

  const card = home.decisionQueue.find((item) => item.commitmentId === "perplexity");
  assert.ok(card);
  assert.equal(card.charge.display, "₹1,700.00");
  assert.equal(card.stake?.display, "₹20,400.00");
  assert.equal(card.dueDate, "2026-08-22");
  assert.equal(card.daysAway, 3);
  assert.ok(card.reasonKeys.includes("RENEWS_SOON"));
  assert.ok(card.reasonKeys.includes("OVERLAP_NO_PURPOSE"));
  assert.equal(card.askPurpose, true);
  assert.match(card.sentence, /Perplexity charges ₹1,700\.00/);
  assert.match(card.sentence, /You also pay ChatGPT/);
  assert.equal(card.excerpt, "Perplexity Pro · ₹1,700.00 · 22 Aug.");
  // The card's quote names the exact receipt it was taken from.
  assert.equal(card.citedEvidenceId, "evidence-2");
  assert.match(card.reasons.join(" "), /Expected in 3 days/);
  assert.match(card.reasons.join(" "), /ChatGPT/);
  assert.equal(home.decisionQueue[0]?.commitmentId, "perplexity");
});

test("KEEP for this due date removes the cycle from the queue", () => {
  const cycle: SavedDecisionCycle = {
    dueDate: "2026-08-22",
    userAction: "KEEP",
    reviewAt: null,
    decidedAt: "2026-08-19T10:00:00.000Z",
    verificationOutcome: null,
    verifiedAt: null,
    observedAmountMinor: null,
    observedDate: null,
    observedCurrency: null,
    observedEvidenceIds: [],
  };
  const home = buildDecisionHome([
    fact({ commitmentId: "perplexity", merchant: "Perplexity", stamp: "KEEP", cycles: [cycle] }),
  ], today);
  assert.equal(home.decisionQueue.length, 0);
  assert.equal(home.decisionOutcomes[0]?.kind, "WATCHING");
  assert.match(home.decisionOutcomes[0]?.headline ?? "", /kept for this cycle/);
});

test("a watching outcome cites the latest bill, not an average nobody billed", () => {
  const cycle: SavedDecisionCycle = {
    dueDate: "2026-09-06",
    userAction: "KEEP",
    reviewAt: null,
    decidedAt: "2026-08-19T10:00:00.000Z",
    verificationOutcome: null,
    verifiedAt: null,
    observedAmountMinor: null,
    observedDate: null,
    observedCurrency: null,
    observedEvidenceIds: [],
  };
  const home = buildDecisionHome([
    fact({
      commitmentId: "openai",
      merchant: "OpenAI",
      amountMinor: BigInt(204_900),
      latestObservedMinor: BigInt(209_900),
      stamp: "KEEP",
      cycles: [cycle],
    }),
  ], today);
  const watching = home.decisionOutcomes.find((outcome) => outcome.kind === "WATCHING");
  assert.ok(watching);
  assert.equal(watching.amount?.display, "₹2,099.00");
});

test("acceptance 2: plan to cancel stores intent and leaves the queue immediately", () => {
  const cycle: SavedDecisionCycle = {
    dueDate: "2026-08-22",
    userAction: "PLAN_TO_CANCEL",
    reviewAt: null,
    decidedAt: "2026-08-19T10:00:00.000Z",
    verificationOutcome: null,
    verifiedAt: null,
    observedAmountMinor: null,
    observedDate: null,
    observedCurrency: null,
    observedEvidenceIds: [],
  };
  const home = buildDecisionHome([
    fact({ commitmentId: "perplexity", merchant: "Perplexity", stamp: "CANCEL", cycles: [cycle] }),
  ], today);
  assert.equal(home.decisionQueue.length, 0);
  assert.equal(home.decisionOutcomes[0]?.kind, "WATCHING");
  assert.match(home.decisionOutcomes[0]?.headline ?? "", /plan to cancel is recorded/);
  assert.match(home.decisionOutcomes[0]?.detail ?? "", /If Perplexity charges again/);
  assert.ok(outcomeCopyNeverClaimsCancellation(home.decisionOutcomes[0]?.headline ?? ""));
  assert.ok(outcomeCopyNeverClaimsCancellation(home.decisionOutcomes[0]?.detail ?? ""));
});

test("acceptance 3: matching charge after plan-to-cancel is the important outcome", () => {
  const cycle: SavedDecisionCycle = {
    dueDate: "2026-08-22",
    userAction: "PLAN_TO_CANCEL",
    reviewAt: null,
    decidedAt: "2026-08-19T10:00:00.000Z",
    verificationOutcome: "CHARGE_ARRIVED",
    verifiedAt: "2026-08-22T12:00:00.000Z",
    observedAmountMinor: BigInt(170_000),
    observedDate: "2026-08-22",
    observedCurrency: "INR",
    observedEvidenceIds: ["evidence-new"],
  };
  const home = buildDecisionHome([
    fact({ commitmentId: "perplexity", merchant: "Perplexity", stamp: "CANCEL", cycles: [cycle] }),
  ], today);
  const outcome = home.decisionOutcomes[0];
  assert.equal(outcome?.kind, "CHARGE_AFTER_CANCEL_PLAN");
  assert.match(outcome?.headline ?? "", /Perplexity charged again after you planned to cancel/);
  assert.equal(outcome?.amount?.display, "₹1,700.00");
  assert.equal(outcome?.date, "2026-08-22");
  assert.match(outcome?.detail ?? "", /Vognary did not cancel/);
  assert.ok(outcomeCopyNeverClaimsCancellation(outcome?.headline ?? ""));
  assert.doesNotMatch(outcome?.detail ?? "", /Cancelled successfully/i);
});

test("acceptance 4: closed window with no charge never says cancelled", () => {
  const cycle: SavedDecisionCycle = {
    dueDate: "2026-08-22",
    userAction: "PLAN_TO_CANCEL",
    reviewAt: null,
    decidedAt: "2026-08-19T10:00:00.000Z",
    verificationOutcome: "NO_CHARGE_IN_WINDOW",
    verifiedAt: "2026-08-28T00:00:00.000Z",
    observedAmountMinor: null,
    observedDate: null,
    observedCurrency: null,
    observedEvidenceIds: [],
  };
  const home = buildDecisionHome([
    fact({ commitmentId: "perplexity", merchant: "Perplexity", stamp: "CANCEL", cycles: [cycle] }),
  ], "2026-08-28");
  assert.equal(home.decisionOutcomes[0]?.kind, "NO_CHARGE_SEEN");
  assert.match(home.decisionOutcomes[0]?.headline ?? "", /didn't see another charge/);
  assert.match(home.decisionOutcomes[0]?.detail ?? "", /not proof of cancellation/i);
  assert.doesNotMatch(home.decisionOutcomes[0]?.headline ?? "", /\bCancelled\b/);
});

test("acceptance 5: stable GitHub with KEEP 21 days out stays quiet", () => {
  const home = buildDecisionHome([
    fact({
      commitmentId: "github",
      merchant: "GitHub",
      amountMinor: BigInt(40_000),
      cadence: "MONTHLY",
      nextExpectedDate: "2026-09-09",
      stamp: "KEEP",
      firstDetectedOn: "2025-01-01",
      observationCount: 12,
    }),
  ], today);
  assert.equal(home.decisionQueue.length, 0);
  assert.equal(home.nextQuietCharge?.merchant, "GitHub");
  assert.equal(home.nextQuietCharge?.date, "2026-09-09");
});

test("quiet charge names the most recent cited bill, not the blended effective amount", () => {
  const home = buildDecisionHome([
    fact({
      commitmentId: "github",
      merchant: "GitHub",
      amountMinor: BigInt(40_000),
      latestObservedMinor: BigInt(45_900),
      cadence: "MONTHLY",
      nextExpectedDate: "2026-09-09",
      stamp: "KEEP",
      firstDetectedOn: "2025-01-01",
      observationCount: 12,
    }),
  ], today);
  assert.equal(home.nextQuietCharge?.amount.minor, "45900");
});

test("acceptance 6: price increase due in 5 days ranks first with a cited delta", () => {
  const home = buildDecisionHome([
    fact({
      commitmentId: "openai",
      merchant: "OpenAI",
      amountMinor: BigInt(249_900),
      nextExpectedDate: "2026-08-24",
      priceChange: { previousMinor: BigInt(199_900), currentMinor: BigInt(249_900) },
    }),
    fact({
      commitmentId: "notion",
      merchant: "Notion",
      amountMinor: BigInt(96_000),
      nextExpectedDate: "2026-08-22",
    }),
  ], today);
  assert.equal(home.decisionQueue[0]?.commitmentId, "openai");
  assert.ok(home.decisionQueue[0]?.reasonKeys.includes("PRICE_INCREASE"));
  assert.match(home.decisionQueue[0]?.reasons.join(" ") ?? "", /₹1,999\.00/);
  assert.match(home.decisionQueue[0]?.reasons.join(" ") ?? "", /₹2,499\.00/);
  assert.match(home.decisionQueue[0]?.reasons.join(" ") ?? "", /₹500\.00/);
});

test("a price-increase card cites the current bill, never an average no receipt contains", () => {
  const home = buildDecisionHome([
    fact({
      commitmentId: "openai",
      merchant: "OpenAI",
      // Effective amount is the average of ₹1,999 and ₹2,099 — no receipt says ₹2,049.
      amountMinor: BigInt(204_900),
      latestObservedMinor: BigInt(209_900),
      nextExpectedDate: "2026-08-24",
      priceChange: { previousMinor: BigInt(199_900), currentMinor: BigInt(209_900) },
    }),
  ], today);
  const card = home.decisionQueue[0];
  assert.ok(card);
  assert.equal(card.charge.display, "₹2,099.00");
  assert.match(card.sentence, /OpenAI charges ₹2,099\.00/);
  assert.match(card.reasons.join(" "), /Last bill increased from ₹1,999\.00 to ₹2,099\.00/);
});

test("without a dated observation the card keeps the effective amount", () => {
  const home = buildDecisionHome([
    fact({
      commitmentId: "perplexity",
      merchant: "Perplexity",
      amountMinor: BigInt(170_000),
      nextExpectedDate: "2026-08-22",
    }),
  ], today);
  assert.equal(home.decisionQueue[0]?.charge.display, "₹1,700.00");
});

test("NEW_COMMITMENT is cited for a recently first-detected recurring commitment", () => {
  const keys = collectReasonKeys(fact({
    commitmentId: "linear-new",
    merchant: "Linear",
    nextExpectedDate: "2026-09-20",
    firstDetectedOn: "2026-07-20",
    observationCount: 2,
  }), today);
  assert.ok(keys.includes("NEW_COMMITMENT"));
  const home = buildDecisionHome([
    fact({
      commitmentId: "linear-new",
      merchant: "Linear",
      nextExpectedDate: "2026-09-20",
      firstDetectedOn: "2026-07-20",
      observationCount: 2,
    }),
  ], today);
  assert.equal(home.decisionQueue[0]?.commitmentId, "linear-new");
  assert.ok(home.decisionQueue[0]?.reasonKeys.includes("NEW_COMMITMENT"));
});

test("NO_PRIOR_DECISION alone outside the window does not enter the queue", () => {
  const keys = collectReasonKeys(fact({
    commitmentId: "linear",
    merchant: "Linear",
    nextExpectedDate: "2026-09-20",
    firstDetectedOn: "2025-01-01",
    observationCount: 8,
  }), today);
  assert.deepEqual(keys, ["NO_PRIOR_DECISION"]);
  const home = buildDecisionHome([
    fact({
      commitmentId: "linear",
      merchant: "Linear",
      nextExpectedDate: "2026-09-20",
      firstDetectedOn: "2025-01-01",
      observationCount: 8,
    }),
  ], today);
  assert.equal(home.decisionQueue.length, 0);
});

test("review later returns to the queue when reviewAt arrives", () => {
  const cycle: SavedDecisionCycle = {
    dueDate: "2026-08-22",
    userAction: "REVIEW_LATER",
    reviewAt: "2026-08-21",
    decidedAt: "2026-08-19T10:00:00.000Z",
    verificationOutcome: null,
    verifiedAt: null,
    observedAmountMinor: null,
    observedDate: null,
    observedCurrency: null,
    observedEvidenceIds: [],
  };
  const waiting = buildDecisionHome([
    fact({ commitmentId: "perplexity", merchant: "Perplexity", stamp: "MONITOR", cycles: [cycle] }),
  ], today);
  assert.equal(waiting.decisionQueue.length, 0);
  const due = buildDecisionHome([
    fact({ commitmentId: "perplexity", merchant: "Perplexity", stamp: "MONITOR", cycles: [cycle] }),
  ], "2026-08-21");
  assert.equal(due.decisionQueue[0]?.commitmentId, "perplexity");
});

test("purpose recorded on an overlap member drops OVERLAP_NO_PURPOSE", () => {
  const without = collectReasonKeys(fact({
    commitmentId: "perplexity",
    merchant: "Perplexity",
    overlapPeers: [{ merchant: "ChatGPT", purpose: null }],
  }), today);
  assert.ok(without.includes("OVERLAP_NO_PURPOSE"));
  const withPurpose = collectReasonKeys(fact({
    commitmentId: "perplexity",
    merchant: "Perplexity",
    purpose: "RESEARCH",
    overlapPeers: [{ merchant: "ChatGPT", purpose: null }],
  }), today);
  assert.equal(withPurpose.includes("OVERLAP_NO_PURPOSE"), false);
});

test("identity and amount-conflict reasons are cited, not invented", () => {
  const keys = collectReasonKeys(fact({
    commitmentId: "dup",
    merchant: "Notion",
    identityUncertain: true,
    amountConflict: true,
  }), today);
  assert.ok(keys.includes("IDENTITY_UNCERTAIN"));
  assert.ok(keys.includes("AMOUNT_CONFLICT"));
  const home = buildDecisionHome([
    fact({
      commitmentId: "dup",
      merchant: "Notion",
      identityUncertain: true,
      amountConflict: true,
    }),
  ], today);
  assert.match(home.decisionQueue[0]?.reasons.join(" ") ?? "", new RegExp(IDENTITY_UNCERTAIN_REASON.slice(0, 20)));
});

test("irregular cadence shows the known charge only, never a fabricated annual total", () => {
  const home = buildDecisionHome([
    fact({
      commitmentId: "bupa",
      merchant: "Max Bupa",
      cadence: "IRREGULAR",
      amountMinor: BigInt(840_000),
      nextExpectedDate: "2026-08-22",
      amountConflict: true,
    }),
  ], today);
  assert.equal(home.decisionQueue[0]?.stake, null);
  assert.equal(home.decisionQueue[0]?.charge.display, "₹8,400.00");
});

test("verification mapping never treats a pending window as a persisted outcome", () => {
  const pending: ExpectedChargeEvaluation = {
    status: "PENDING_WINDOW",
    window: { start: "2026-08-21", end: "2026-08-27" },
    reasons: ["open"],
    citedEvidenceIds: [],
  };
  assert.deepEqual(verificationFromEvaluation(pending), { persist: false, outcome: null });

  const arrived: ExpectedChargeEvaluation = {
    status: "EVALUATED",
    outcome: "ARRIVED_AS_EXPECTED",
    window: { start: "2026-08-21", end: "2026-08-27" },
    observedDate: "2026-08-22",
    observedAmountMinor: BigInt(170_000),
    deltaMinor: null,
    deltaBasisPoints: null,
    lateByDays: 0,
    reasons: ["arrived"],
    citedEvidenceIds: ["evidence-new"],
  };
  assert.deepEqual(verificationFromEvaluation(arrived), { persist: true, outcome: "CHARGE_ARRIVED" });

  const missing: ExpectedChargeEvaluation = {
    ...arrived,
    outcome: "NOT_OBSERVED",
    observedDate: null,
    observedAmountMinor: null,
    citedEvidenceIds: [],
  };
  assert.deepEqual(verificationFromEvaluation(missing), { persist: true, outcome: "NO_CHARGE_IN_WINDOW" });

  const broken: ExpectedChargeEvaluation = {
    ...missing,
    outcome: "CANNOT_EVALUATE_COVERAGE_BROKEN",
  };
  assert.deepEqual(verificationFromEvaluation(broken), { persist: true, outcome: "CANNOT_EVALUATE" });
});

test("KEEP with a matching charge is continued as planned, not a new decision", () => {
  const cycle: SavedDecisionCycle = {
    dueDate: "2026-08-22",
    userAction: "KEEP",
    reviewAt: null,
    decidedAt: "2026-08-19T10:00:00.000Z",
    verificationOutcome: "CHARGE_ARRIVED",
    verifiedAt: "2026-08-22T12:00:00.000Z",
    observedAmountMinor: BigInt(170_000),
    observedDate: "2026-08-22",
    observedCurrency: "INR",
    observedEvidenceIds: ["evidence-new"],
  };
  const home = buildDecisionHome([
    fact({ commitmentId: "perplexity", merchant: "Perplexity", stamp: "KEEP", cycles: [cycle] }),
  ], today);
  assert.equal(home.decisionQueue.length, 0);
  assert.equal(home.decisionOutcomes[0]?.kind, "CONTINUED_AS_PLANNED");
});

test("decision history is compact date plus action plus verification", () => {
  const items = decisionHistoryItems([
    {
      dueDate: "2026-08-06",
      userAction: "KEEP",
      reviewAt: null,
      decidedAt: "2026-08-01T00:00:00.000Z",
      verificationOutcome: "CHARGE_ARRIVED",
      verifiedAt: "2026-08-06T00:00:00.000Z",
      observedAmountMinor: BigInt(170_000),
      observedDate: "2026-08-06",
      observedCurrency: "INR",
      observedEvidenceIds: [],
    },
    {
      dueDate: "2026-09-06",
      userAction: "PLAN_TO_CANCEL",
      reviewAt: null,
      decidedAt: "2026-09-01T00:00:00.000Z",
      verificationOutcome: "CHARGE_ARRIVED",
      verifiedAt: "2026-09-06T00:00:00.000Z",
      observedAmountMinor: BigInt(170_000),
      observedDate: "2026-09-06",
      observedCurrency: "INR",
      observedEvidenceIds: [],
    },
  ]);
  assert.equal(items[0]?.action, "KEEP");
  assert.equal(items[0]?.verificationHeadline, "Continued as planned");
  assert.equal(items[1]?.verificationHeadline, "Charge still arrived");
});

test("currencies are never converted when ranking stake", () => {
  const home = buildDecisionHome([
    fact({
      commitmentId: "usd",
      merchant: "GitHub",
      currency: "USD",
      amountMinor: BigInt(10_000),
      nextExpectedDate: "2026-08-22",
    }),
    fact({
      commitmentId: "inr",
      merchant: "Zoho",
      amountMinor: BigInt(50_000),
      nextExpectedDate: "2026-08-22",
    }),
  ], today);
  assert.equal(home.decisionQueue.length, 2);
  assert.notEqual(home.decisionQueue[0]?.charge.currency, undefined);
});

test("money dto helper still formats INR for copy", () => {
  assert.equal(toMoneyDto(BigInt(50_000), "INR").display, "₹500.00");
});
