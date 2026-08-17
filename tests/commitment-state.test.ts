import assert from "node:assert/strict";
import test from "node:test";

import { assessCommitmentCoverage, assessSourceLiveness, type SourceLivenessInput } from "../src/lib/recovery/source-liveness";
import {
  buildCommitmentBelief,
  commitmentLifecycleStates,
  type CommitmentBeliefInput,
} from "../src/lib/recovery/commitment-state";

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

const monthly = (date: string, minor: number, evidenceId: string) =>
  ({ evidenceId, date, amountMinor: BigInt(minor), currency: "INR" });

function input(overrides: Partial<CommitmentBeliefInput> = {}): CommitmentBeliefInput {
  return {
    commitmentId: "c-1",
    merchant: "Netflix",
    currency: "INR",
    amountMinor: BigInt(64900),
    cadence: "MONTHLY",
    nextExpectedDate: "2026-08-05",
    evaluatedOn,
    coverage: coverageFor("CURRENT"),
    observations: [
      monthly("2026-06-05", 64900, "ev-jun"),
      monthly("2026-07-05", 64900, "ev-jul"),
      monthly("2026-08-05", 64900, "ev-aug"),
    ],
    cadenceAssertions: [{ at: "2026-07-05", cadence: "MONTHLY", evidenceIds: ["ev-jul"] }],
    cancellationState: "NONE",
    identityConflict: false,
    ...overrides,
  };
}

test("the lifecycle vocabulary is exactly the declared states", () => {
  assert.deepEqual([...commitmentLifecycleStates], [
    "OBSERVED", "ESTABLISHED", "CHANGED", "AT_RISK", "ENDING", "LIKELY_ENDED", "ENDED", "UNVERIFIABLE",
  ]);
});

test("a commitment answers all five questions", () => {
  const belief = buildCommitmentBelief(input());
  assert.ok(belief.belief.length > 0, "what do we believe");
  assert.ok(belief.because.length > 0, "why");
  assert.ok(belief.lastVerifiedAt, "when was it last verified");
  assert.ok(belief.nextVerificationDueAt, "what do we expect next");
  assert.ok(belief.falsifiability.length > 0, "what would prove it wrong");
});

test("a repeatedly confirmed subscription is established", () => {
  const belief = buildCommitmentBelief(input());
  assert.equal(belief.lifecycleState, "ESTABLISHED");
  assert.equal(belief.lastVerifiedAt, "2026-08-05");
  assert.equal(belief.predictionState, "PREDICTED");
  assert.deepEqual(belief.citedEvidenceIds, ["ev-aug"]);
});

test("a single sighting is only observed, and no prediction is made", () => {
  const belief = buildCommitmentBelief(input({
    observations: [monthly("2026-08-05", 64900, "ev-aug")],
    cadence: "IRREGULAR",
    nextExpectedDate: null,
  }));
  assert.equal(belief.lifecycleState, "OBSERVED");
  assert.equal(belief.predictionState, "WITHHELD_UNKNOWN_RHYTHM");
  assert.equal(belief.nextVerificationDueAt, null);
  assert.equal(belief.expectedChargeWindow, null);
});

test("a price change moves the commitment to changed and records both prices", () => {
  const belief = buildCommitmentBelief(input({
    observations: [
      monthly("2026-06-05", 64900, "ev-jun"),
      monthly("2026-07-05", 64900, "ev-jul"),
      monthly("2026-08-05", 74900, "ev-aug"),
    ],
  }));
  assert.equal(belief.lifecycleState, "CHANGED");
  assert.equal(belief.conflictState, "NONE");
  assert.deepEqual(belief.priceHistory.map((point) => [point.fromDate, point.amountMinor.toString()]), [
    ["2026-06-05", "64900"],
    ["2026-08-05", "74900"],
  ]);
  assert.deepEqual(belief.priceHistory.at(-1)?.evidenceIds, ["ev-aug"]);
});

test("an expected charge that never arrived puts the commitment at risk without ending it", () => {
  const belief = buildCommitmentBelief(input({
    observations: [monthly("2026-06-05", 64900, "ev-jun"), monthly("2026-07-05", 64900, "ev-jul")],
  }));
  assert.equal(belief.lifecycleState, "AT_RISK");
  assert.equal(belief.cancellationState, "NONE");
  assert.ok(belief.because.some((reason) => reason.toLowerCase().includes("nothing arrived")));
});

