import assert from "node:assert/strict";
import test from "node:test";

import { evaluateExpectedCharge } from "../src/lib/recovery/absence";
import { assessCommitmentCoverage, assessSourceLiveness, type SourceLivenessInput } from "../src/lib/recovery/source-liveness";
import {
  advanceCancellationOutcome,
  cancellationOutcomeStates,
  isCancellationSettled,
  type CancellationOutcomeState,
} from "../src/lib/recovery/cancellation-outcome";

const evaluatedOn = "2026-08-17";

function coverageFor(state: "CURRENT" | "BROKEN") {
  const overrides: Partial<SourceLivenessInput> = state === "BROKEN" ? { connected: false } : {};
  const source = assessSourceLiveness({
    sourceId: "src-1",
    kind: "FORWARDED_EMAIL",
    connected: true,
    credentialRevoked: false,
    consecutiveFailureCount: 0,
    evidenceCount: 6,
    lastEvidenceAt: "2026-08-14T09:00:00.000Z",
    lastDeliveryAt: "2026-08-16T09:00:00.000Z",
    coverageStart: "2026-04-01",
    coverageEnd: "2026-08-14",
    ...overrides,
  }, new Date(`${evaluatedOn}T09:00:00.000Z`));
  return assessCommitmentCoverage(["src-1"], [source]);
}

function evaluation(kind: "MISSING" | "CHARGED" | "UNKNOWABLE") {
  return evaluateExpectedCharge({
    evaluatedOn,
    expectedDate: "2026-08-05",
    cadence: "MONTHLY",
    currency: "INR",
    expectedAmountMinor: BigInt(64900),
    coverage: coverageFor(kind === "UNKNOWABLE" ? "BROKEN" : "CURRENT"),
    observations: kind === "CHARGED"
      ? [{ evidenceId: "ev-charge", date: "2026-08-05", amountMinor: BigInt(64900), currency: "INR" }]
      : [],
    cancellationClaimed: true,
  });
}

function walkTo(target: CancellationOutcomeState): CancellationOutcomeState {
  let state: CancellationOutcomeState = "NONE";
  state = advanceCancellationOutcome({ current: state, event: { kind: "INTENT_RECORDED", at: "2026-07-01T00:00:00.000Z" } }).state;
  if (target === "CANCELLATION_INTENT_RECORDED") return state;
  state = advanceCancellationOutcome({
    current: state,
    event: { kind: "CANCELLATION_CLAIMED", at: "2026-07-02T00:00:00.000Z", claimSource: "USER_REPORTED", evidenceIds: [] },
  }).state;
  if (target === "CANCELLATION_CLAIMED") return state;
  state = advanceCancellationOutcome({
    current: state,
    event: { kind: "WINDOW_OPENED", at: "2026-08-04T00:00:00.000Z", window: { start: "2026-08-04", end: "2026-08-10" } },
  }).state;
  return state;
}

test("the lifecycle vocabulary is exactly the declared states", () => {
  assert.deepEqual([...cancellationOutcomeStates], [
    "NONE",
    "CANCELLATION_INTENT_RECORDED",
    "CANCELLATION_CLAIMED",
    "WAITING_FOR_EXPECTED_WINDOW",
    "LIKELY_STOPPED_BY_COVERED_ABSENCE",
    "CHARGED_AGAIN",
    "CANNOT_VERIFY",
    "CONFIRMED_BY_SETTLEMENT",
  ]);
});

test("the lifecycle walks intent to claim to waiting", () => {
  assert.equal(walkTo("CANCELLATION_INTENT_RECORDED"), "CANCELLATION_INTENT_RECORDED");
  assert.equal(walkTo("CANCELLATION_CLAIMED"), "CANCELLATION_CLAIMED");
  assert.equal(walkTo("WAITING_FOR_EXPECTED_WINDOW"), "WAITING_FOR_EXPECTED_WINDOW");
});

test("a covered quiet window is the strongest claim we may make, and it is not settlement", () => {
  const transition = advanceCancellationOutcome({
    current: walkTo("WAITING_FOR_EXPECTED_WINDOW"),
    event: { kind: "CHARGE_EVALUATED", at: `${evaluatedOn}T00:00:00.000Z`, evaluation: evaluation("MISSING") },
  });
  assert.equal(transition.state, "LIKELY_STOPPED_BY_COVERED_ABSENCE");
  assert.equal(transition.proof, "COVERED_ABSENCE");
  assert.equal(isCancellationSettled(transition.state), false);
  assert.ok(transition.reasons.some((reason) => reason.toLowerCase().includes("bank")));
});

test("a charge inside the window proves the cancellation did not take effect", () => {
  const transition = advanceCancellationOutcome({
    current: walkTo("WAITING_FOR_EXPECTED_WINDOW"),
    event: { kind: "CHARGE_EVALUATED", at: `${evaluatedOn}T00:00:00.000Z`, evaluation: evaluation("CHARGED") },
  });
  assert.equal(transition.state, "CHARGED_AGAIN");
  assert.deepEqual(transition.citedEvidenceIds, ["ev-charge"]);
});

test("broken coverage yields cannot verify rather than a convenient conclusion", () => {
  const transition = advanceCancellationOutcome({
    current: walkTo("WAITING_FOR_EXPECTED_WINDOW"),
    event: { kind: "CHARGE_EVALUATED", at: `${evaluatedOn}T00:00:00.000Z`, evaluation: evaluation("UNKNOWABLE") },
  });
  assert.equal(transition.state, "CANNOT_VERIFY");
  assert.equal(transition.proof, "NONE");
});

