import assert from "node:assert/strict";
import test from "node:test";

import { buildCommitmentBelief, type CommitmentBeliefInput } from "../src/lib/recovery/commitment-state";
import {
  changeMaterialities,
  changeSignalKinds,
  changeSignalStates,
  detectChangeSignals,
  reconcileChangeSignals,
  type ChangeSignal,
  type CommitmentChangeContext,
  type StoredChangeSignal,
} from "../src/lib/recovery/change-intelligence";
import {
  assessCommitmentCoverage,
  assessSourceLiveness,
  rollUpWorkspaceCoverage,
  type SourceLivenessInput,
} from "../src/lib/recovery/source-liveness";

const evaluatedOn = "2026-08-17";
const at = `${evaluatedOn}T09:00:00.000Z`;

function liveness(overrides: Partial<SourceLivenessInput> = {}) {
  return assessSourceLiveness({
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
  }, new Date(at));
}

const monthly = (date: string, minor: number, evidenceId: string) =>
  ({ evidenceId, date, amountMinor: BigInt(minor), currency: "INR" });

function belief(overrides: Partial<CommitmentBeliefInput> = {}) {
  return buildCommitmentBelief({
    commitmentId: "c-1",
    merchant: "Netflix",
    currency: "INR",
    amountMinor: BigInt(64900),
    cadence: "MONTHLY",
    nextExpectedDate: "2026-08-05",
    evaluatedOn,
    coverage: assessCommitmentCoverage(["src-1"], [liveness()]),
    observations: [monthly("2026-06-05", 64900, "ev-jun"), monthly("2026-07-05", 64900, "ev-jul"), monthly("2026-08-05", 64900, "ev-aug")],
    cadenceAssertions: [],
    cancellationState: "NONE",
    ...overrides,
  });
}

function context(overrides: Partial<CommitmentChangeContext> = {}): CommitmentChangeContext {
  return {
    belief: belief(),
    merchant: "Netflix",
    currency: "INR",
    amountMinor: BigInt(64900),
    cadence: "MONTHLY",
    nextExpectedDate: "2026-08-05",
    firstDetectedAt: "2026-07-20T00:00:00.000Z",
    observationCount: 3,
    trial: null,
    ...overrides,
  };
}

function detect(overrides: {
  commitments?: readonly CommitmentChangeContext[];
  sources?: ReturnType<typeof liveness>[];
  duplicates?: Parameters<typeof detectChangeSignals>[0]["duplicateSuspicions"];
} = {}) {
  const sources = overrides.sources ?? [liveness()];
  return detectChangeSignals({
    evaluatedOn,
    commitments: overrides.commitments ?? [context()],
    sources,
    workspaceCoverage: rollUpWorkspaceCoverage(sources),
    duplicateSuspicions: overrides.duplicates ?? [],
  });
}

const kindsOf = (signals: readonly ChangeSignal[]) => signals.map((signal) => signal.kind).sort();

