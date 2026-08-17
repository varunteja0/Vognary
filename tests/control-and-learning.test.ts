import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceUserConfirmedAction,
  buildAssistedCancellationRequest,
  controlActionTiers,
  resolveControlPlan,
  userConfirmedActionStates,
  type MerchantCancellationRoute,
} from "../src/lib/recovery/control-actions";
import {
  buildLearningExample,
  correctionOutcomeKinds,
  derivePriors,
  learningPriorMinimumExamples,
  summarizeLearningDataset,
  type CorrectionOutcome,
} from "../src/lib/recovery/correction-learning";

const now = "2026-08-17T09:00:00.000Z";

function route(overrides: Partial<MerchantCancellationRoute> = {}): MerchantCancellationRoute {
  return {
    merchantKey: "netflix.com",
    channel: "EMAIL",
    steps: ["Open your account page.", "Choose Cancel Membership."],
    contactEmail: "support@netflix.com",
    verifiedAt: "2026-08-01T00:00:00.000Z",
    verifiedBy: "FOUNDER",
    sourceUrl: "https://help.netflix.com/cancel",
    expiresAt: "2027-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function plan(overrides: Partial<Parameters<typeof resolveControlPlan>[0]> = {}) {
  return resolveControlPlan({
    now,
    route: route(),
    merchant: "Netflix",
    citedEvidenceIds: ["ev-aug"],
    switches: { assistedActionEnabled: true, userConfirmedActionEnabled: false, autonomousExecutionEnabled: false },
    consent: { userConfirmedActionConsentAt: null },
    ...overrides,
  });
}

test("the control vocabulary is exactly the four declared tiers", () => {
  assert.deepEqual([...controlActionTiers], ["INFORMATION", "ASSISTED_ACTION", "USER_CONFIRMED_ACTION", "AUTONOMOUS_ACTION"]);
});

test("verified instructions are offered as information", () => {
  const information = plan().tiers.INFORMATION;
  assert.equal(information.available, true);
  assert.deepEqual(information.steps, ["Open your account page.", "Choose Cancel Membership."]);
  assert.equal(information.verifiedAt, "2026-08-01T00:00:00.000Z");
});

test("unverified or missing instructions are never invented", () => {
  assert.equal(plan({ route: null }).tiers.INFORMATION.available, false);
  assert.deepEqual(plan({ route: null }).tiers.INFORMATION.steps, []);
  const stale = plan({ route: route({ expiresAt: "2026-01-01T00:00:00.000Z" }) }).tiers.INFORMATION;
  assert.equal(stale.available, false);
  assert.ok(stale.reasons.some((reason) => reason.toLowerCase().includes("check")));
});

test("assisted action drafts a request the customer sends themselves", () => {
  const assisted = plan().tiers.ASSISTED_ACTION;
  assert.equal(assisted.available, true);
  assert.equal(assisted.actor, "CUSTOMER");
  const draft = buildAssistedCancellationRequest({
    merchant: "Netflix",
    route: route(),
    citedEvidenceIds: ["ev-aug"],
    lastChargeDate: "2026-08-05",
    accountReference: null,
  });
  assert.equal(draft.to, "support@netflix.com");
  assert.ok(draft.body.includes("2026-08-05"));
  assert.deepEqual(draft.citedEvidenceIds, ["ev-aug"]);
  assert.equal(draft.sendableBy, "CUSTOMER");
});

test("an assisted request is refused when nothing backs it", () => {
  assert.equal(plan({ citedEvidenceIds: [] }).tiers.ASSISTED_ACTION.available, false);
  assert.throws(() => buildAssistedCancellationRequest({
    merchant: "Netflix",
    route: route(),
    citedEvidenceIds: [],
    lastChargeDate: "2026-08-05",
    accountReference: null,
  }), /evidence/i);
});

test("an assisted request is refused when the merchant has no cancellation address", () => {
  assert.equal(plan({ route: route({ channel: "PHONE", contactEmail: null }) }).tiers.ASSISTED_ACTION.available, false);
});

test("the drafted request contains no invented facts", () => {
  const draft = buildAssistedCancellationRequest({
    merchant: "Netflix",
    route: route(),
    citedEvidenceIds: ["ev-aug"],
    lastChargeDate: null,
    accountReference: null,
  });
  assert.doesNotMatch(draft.body, /\d{4}-\d{2}-\d{2}/);
  assert.doesNotMatch(draft.body, /₹|\bINR\b|\$/);
});

test("user-confirmed action exists as a state machine but stays switched off", () => {
  const tier = plan().tiers.USER_CONFIRMED_ACTION;
  assert.equal(tier.available, false);
  assert.ok(tier.reasons.some((reason) => reason.toLowerCase().includes("not switched on")));
  assert.deepEqual([...userConfirmedActionStates], [
    "NOT_OFFERED", "OFFERED", "CONSENT_REQUESTED", "CONSENT_GRANTED", "READY_TO_RUN", "DECLINED", "WITHDRAWN",
  ]);
});

test("user-confirmed action requires explicit consent and can be withdrawn", () => {
  let state = advanceUserConfirmedAction({ current: "NOT_OFFERED", event: { kind: "OFFER" }, now }).state;
  assert.equal(state, "OFFERED");
  state = advanceUserConfirmedAction({ current: state, event: { kind: "REQUEST_CONSENT" }, now }).state;
  assert.equal(state, "CONSENT_REQUESTED");
  const skipped = advanceUserConfirmedAction({ current: "OFFERED", event: { kind: "GRANT_CONSENT", consentText: "x" }, now });
  assert.equal(skipped.accepted, false);
  state = advanceUserConfirmedAction({ current: state, event: { kind: "GRANT_CONSENT", consentText: "I authorise this one cancellation." }, now }).state;
  assert.equal(state, "CONSENT_GRANTED");
  state = advanceUserConfirmedAction({ current: state, event: { kind: "MARK_READY" }, now }).state;
  assert.equal(state, "READY_TO_RUN");
  state = advanceUserConfirmedAction({ current: state, event: { kind: "WITHDRAW" }, now }).state;
  assert.equal(state, "WITHDRAWN");
});

test("blank consent text is not consent", () => {
  const blank = advanceUserConfirmedAction({ current: "CONSENT_REQUESTED", event: { kind: "GRANT_CONSENT", consentText: "   " }, now });
  assert.equal(blank.accepted, false);
});

test("even with consent granted, running is refused while the switch is off", () => {
  const tier = plan({
    switches: { assistedActionEnabled: true, userConfirmedActionEnabled: false, autonomousExecutionEnabled: false },
    consent: { userConfirmedActionConsentAt: "2026-08-16T00:00:00.000Z" },
  }).tiers.USER_CONFIRMED_ACTION;
  assert.equal(tier.available, false);
});

test("autonomous action is never marked available and never claims a proven route", () => {
  for (const autonomousExecutionEnabled of [false, true]) {
    const tier = plan({
      switches: { assistedActionEnabled: true, userConfirmedActionEnabled: true, autonomousExecutionEnabled },
    }).tiers.AUTONOMOUS_ACTION;
    assert.equal(tier.available, false);
    assert.equal(tier.providerRouteProven, false);
  }
});

test("the recommended tier never exceeds what is actually available", () => {
  assert.equal(plan().recommendedTier, "ASSISTED_ACTION");
  assert.equal(plan({ route: route({ channel: "PHONE", contactEmail: null }) }).recommendedTier, "INFORMATION");
  assert.equal(plan({ route: null }).recommendedTier, null);
});

test("the learning vocabulary covers every correction we persist", () => {
  assert.deepEqual([...correctionOutcomeKinds], [
    "MERCHANT_CORRECTED",
    "MERCHANT_ALIAS_ADDED",
    "CADENCE_CORRECTED",
    "AMOUNT_CORRECTED",
    "DUPLICATE_MERGE_ACCEPTED",
    "DUPLICATE_MERGE_REJECTED",
    "LIFECYCLE_CORRECTED",
    "CANCELLATION_OUTCOME_RECORDED",
  ]);
});

const outcome = (overrides: Partial<CorrectionOutcome> = {}): CorrectionOutcome => ({
  kind: "DUPLICATE_MERGE_REJECTED",
  observedAt: now,
  citedEvidenceIds: ["ev-a"],
  systemProposed: { matchScore: 62, strongestSignalKind: "FUZZY_ALIAS", signalKinds: ["FUZZY_ALIAS"], cadence: "MONTHLY", currency: "INR", coverageState: "CURRENT" },
  userAnswer: "REJECTED",
  ...overrides,
});

test("a learning example carries structure, never the customer's words", () => {
  const example = buildLearningExample(outcome({
    citedEvidenceIds: ["ev-a", "ev-a", "ev-b"],
  }));
  assert.equal(example.kind, "DUPLICATE_MERGE_REJECTED");
  assert.deepEqual(example.citedEvidenceIds, ["ev-a", "ev-b"]);
  for (const value of Object.values(example.features)) {
    assert.ok(["string", "number", "boolean"].includes(typeof value));
    if (typeof value === "string") {
      assert.doesNotMatch(value, /@/, `feature leaked an address: ${value}`);
      assert.doesNotMatch(value, /netflix/i, `feature leaked a merchant name: ${value}`);
    }
  }
  assert.ok(example.featureVersion.length > 0);
});

test("scores are bucketed rather than stored as raw certainty", () => {
  assert.equal(buildLearningExample(outcome()).features.matchScoreBucket, "60_79");
  assert.equal(buildLearningExample(outcome({ systemProposed: { ...outcome().systemProposed, matchScore: 95 } })).features.matchScoreBucket, "80_100");
});

test("a dataset below the threshold refuses to produce priors", () => {
  const examples = Array.from({ length: learningPriorMinimumExamples - 1 }, () => buildLearningExample(outcome()));
  const summary = summarizeLearningDataset(examples);
  assert.equal(summary.readyForPriors, false);
  assert.equal(summary.total, learningPriorMinimumExamples - 1);
  const priors = derivePriors(examples);
  assert.equal(priors.available, false);
  assert.deepEqual(priors.weights, {});
  assert.ok(priors.reasons.some((reason) => reason.toLowerCase().includes("not enough")));
});

test("an empty dataset never invents a prior", () => {
  const priors = derivePriors([]);
  assert.equal(priors.available, false);
  assert.deepEqual(priors.weights, {});
  assert.equal(summarizeLearningDataset([]).total, 0);
});

test("a dataset at the threshold reports readiness without asserting a model", () => {
  const examples = Array.from({ length: learningPriorMinimumExamples }, (_unused, index) =>
    buildLearningExample(outcome({ userAnswer: index % 2 === 0 ? "REJECTED" : "ACCEPTED", citedEvidenceIds: [`ev-${index}`] })));
  const summary = summarizeLearningDataset(examples);
  assert.equal(summary.readyForPriors, true);
  assert.equal(summary.byKind.DUPLICATE_MERGE_REJECTED, learningPriorMinimumExamples);
  const priors = derivePriors(examples);
  assert.equal(priors.available, true);
  assert.ok(Object.keys(priors.weights).length > 0);
  for (const weight of Object.values(priors.weights)) {
    assert.ok(weight >= 0 && weight <= 1, String(weight));
  }
});
