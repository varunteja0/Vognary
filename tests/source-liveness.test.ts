import assert from "node:assert/strict";
import test from "node:test";

import {
  assessCommitmentCoverage,
  assessSourceLiveness,
  isCoverageTrustworthy,
  rollUpWorkspaceCoverage,
  sourceLivenessStates,
  type SourceLivenessInput,
} from "../src/lib/recovery/source-liveness";

const now = new Date("2026-08-17T09:00:00.000Z");

function source(overrides: Partial<SourceLivenessInput> = {}): SourceLivenessInput {
  return {
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
  };
}

test("the liveness vocabulary is exactly the six declared states", () => {
  assert.deepEqual([...sourceLivenessStates], [
    "CURRENT", "PARTIAL", "STALE", "BROKEN", "BASELINE_ONLY", "NO_EVIDENCE",
  ]);
});

test("a healthy automatic feed with a wide window is current", () => {
  const state = assessSourceLiveness(source(), now);
  assert.equal(state.state, "CURRENT");
  assert.equal(state.automatic, true);
  assert.equal(state.trustworthy, true);
});

test("a revoked credential is broken, never merely stale", () => {
  const state = assessSourceLiveness(source({ credentialRevoked: true, lastDeliveryAt: now.toISOString() }), now);
  assert.equal(state.state, "BROKEN");
  assert.equal(state.trustworthy, false);
  assert.ok(state.limitations.some((limitation) => limitation.toLowerCase().includes("reconnect")));
});

test("a disconnected source is broken even while its old evidence looks fresh", () => {
  assert.equal(assessSourceLiveness(source({ connected: false }), now).state, "BROKEN");
});

test("repeated delivery failures break a source", () => {
  assert.equal(assessSourceLiveness(source({ consecutiveFailureCount: 2 }), now).state, "CURRENT");
  assert.equal(assessSourceLiveness(source({ consecutiveFailureCount: 3 }), now).state, "BROKEN");
});

test("an automatic feed that stopped delivering goes stale", () => {
  const state = assessSourceLiveness(source({ lastDeliveryAt: "2026-06-01T09:00:00.000Z", lastEvidenceAt: "2026-06-01T09:00:00.000Z" }), now);
  assert.equal(state.state, "STALE");
  assert.equal(state.trustworthy, false);
});

test("a narrow but recent automatic window is partial, not current", () => {
  const state = assessSourceLiveness(source({ coverageStart: "2026-08-01", coverageEnd: "2026-08-14" }), now);
  assert.equal(state.state, "PARTIAL");
});

test("a one-shot import is a baseline and never claims to be live", () => {
  const csv = assessSourceLiveness(source({ sourceId: "src-csv", kind: "CSV_IMPORT" }), now);
  assert.equal(csv.state, "BASELINE_ONLY");
  assert.equal(csv.automatic, false);
  assert.equal(csv.trustworthy, false);
  const paste = assessSourceLiveness(source({ sourceId: "src-paste", kind: "RECEIPT_PASTE" }), now);
  assert.equal(paste.state, "BASELINE_ONLY");
});

test("a provisioned source that has produced nothing has no evidence", () => {
  const state = assessSourceLiveness(source({ evidenceCount: 0, lastEvidenceAt: null, lastDeliveryAt: null, coverageStart: null, coverageEnd: null }), now);
  assert.equal(state.state, "NO_EVIDENCE");
});

test("only current coverage is trustworthy for absence reasoning", () => {
  assert.equal(isCoverageTrustworthy("CURRENT"), true);
  for (const state of ["PARTIAL", "STALE", "BROKEN", "BASELINE_ONLY", "NO_EVIDENCE"] as const) {
    assert.equal(isCoverageTrustworthy(state), false, state);
  }
});

test("a commitment cited only to a broken source is broken, whatever else the workspace has", () => {
  const states = [
    assessSourceLiveness(source({ sourceId: "healthy" }), now),
    assessSourceLiveness(source({ sourceId: "dead", connected: false }), now),
  ];
  const coverage = assessCommitmentCoverage(["dead"], states);
  assert.equal(coverage.state, "BROKEN");
  assert.deepEqual(coverage.brokenSourceIds, ["dead"]);
  assert.equal(rollUpWorkspaceCoverage(states).state, "CURRENT");
});

test("a commitment keeps the best state among the sources it actually cites", () => {
  const states = [
    assessSourceLiveness(source({ sourceId: "healthy" }), now),
    assessSourceLiveness(source({ sourceId: "dead", connected: false }), now),
  ];
  const coverage = assessCommitmentCoverage(["dead", "healthy"], states);
  assert.equal(coverage.state, "CURRENT");
  assert.deepEqual(coverage.brokenSourceIds, ["dead"]);
});

test("a commitment citing no known source cannot claim any coverage", () => {
  assert.equal(assessCommitmentCoverage([], []).state, "NO_EVIDENCE");
  assert.equal(assessCommitmentCoverage(["ghost"], []).state, "NO_EVIDENCE");
});

test("a workspace with only imports reports a baseline, never currency", () => {
  const states = [assessSourceLiveness(source({ kind: "CSV_IMPORT" }), now)];
  const rollup = rollUpWorkspaceCoverage(states);
  assert.equal(rollup.state, "BASELINE_ONLY");
  assert.equal(rollup.automaticSourceCount, 0);
  assert.ok(rollup.limitations.some((limitation) => limitation.toLowerCase().includes("automatic")));
});

test("a workspace whose only automatic feed broke reports broken coverage", () => {
  const states = [
    assessSourceLiveness(source({ sourceId: "dead", connected: false }), now),
    assessSourceLiveness(source({ sourceId: "csv", kind: "CSV_IMPORT" }), now),
  ];
  const rollup = rollUpWorkspaceCoverage(states);
  assert.equal(rollup.state, "BROKEN");
  assert.deepEqual(rollup.brokenSourceIds, ["dead"]);
});

test("broken and stale sources are always named even when another feed is current", () => {
  const states = [
    assessSourceLiveness(source({ sourceId: "live" }), now),
    assessSourceLiveness(source({ sourceId: "dead", connected: false }), now),
    assessSourceLiveness(source({ sourceId: "old", lastDeliveryAt: "2026-05-01T09:00:00.000Z", lastEvidenceAt: "2026-05-01T09:00:00.000Z" }), now),
  ];
  const rollup = rollUpWorkspaceCoverage(states);
  assert.equal(rollup.state, "CURRENT");
  assert.deepEqual(rollup.brokenSourceIds, ["dead"]);
  assert.deepEqual(rollup.staleSourceIds, ["old"]);
  assert.equal(rollup.coverageBroken, true);
});

test("an empty workspace has no evidence and says so", () => {
  const rollup = rollUpWorkspaceCoverage([]);
  assert.equal(rollup.state, "NO_EVIDENCE");
  assert.equal(rollup.coverageBroken, false);
  assert.ok(rollup.limitations.length > 0);
});
