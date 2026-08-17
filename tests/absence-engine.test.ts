import assert from "node:assert/strict";
import test from "node:test";

import { assessCommitmentCoverage, assessSourceLiveness, type SourceLivenessInput } from "../src/lib/recovery/source-liveness";
import {
  absenceGraceDays,
  absenceOutcomes,
  evaluateExpectedCharge,
  type ExpectedChargeInput,
} from "../src/lib/recovery/absence";

const today = "2026-08-17";

function coverage(state: "CURRENT" | "BROKEN" | "STALE" | "PARTIAL") {
  const overrides: Partial<SourceLivenessInput> =
    state === "BROKEN" ? { connected: false }
      : state === "STALE" ? { lastDeliveryAt: "2026-05-01T09:00:00.000Z", lastEvidenceAt: "2026-05-01T09:00:00.000Z" }
        : state === "PARTIAL" ? { coverageStart: "2026-08-01" }
          : {};
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
  }, new Date(`${today}T09:00:00.000Z`));
  assert.equal(source.state, state);
  return assessCommitmentCoverage(["src-1"], [source]);
}

function input(overrides: Partial<ExpectedChargeInput> = {}): ExpectedChargeInput {
  return {
    evaluatedOn: today,
    expectedDate: "2026-08-05",
    cadence: "MONTHLY",
    currency: "INR",
    expectedAmountMinor: BigInt(64900),
    coverage: coverage("CURRENT"),
    observations: [],
    cancellationClaimed: false,
    ...overrides,
  };
}

test("the outcome vocabulary is exactly the five declared results", () => {
  assert.deepEqual([...absenceOutcomes], [
    "ARRIVED_AS_EXPECTED", "ARRIVED_LATE", "AMOUNT_CHANGED", "NOT_OBSERVED", "CANNOT_EVALUATE_COVERAGE_BROKEN",
  ]);
});

test("a charge on the expected day at the expected amount arrived as expected", () => {
  const result = evaluateExpectedCharge(input({
    observations: [{ evidenceId: "ev-1", date: "2026-08-05", amountMinor: BigInt(64900), currency: "INR" }],
  }));
  assert.equal(result.status, "EVALUATED");
  assert.equal(result.status === "EVALUATED" && result.outcome, "ARRIVED_AS_EXPECTED");
  assert.deepEqual(result.citedEvidenceIds, ["ev-1"]);
});

test("a charge a day early still arrived as expected", () => {
  const result = evaluateExpectedCharge(input({
    observations: [{ evidenceId: "ev-1", date: "2026-08-04", amountMinor: BigInt(64900), currency: "INR" }],
  }));
  assert.equal(result.status === "EVALUATED" && result.outcome, "ARRIVED_AS_EXPECTED");
});

test("a charge inside the grace window but after the expected day arrived late", () => {
  const result = evaluateExpectedCharge(input({
    observations: [{ evidenceId: "ev-1", date: "2026-08-09", amountMinor: BigInt(64900), currency: "INR" }],
  }));
  assert.equal(result.status === "EVALUATED" && result.outcome, "ARRIVED_LATE");
  assert.equal(result.status === "EVALUATED" && result.lateByDays, 4);
});

test("a different amount is reported as an amount change with an exact delta", () => {
  const result = evaluateExpectedCharge(input({
    observations: [{ evidenceId: "ev-1", date: "2026-08-05", amountMinor: BigInt(74900), currency: "INR" }],
  }));
  assert.equal(result.status === "EVALUATED" && result.outcome, "AMOUNT_CHANGED");
  assert.equal(result.status === "EVALUATED" && result.observedAmountMinor, BigInt(74900));
  assert.equal(result.status === "EVALUATED" && result.deltaMinor, BigInt(10000));
  assert.equal(result.status === "EVALUATED" && result.deltaBasisPoints, 1541);
});

test("an amount change that also arrived late is still reported as an amount change", () => {
  const result = evaluateExpectedCharge(input({
    observations: [{ evidenceId: "ev-1", date: "2026-08-09", amountMinor: BigInt(74900), currency: "INR" }],
  }));
  assert.equal(result.status === "EVALUATED" && result.outcome, "AMOUNT_CHANGED");
  assert.equal(result.status === "EVALUATED" && result.lateByDays, 4);
});

