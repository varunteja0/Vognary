import assert from "node:assert/strict";
import test from "node:test";
import { evaluateExpectedCharge } from "../src/lib/recovery/absence";
import { presentCommitmentMemory, presentExpectedVsObserved } from "../src/lib/recovery/expected-observation";

const coverage = {
  state: "CURRENT" as const,
  trustworthy: true,
  citedSourceIds: ["source-1"],
  brokenSourceIds: [],
  staleSourceIds: [],
  limitations: [],
};

test("expected vs observed never reports cancellation from a missing charge", () => {
  const evaluation = evaluateExpectedCharge({
    evaluatedOn: "2026-08-20",
    expectedDate: "2026-08-10",
    cadence: "MONTHLY",
    currency: "INR",
    expectedAmountMinor: BigInt(200_00),
    coverage,
    observations: [],
    cancellationClaimed: false,
  });
  const presented = presentExpectedVsObserved({
    evaluation,
    expectedDate: "2026-08-10",
    expectedAmountMinor: BigInt(200_00),
    currency: "INR",
    cadence: "MONTHLY",
  });
  assert.equal(presented.status, "NOT_YET_OBSERVED");
  assert.match(presented.summary, /not proof of cancellation/i);
  assert.equal(presented.observedAmount, null);
});

test("a matching observation in the window is presented as matched", () => {
  const evaluation = evaluateExpectedCharge({
    evaluatedOn: "2026-08-12",
    expectedDate: "2026-08-10",
    cadence: "MONTHLY",
    currency: "USD",
    expectedAmountMinor: BigInt(200_00),
    coverage,
    observations: [{ evidenceId: "evidence-1", date: "2026-08-10", amountMinor: BigInt(200_00), currency: "USD" }],
    cancellationClaimed: false,
  });
  const presented = presentExpectedVsObserved({
    evaluation,
    expectedDate: "2026-08-10",
    expectedAmountMinor: BigInt(200_00),
    currency: "USD",
    cadence: "MONTHLY",
  });
  assert.equal(presented.status, "MATCHED");
  assert.equal(presented.observedAmount?.minor, "20000");
  assert.equal(presented.observedDate, "2026-08-10");
});

test("an irregular cadence is insufficient history rather than an invented expectation", () => {
  const evaluation = evaluateExpectedCharge({
    evaluatedOn: "2026-08-12",
    expectedDate: "2026-08-10",
    cadence: "IRREGULAR",
    currency: "INR",
    expectedAmountMinor: BigInt(8300_00),
    coverage,
    observations: [],
    cancellationClaimed: false,
  });
  const presented = presentExpectedVsObserved({
    evaluation,
    expectedDate: "2026-08-10",
    expectedAmountMinor: BigInt(8300_00),
    currency: "INR",
    cadence: "IRREGULAR",
  });
  assert.equal(presented.status, "INSUFFICIENT_HISTORY");
  assert.equal(presented.expectedAmount, null);
});

test("an amount that arrived in-window is presented as amount changed, not cancellation", () => {
  const evaluation = evaluateExpectedCharge({
    evaluatedOn: "2026-08-20",
    expectedDate: "2026-08-10",
    cadence: "MONTHLY",
    currency: "USD",
    expectedAmountMinor: BigInt(200_00),
    coverage,
    observations: [{ evidenceId: "evidence-1", date: "2026-08-10", amountMinor: BigInt(250_00), currency: "USD" }],
    cancellationClaimed: false,
  });
  const presented = presentExpectedVsObserved({
    evaluation,
    expectedDate: "2026-08-10",
    expectedAmountMinor: BigInt(200_00),
    currency: "USD",
    cadence: "MONTHLY",
  });
  assert.equal(presented.status, "AMOUNT_CHANGED");
  assert.equal(presented.observedAmount?.minor, "25000");
  assert.doesNotMatch(presented.summary, /cancel/i);
});

test("broken coverage is cannot-evaluate rather than a missing-charge claim", () => {
  const evaluation = evaluateExpectedCharge({
    evaluatedOn: "2026-08-20",
    expectedDate: "2026-08-10",
    cadence: "MONTHLY",
    currency: "INR",
    expectedAmountMinor: BigInt(200_00),
    coverage: { ...coverage, trustworthy: false, state: "BROKEN", limitations: ["The watching source failed."] },
    observations: [],
    cancellationClaimed: false,
  });
  const presented = presentExpectedVsObserved({
    evaluation,
    expectedDate: "2026-08-10",
    expectedAmountMinor: BigInt(200_00),
    currency: "INR",
    cadence: "MONTHLY",
  });
  assert.equal(presented.status, "CANNOT_EVALUATE");
  assert.match(presented.summary, /will not guess/i);
});

test("commitment memory is chronological stored evidence, not a reconstructed forecast", () => {
  const memory = presentCommitmentMemory([
    { date: "2026-05-01", amountMinor: BigInt(200_00), currency: "USD", sourceType: "FORWARDED_EMAIL", evidenceId: "b" },
    { date: "2026-03-01", amountMinor: BigInt(100_00), currency: "USD", sourceType: "RECEIPT_PASTE", evidenceId: "a" },
  ]);
  assert.deepEqual(memory.map((point) => [point.date, point.amount.minor, point.sourceType]), [
    ["2026-03-01", "10000", "RECEIPT_PASTE"],
    ["2026-05-01", "20000", "FORWARDED_EMAIL"],
  ]);
});