test("broken coverage makes the commitment unverifiable rather than at risk", () => {
  const belief = buildCommitmentBelief(input({
    coverage: coverageFor("BROKEN"),
    observations: [monthly("2026-06-05", 64900, "ev-jun"), monthly("2026-07-05", 64900, "ev-jul")],
  }));
  assert.equal(belief.lifecycleState, "UNVERIFIABLE");
  assert.equal(belief.coverageState, "BROKEN");
  assert.equal(belief.predictionState, "WITHHELD_COVERAGE_NOT_TRUSTWORTHY");
});

test("a recorded cancellation shows as ending until a window decides it", () => {
  for (const state of ["CANCELLATION_INTENT_RECORDED", "CANCELLATION_CLAIMED", "WAITING_FOR_EXPECTED_WINDOW"] as const) {
    assert.equal(buildCommitmentBelief(input({ cancellationState: state })).lifecycleState, "ENDING", state);
  }
});

test("a covered quiet window after a claim reads as likely ended, never as ended", () => {
  const belief = buildCommitmentBelief(input({
    cancellationState: "LIKELY_STOPPED_BY_COVERED_ABSENCE",
    observations: [monthly("2026-06-05", 64900, "ev-jun"), monthly("2026-07-05", 64900, "ev-jul")],
  }));
  assert.equal(belief.lifecycleState, "LIKELY_ENDED");
  assert.equal(belief.predictionState, "WITHHELD_ENDED");
  assert.ok(belief.falsifiability.some((claim) => claim.toLowerCase().includes("charge")));
});

test("a charge after a cancellation claim is a conflict the customer must see", () => {
  const belief = buildCommitmentBelief(input({ cancellationState: "CHARGED_AGAIN" }));
  assert.equal(belief.lifecycleState, "ENDING");
  assert.equal(belief.conflictState, "CANCELLATION_NOT_EFFECTIVE");
});

test("only a settled cancellation reads as ended", () => {
  assert.equal(buildCommitmentBelief(input({ cancellationState: "CONFIRMED_BY_SETTLEMENT" })).lifecycleState, "ENDED");
});

test("an unverifiable cancellation stays unverifiable", () => {
  assert.equal(buildCommitmentBelief(input({ cancellationState: "CANNOT_VERIFY" })).lifecycleState, "UNVERIFIABLE");
});

test("a merchant identity conflict is surfaced rather than resolved silently", () => {
  const belief = buildCommitmentBelief(input({ identityConflict: true }));
  assert.equal(belief.conflictState, "IDENTITY_CONFLICT");
});

test("cadence history is taken from what was recorded, never re-derived", () => {
  const belief = buildCommitmentBelief(input({
    cadenceAssertions: [
      { at: "2026-07-05", cadence: "MONTHLY", evidenceIds: ["ev-jul"] },
      { at: "2026-06-05", cadence: "IRREGULAR", evidenceIds: ["ev-jun"] },
      { at: "2026-07-05", cadence: "MONTHLY", evidenceIds: ["ev-jul"] },
    ],
  }));
  assert.deepEqual(belief.cadenceHistory.map((point) => [point.at, point.cadence]), [
    ["2026-06-05", "IRREGULAR"],
    ["2026-07-05", "MONTHLY"],
  ]);
});

test("the expected window and the next verification date agree", () => {
  const belief = buildCommitmentBelief(input({ nextExpectedDate: "2026-08-20" }));
  assert.deepEqual(belief.expectedChargeWindow, { start: "2026-08-19", end: "2026-08-25" });
  assert.equal(belief.nextVerificationDueAt, "2026-08-25");
});

test("the belief never leaks internal vocabulary to the customer", () => {
  const belief = buildCommitmentBelief(input({ cancellationState: "CHARGED_AGAIN", identityConflict: true }));
  for (const line of [belief.belief, ...belief.because, ...belief.falsifiability]) {
    assert.doesNotMatch(line, /[A-Z]{3,}_[A-Z]/, `leaked an internal name: ${line}`);
  }
});

test("the belief is deterministic for the same inputs", () => {
  const shared = input();
  assert.deepEqual(buildCommitmentBelief(shared), buildCommitmentBelief(shared));
});