test("an elapsed window with current coverage and nothing seen is not observed", () => {
  const result = evaluateExpectedCharge(input());
  assert.equal(result.status === "EVALUATED" && result.outcome, "NOT_OBSERVED");
});

test("absence is never turned into cancellation, even when cancellation was claimed", () => {
  const result = evaluateExpectedCharge(input({ cancellationClaimed: true }));
  assert.equal(result.status === "EVALUATED" && result.outcome, "NOT_OBSERVED");
  assert.ok(result.reasons.some((reason) => reason.toLowerCase().includes("not proof")));
});

test("broken coverage makes absence unusable rather than meaningful", () => {
  const result = evaluateExpectedCharge(input({ coverage: coverage("BROKEN") }));
  assert.equal(result.status === "EVALUATED" && result.outcome, "CANNOT_EVALUATE_COVERAGE_BROKEN");
});

test("stale and partial coverage are equally unusable for absence", () => {
  for (const state of ["STALE", "PARTIAL"] as const) {
    const result = evaluateExpectedCharge(input({ coverage: coverage(state) }));
    assert.equal(result.status === "EVALUATED" && result.outcome, "CANNOT_EVALUATE_COVERAGE_BROKEN", state);
  }
});

test("weak coverage never suppresses a charge we actually saw", () => {
  const result = evaluateExpectedCharge(input({
    coverage: coverage("BROKEN"),
    observations: [{ evidenceId: "ev-1", date: "2026-08-05", amountMinor: BigInt(64900), currency: "INR" }],
  }));
  assert.equal(result.status === "EVALUATED" && result.outcome, "ARRIVED_AS_EXPECTED");
});

test("a window that has not finished yet cannot be concluded", () => {
  const result = evaluateExpectedCharge(input({ expectedDate: "2026-08-16" }));
  assert.equal(result.status, "PENDING_WINDOW");
  assert.equal(result.window.end, "2026-08-21");
});

test("an unknown cadence produces no expectation at all", () => {
  const result = evaluateExpectedCharge(input({ cadence: "IRREGULAR" }));
  assert.equal(result.status, "NOT_APPLICABLE");
});

test("a missing expected date produces no expectation at all", () => {
  const result = evaluateExpectedCharge(input({ expectedDate: null }));
  assert.equal(result.status, "NOT_APPLICABLE");
});

test("grace scales with cadence so a yearly renewal is not chased after five days", () => {
  assert.equal(absenceGraceDays.MONTHLY, 5);
  assert.equal(absenceGraceDays.YEARLY, 14);
  const yearly = evaluateExpectedCharge(input({ cadence: "YEARLY", expectedDate: "2026-08-10" }));
  assert.equal(yearly.status, "PENDING_WINDOW");
});

test("a charge in another currency is not evidence for this commitment", () => {
  const result = evaluateExpectedCharge(input({
    observations: [{ evidenceId: "ev-1", date: "2026-08-05", amountMinor: BigInt(64900), currency: "USD" }],
  }));
  assert.equal(result.status === "EVALUATED" && result.outcome, "NOT_OBSERVED");
  assert.deepEqual(result.citedEvidenceIds, []);
});

test("a charge outside the window is not matched to this cycle", () => {
  const result = evaluateExpectedCharge(input({
    observations: [{ evidenceId: "ev-1", date: "2026-07-05", amountMinor: BigInt(64900), currency: "INR" }],
  }));
  assert.equal(result.status === "EVALUATED" && result.outcome, "NOT_OBSERVED");
});

test("the closest charge in the window is the one used", () => {
  const result = evaluateExpectedCharge(input({
    observations: [
      { evidenceId: "ev-late", date: "2026-08-09", amountMinor: BigInt(64900), currency: "INR" },
      { evidenceId: "ev-exact", date: "2026-08-05", amountMinor: BigInt(64900), currency: "INR" },
    ],
  }));
  assert.equal(result.status === "EVALUATED" && result.outcome, "ARRIVED_AS_EXPECTED");
  assert.deepEqual(result.citedEvidenceIds, ["ev-exact"]);
});

test("evaluation is deterministic for the same inputs", () => {
  const shared = input({
    observations: [{ evidenceId: "ev-1", date: "2026-08-09", amountMinor: BigInt(74900), currency: "INR" }],
  });
  assert.deepEqual(evaluateExpectedCharge(shared), evaluateExpectedCharge(shared));
});
