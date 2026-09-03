import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isCommitmentControlBriefDto } from "../src/lib/commitment-control/contracts";
import {
  deskQueueGroups,
  deskQueueStates,
  syntheticDeskBrief,
  syntheticDeskBriefWithoutPolicy,
  syntheticDeskEmptyBrief,
  syntheticDeskIdentity,
  syntheticDeskLeadKey,
  syntheticDeskRecord,
  syntheticDeskRecords,
  syntheticDeskVerdictVariants,
} from "../src/lib/synthetic-control-desk";
import { SYNTHETIC_DEMO_UUID_NAMESPACE } from "../src/lib/synthetic-fixture-identity";

const deskSource = readFileSync("src/lib/synthetic-control-desk.ts", "utf8");

test("the desk is a valid brief the product itself would accept", () => {
  assert.equal(isCommitmentControlBriefDto(syntheticDeskBrief()), true);
  assert.equal(isCommitmentControlBriefDto(syntheticDeskBriefWithoutPolicy()), true);
  assert.equal(isCommitmentControlBriefDto(syntheticDeskEmptyBrief()), true);
});

test("the desk carries the six states a finance owner meets in a week", () => {
  // Each expectation is the *state*, never the derived status: the engine
  // decides whether a request is outside policy, not this table.
  const expected: ReadonlyArray<readonly [string, string, string | null, string | null]> = [
    ["model-api", "DECIDE_NOW", null, null],
    ["cloud-failover", "REVIEW_REQUEST", null, null],
    ["observability", "AWAITING_EVIDENCE", "APPROVE_WITH_CAP", null],
    ["vector-database", "INSPECT_OVERRUN", "APPROVE", "OVER_CAP"],
    ["security-assessment", "CLOSED_MATCHED", "APPROVE", "MATCHED"],
    ["launch-campaign", "CLOSED_REFUSED", "DECLINE", null],
  ];
  assert.equal(syntheticDeskRecords.length, expected.length);
  expected.forEach(([key, queueState, action, verdict], index) => {
    const found = syntheticDeskRecords[index];
    assert.equal(found.key, key, "declared order is preserved");
    assert.equal(found.queueState, queueState);
    assert.equal(found.entry.decision?.action ?? null, action);
    assert.equal(found.entry.reconciliations[0]?.verdict ?? null, verdict);
  });
});

test("policy status and reason codes are derived, not chosen", () => {
  const modelApi = syntheticDeskRecord("model-api").entry.evaluation;
  assert.equal(modelApi?.status, "OUTSIDE_POLICY");
  assert.deepEqual(modelApi?.reasonCodes, ["PER_CHARGE_LIMIT_EXCEEDED"]);

  const cloud = syntheticDeskRecord("cloud-failover").entry.evaluation;
  assert.equal(cloud?.status, "REVIEW_REQUIRED");
  assert.equal(cloud?.citedExposureBasis, "NONE", "an uncited record says so rather than implying history");

  const campaign = syntheticDeskRecord("launch-campaign").entry.evaluation;
  assert.equal(campaign?.status, "OUTSIDE_POLICY");
  assert.ok(campaign?.reasonCodes.includes("CATEGORY_OUTSIDE_POLICY"));

  // A within-policy record proves the desk is not uniformly alarming.
  assert.equal(syntheticDeskRecord("vector-database").entry.evaluation?.status, "WITHIN_POLICY");
  assert.equal(syntheticDeskRecord("observability").entry.evaluation?.status, "WITHIN_POLICY");
});

test("a refusal creates no cap and nothing to reconcile against", () => {
  const refused = syntheticDeskRecord("launch-campaign").entry;
  assert.equal(refused.decision?.approvedCapMinor, null);
  assert.deepEqual(refused.reconciliations, []);
});

test("every reconciliation verdict the engine can return is reachable", () => {
  const onDesk = syntheticDeskRecords.flatMap((entry) => entry.entry.reconciliations.map((r) => r.verdict));
  const inVariants = Object.values(syntheticDeskVerdictVariants).map((r) => r.verdict);
  const all = new Set([...onDesk, ...inVariants]);
  for (const verdict of ["MATCHED", "WITHIN_CAP", "OVER_CAP", "CURRENCY_MISMATCH", "CANNOT_EVALUATE"]) {
    assert.ok(all.has(verdict as never), `${verdict} must be reachable from the fixture`);
  }
  // A mismatched currency is never converted, and an unknown amount stays null.
  assert.equal(syntheticDeskVerdictVariants.CURRENCY_MISMATCH.observedCurrency, "USD");
  assert.equal(syntheticDeskVerdictVariants.CURRENCY_MISMATCH.authorizationCurrency, "INR");
  assert.equal(syntheticDeskVerdictVariants.CANNOT_EVALUATE.observedAmountMinor, null);
});

test("the desk is read-only, synthetic, versioned, and unable to reach the network", () => {
  const brief = syntheticDeskBrief();
  assert.deepEqual(brief.capabilities, {
    canSubmitProposal: false,
    canDecide: false,
    canConfigurePolicy: false,
  });
  assert.equal(syntheticDeskIdentity.synthetic, true);
  assert.equal(syntheticDeskIdentity.fixtureId, "SYNTHETIC_CC_DESK_V1");
  assert.match(syntheticDeskIdentity.sourceHash, /^[0-9a-f]{8}$/);
  assert.doesNotMatch(deskSource, /\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon/);

  for (const entry of brief.proposals) {
    for (const value of [entry.proposal.id, entry.proposal.submittedByUserId, entry.evaluation?.id]) {
      assert.ok(String(value).startsWith(SYNTHETIC_DEMO_UUID_NAMESPACE), `${value} must be a synthetic id`);
    }
    assert.match(entry.proposal.merchant, /placeholder/i);
  }
});

test("the queue groups cover every state exactly once and lead with work", () => {
  const grouped = deskQueueGroups.flatMap((group) => group.states);
  assert.deepEqual([...grouped].sort(), [...deskQueueStates].sort());
  assert.equal(grouped.length, new Set(grouped).size);
  assert.equal(syntheticDeskRecord(syntheticDeskLeadKey).queueState, "DECIDE_NOW");
  assert.equal(syntheticDeskRecords[0].key, syntheticDeskLeadKey, "the record needing a decision comes first");
});