test("late evidence can overturn a covered-absence conclusion", () => {
  const transition = advanceCancellationOutcome({
    current: "LIKELY_STOPPED_BY_COVERED_ABSENCE",
    event: { kind: "CHARGE_EVALUATED", at: "2026-09-06T00:00:00.000Z", evaluation: evaluation("CHARGED") },
  });
  assert.equal(transition.accepted, true);
  assert.equal(transition.state, "CHARGED_AGAIN");
});

test("cannot verify becomes conclusive again once coverage is repaired", () => {
  const transition = advanceCancellationOutcome({
    current: "CANNOT_VERIFY",
    event: { kind: "CHARGE_EVALUATED", at: `${evaluatedOn}T00:00:00.000Z`, evaluation: evaluation("MISSING") },
  });
  assert.equal(transition.state, "LIKELY_STOPPED_BY_COVERED_ABSENCE");
});

test("settlement confirmation is reserved and no event can reach it", () => {
  const events: Parameters<typeof advanceCancellationOutcome>[0]["event"][] = [
    { kind: "SETTLEMENT_CONFIRMED", at: `${evaluatedOn}T00:00:00.000Z`, sourceKind: "REGULATED_ACCOUNT_FEED", evidenceIds: ["ev-x"] },
    { kind: "INTENT_RECORDED", at: `${evaluatedOn}T00:00:00.000Z` },
    { kind: "CANCELLATION_CLAIMED", at: `${evaluatedOn}T00:00:00.000Z`, claimSource: "MERCHANT_CONFIRMATION_RECEIPT", evidenceIds: ["ev-x"] },
    { kind: "WINDOW_OPENED", at: `${evaluatedOn}T00:00:00.000Z`, window: { start: "2026-08-04", end: "2026-08-10" } },
    { kind: "CHARGE_EVALUATED", at: `${evaluatedOn}T00:00:00.000Z`, evaluation: evaluation("MISSING") },
    { kind: "CHARGE_EVALUATED", at: `${evaluatedOn}T00:00:00.000Z`, evaluation: evaluation("CHARGED") },
    { kind: "CHARGE_EVALUATED", at: `${evaluatedOn}T00:00:00.000Z`, evaluation: evaluation("UNKNOWABLE") },
  ];
  for (const current of cancellationOutcomeStates) {
    for (const event of events) {
      const transition = advanceCancellationOutcome({ current, event });
      if (event.kind === "SETTLEMENT_CONFIRMED") {
        assert.equal(transition.accepted, false, `${current} accepted a settlement event`);
        assert.equal(transition.state, current);
      }
      if (!isCancellationSettled(current)) {
        assert.notEqual(transition.state, "CONFIRMED_BY_SETTLEMENT", `${current} + ${event.kind} reached settlement`);
        assert.notEqual(transition.proof, "SETTLEMENT", `${current} + ${event.kind} claimed settlement proof`);
      }
    }
  }
  assert.equal(isCancellationSettled("CONFIRMED_BY_SETTLEMENT"), true);
});

test("a covered absence is never relabelled as settlement proof", () => {
  const transition = advanceCancellationOutcome({
    current: walkTo("WAITING_FOR_EXPECTED_WINDOW"),
    event: { kind: "CHARGE_EVALUATED", at: `${evaluatedOn}T00:00:00.000Z`, evaluation: evaluation("MISSING") },
  });
  assert.notEqual(transition.proof, "SETTLEMENT");
  for (const reason of transition.reasons) {
    assert.doesNotMatch(reason, /confirmed|settled/i, reason);
  }
});

test("evaluating a charge before any cancellation was claimed changes nothing", () => {
  for (const current of ["NONE", "CANCELLATION_INTENT_RECORDED"] as const) {
    const transition = advanceCancellationOutcome({
      current,
      event: { kind: "CHARGE_EVALUATED", at: `${evaluatedOn}T00:00:00.000Z`, evaluation: evaluation("MISSING") },
    });
    assert.equal(transition.accepted, false, current);
    assert.equal(transition.state, current);
  }
});

test("a claim cannot be recorded before an intent, and intent cannot be replayed backwards", () => {
  const early = advanceCancellationOutcome({
    current: "NONE",
    event: { kind: "CANCELLATION_CLAIMED", at: "2026-07-02T00:00:00.000Z", claimSource: "USER_REPORTED", evidenceIds: [] },
  });
  assert.equal(early.accepted, false);
  const backwards = advanceCancellationOutcome({
    current: "CHARGED_AGAIN",
    event: { kind: "INTENT_RECORDED", at: "2026-07-01T00:00:00.000Z" },
  });
  assert.equal(backwards.accepted, true);
  assert.equal(backwards.state, "CANCELLATION_INTENT_RECORDED");
});

test("replaying the same event is idempotent", () => {
  const current = walkTo("WAITING_FOR_EXPECTED_WINDOW");
  const event = { kind: "CHARGE_EVALUATED", at: `${evaluatedOn}T00:00:00.000Z`, evaluation: evaluation("MISSING") } as const;
  const first = advanceCancellationOutcome({ current, event });
  const second = advanceCancellationOutcome({ current: first.state, event });
  assert.equal(second.state, first.state);
  assert.deepEqual(second.citedEvidenceIds, first.citedEvidenceIds);
});

test("a merchant confirmation receipt is a claim, not a verification", () => {
  const transition = advanceCancellationOutcome({
    current: "CANCELLATION_INTENT_RECORDED",
    event: {
      kind: "CANCELLATION_CLAIMED",
      at: "2026-07-02T00:00:00.000Z",
      claimSource: "MERCHANT_CONFIRMATION_RECEIPT",
      evidenceIds: ["ev-confirm"],
    },
  });
  assert.equal(transition.state, "CANCELLATION_CLAIMED");
  assert.equal(transition.proof, "NONE");
  assert.deepEqual(transition.citedEvidenceIds, ["ev-confirm"]);
});