test("the change vocabulary is exactly the eight declared kinds", () => {
  assert.deepEqual([...changeSignalKinds], [
    "TRIAL_CONVERTING",
    "ANNUAL_RENEWAL_APPROACHING",
    "PRICE_INCREASE",
    "NEW_RECURRING_COMMITMENT",
    "DUPLICATE_SUSPECTED",
    "EXPECTED_CHARGE_MISSING",
    "CANCELLATION_NOT_EFFECTIVE",
    "COVERAGE_BROKEN",
  ]);
  assert.deepEqual([...changeSignalStates], ["OPEN", "ACKNOWLEDGED", "RESOLVED", "SUPERSEDED", "EXPIRED"]);
  assert.deepEqual([...changeMaterialities], ["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
});

test("a settled subscription with nothing new raises nothing at all", () => {
  assert.deepEqual(detect({ commitments: [context({ firstDetectedAt: "2026-01-05T00:00:00.000Z" })] }), []);
});

test("a trial about to convert is raised and cites the receipt that said so", () => {
  const signals = detect({
    commitments: [context({
      firstDetectedAt: "2026-01-05T00:00:00.000Z",
      trial: { endsOn: "2026-08-24", evidenceIds: ["ev-trial"] },
    })],
  });
  assert.deepEqual(kindsOf(signals), ["TRIAL_CONVERTING"]);
  assert.deepEqual(signals[0]!.citation, { kind: "EVIDENCE", evidenceIds: ["ev-trial"] });
  assert.equal(signals[0]!.materiality, "HIGH");
});

test("a trial that ends far away is not raised yet", () => {
  assert.deepEqual(detect({
    commitments: [context({ firstDetectedAt: "2026-01-05T00:00:00.000Z", trial: { endsOn: "2026-12-01", evidenceIds: ["ev-trial"] } })],
  }), []);
});

test("an annual renewal inside the notice window is raised", () => {
  const signals = detect({
    commitments: [context({
      firstDetectedAt: "2025-09-10T00:00:00.000Z",
      cadence: "YEARLY",
      nextExpectedDate: "2026-09-10",
      belief: belief({ cadence: "YEARLY", nextExpectedDate: "2026-09-10" }),
    })],
  });
  assert.deepEqual(kindsOf(signals), ["ANNUAL_RENEWAL_APPROACHING"]);
  assert.equal(signals[0]!.dueDate, "2026-09-10");
});

test("a price increase is raised with the exact delta; a decrease is not an increase", () => {
  const raised = detect({
    commitments: [context({
      firstDetectedAt: "2026-01-05T00:00:00.000Z",
      belief: belief({ observations: [monthly("2026-07-05", 64900, "ev-jul"), monthly("2026-08-05", 74900, "ev-aug")] }),
    })],
  });
  assert.deepEqual(kindsOf(raised), ["PRICE_INCREASE"]);
  assert.equal(raised[0]!.deltaMinor, BigInt(10000));
  assert.deepEqual(raised[0]!.citation, { kind: "EVIDENCE", evidenceIds: ["ev-aug"] });

  const lowered = detect({
    commitments: [context({
      firstDetectedAt: "2026-01-05T00:00:00.000Z",
      belief: belief({ observations: [monthly("2026-07-05", 74900, "ev-jul"), monthly("2026-08-05", 64900, "ev-aug")] }),
    })],
  });
  assert.deepEqual(kindsOf(lowered), []);
});

test("a newly proven recurring commitment is raised once, but a single sighting is not", () => {
  assert.deepEqual(kindsOf(detect({ commitments: [context()] })), ["NEW_RECURRING_COMMITMENT"]);
  assert.deepEqual(kindsOf(detect({ commitments: [context({ observationCount: 1 })] })), []);
});

test("a suspected duplicate is raised for review and never merged silently", () => {
  const signals = detect({
    commitments: [context({ firstDetectedAt: "2026-01-05T00:00:00.000Z" })],
    duplicates: [{
      commitmentId: "c-1",
      otherCommitmentId: "c-2",
      merchant: "Netflix",
      otherMerchant: "NETFLIX.COM",
      score: 62,
      evidenceIds: ["ev-a", "ev-b"],
      reasons: ["We matched a close name similarity only."],
    }],
  });
  assert.deepEqual(kindsOf(signals), ["DUPLICATE_SUSPECTED"]);
  assert.equal(signals[0]!.confidence, 62);
  assert.equal(signals[0]!.materiality, "MEDIUM");
});

test("a duplicate pair is raised once regardless of which side is evaluated first", () => {
  const pair = {
    merchant: "Netflix", otherMerchant: "NETFLIX.COM", score: 62,
    evidenceIds: ["ev-a", "ev-b"], reasons: ["We matched a close name similarity only."],
  };
  const forwards = detect({
    commitments: [context({ firstDetectedAt: "2026-01-05T00:00:00.000Z" })],
    duplicates: [{ ...pair, commitmentId: "c-1", otherCommitmentId: "c-2" }, { ...pair, commitmentId: "c-2", otherCommitmentId: "c-1" }],
  });
  assert.equal(forwards.length, 1);
});

test("a missing expected charge cites a covered absence, not evidence", () => {
  const signals = detect({
    commitments: [context({
      firstDetectedAt: "2026-01-05T00:00:00.000Z",
      belief: belief({ observations: [monthly("2026-06-05", 64900, "ev-jun"), monthly("2026-07-05", 64900, "ev-jul")] }),
    })],
  });
  assert.deepEqual(kindsOf(signals), ["EXPECTED_CHARGE_MISSING"]);
  assert.equal(signals[0]!.citation.kind, "COVERED_ABSENCE");
  assert.ok(signals[0]!.detail.toLowerCase().includes("not"));
});

test("an absence we cannot evaluate raises broken coverage instead of a missing charge", () => {
  const broken = liveness({ connected: false });
  const signals = detect({
    sources: [broken],
    commitments: [context({
      firstDetectedAt: "2026-01-05T00:00:00.000Z",
      belief: belief({
        coverage: assessCommitmentCoverage(["src-1"], [broken]),
        observations: [monthly("2026-06-05", 64900, "ev-jun"), monthly("2026-07-05", 64900, "ev-jul")],
      }),
    })],
  });
  assert.deepEqual(kindsOf(signals), ["COVERAGE_BROKEN"]);
  assert.equal(signals[0]!.citation.kind, "SOURCE_HEALTH");
  assert.equal(signals[0]!.materiality, "CRITICAL");
});

test("a charge after a cancellation is raised as the cancellation not taking effect", () => {
  const signals = detect({
    commitments: [context({ firstDetectedAt: "2026-01-05T00:00:00.000Z", belief: belief({ cancellationState: "CHARGED_AGAIN" }) })],
  });
  assert.ok(kindsOf(signals).includes("CANCELLATION_NOT_EFFECTIVE"));
  const signal = signals.find((entry) => entry.kind === "CANCELLATION_NOT_EFFECTIVE")!;
  assert.equal(signal.materiality, "CRITICAL");
  assert.equal(signal.citation.kind, "EVIDENCE");
});

test("every raised change cites something and never cites an unsupported absence", () => {
  const broken = liveness({ connected: false });
  for (const signals of [
    detect(),
    detect({ commitments: [context({ trial: { endsOn: "2026-08-24", evidenceIds: ["ev-trial"] } })] }),
    detect({ sources: [broken], commitments: [context({ belief: belief({ coverage: assessCommitmentCoverage(["src-1"], [broken]) }) })] }),
  ]) {
    for (const signal of signals) {
      if (signal.citation.kind === "EVIDENCE") assert.ok(signal.citation.evidenceIds.length > 0, signal.kind);
      if (signal.citation.kind === "COVERED_ABSENCE") assert.ok(signal.citation.coverageSourceIds.length > 0, signal.kind);
      if (signal.citation.kind === "SOURCE_HEALTH") assert.ok(signal.citation.sourceIds.length > 0, signal.kind);
    }
  }
});

test("detection is idempotent: the same facts produce the same dedupe keys", () => {
  const first = detect();
  const second = detect();
  assert.deepEqual(first.map((signal) => signal.dedupeKey), second.map((signal) => signal.dedupeKey));
  assert.equal(new Set(first.map((signal) => signal.dedupeKey)).size, first.length);
});

test("re-detecting an open change leaves it untouched", () => {
  const detected = detect();
  const stored: StoredChangeSignal[] = detected.map((signal) => ({
    dedupeKey: signal.dedupeKey, kind: signal.kind, commitmentId: signal.commitmentId, state: "OPEN",
  }));
  const plan = reconcileChangeSignals({ stored, detected, at });
  assert.deepEqual(plan.opened, []);
  assert.deepEqual(plan.closed, []);
  assert.deepEqual(plan.superseded, []);
});

test("an acknowledged change is not reopened while it still holds", () => {
  const detected = detect();
  const plan = reconcileChangeSignals({
    stored: detected.map((signal) => ({ dedupeKey: signal.dedupeKey, kind: signal.kind, commitmentId: signal.commitmentId, state: "ACKNOWLEDGED" as const })),
    detected,
    at,
  });
  assert.deepEqual(plan.opened, []);
  assert.deepEqual(plan.closed, []);
});

test("a change that no longer holds is resolved, not deleted", () => {
  const plan = reconcileChangeSignals({
    stored: [{ dedupeKey: "EXPECTED_CHARGE_MISSING:c-1:2026-08-04", kind: "EXPECTED_CHARGE_MISSING", commitmentId: "c-1", state: "OPEN" }],
    detected: [],
    at,
  });
  assert.deepEqual(plan.closed, [{ dedupeKey: "EXPECTED_CHARGE_MISSING:c-1:2026-08-04", state: "RESOLVED", at }]);
});

test("a second price rise supersedes the first rather than duplicating it", () => {
  const detected = detect({
    commitments: [context({
      firstDetectedAt: "2026-01-05T00:00:00.000Z",
      belief: belief({ observations: [monthly("2026-07-05", 74900, "ev-jul"), monthly("2026-08-05", 84900, "ev-aug")] }),
    })],
  });
  const plan = reconcileChangeSignals({
    stored: [{ dedupeKey: "PRICE_INCREASE:c-1:64900:74900", kind: "PRICE_INCREASE", commitmentId: "c-1", state: "OPEN" }],
    detected,
    at,
  });
  assert.equal(plan.opened.length, 1);
  assert.deepEqual(plan.superseded, [{ dedupeKey: "PRICE_INCREASE:c-1:64900:74900", state: "SUPERSEDED", at }]);
  assert.deepEqual(plan.closed, []);
});

test("a resolved change is never resurrected by reconciliation", () => {
  const detected = detect();
  const plan = reconcileChangeSignals({
    stored: detected.map((signal) => ({ dedupeKey: signal.dedupeKey, kind: signal.kind, commitmentId: signal.commitmentId, state: "RESOLVED" as const })),
    detected,
    at,
  });
  assert.deepEqual(plan.opened, []);
  assert.deepEqual(plan.closed, []);
});
