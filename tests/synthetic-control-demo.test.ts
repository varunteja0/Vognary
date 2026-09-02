import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isCommitmentControlBriefDto } from "../src/lib/commitment-control/contracts";
import {
  SYNTHETIC_DEMO_LABEL,
  SYNTHETIC_DEMO_UUID_NAMESPACE,
  syntheticControlBrief,
  syntheticDemoBranchLabels,
  syntheticDemoBranchOrder,
  syntheticDemoObservedMinor,
} from "../src/lib/synthetic-control-demo";

const fixtureSource = readFileSync("src/lib/synthetic-control-demo.ts", "utf8");
const demoClient = readFileSync("src/app/demo/demo-client.tsx", "utf8");

test("the synthetic brief satisfies the real Commitment Control contract at every stage", () => {
  for (const branch of syntheticDemoBranchOrder) {
    for (const stage of ["PROPOSED", "DECIDED", "RECONCILED"] as const) {
      const brief = syntheticControlBrief(stage, branch);
      assert.ok(
        isCommitmentControlBriefDto(brief),
        `${stage}/${branch} must be a real brief so the live components render it unchanged`,
      );
    }
  }
});

test("the demonstration is read-only: no stage exposes a writable capability", () => {
  for (const branch of syntheticDemoBranchOrder) {
    for (const stage of ["PROPOSED", "DECIDED", "RECONCILED"] as const) {
      const { capabilities } = syntheticControlBrief(stage, branch);
      assert.deepEqual(capabilities, { canSubmitProposal: false, canDecide: false, canConfigurePolicy: false });
    }
  }
});

test("policy annotates and stops; only the decision stage carries a human", () => {
  const proposed = syntheticControlBrief("PROPOSED").proposals[0];
  assert.equal(proposed.decision, null, "a proposal with no decision is still an assumption");
  assert.ok(proposed.evaluation, "policy context exists before any decision");
  assert.equal(proposed.evaluation?.humanDecisionRequired, true);
  assert.equal(proposed.proposal.assumptionBasis, "USER_ENTERED_ASSUMPTION");

  const decided = syntheticControlBrief("DECIDED").proposals[0];
  assert.ok(decided.decision?.decidedByDisplayName, "a decision names the human who took it");
  assert.deepEqual(decided.reconciliations, [], "no outcome exists until later evidence arrives");
});

test("the frozen cap never moves when the observed outcome arrives", () => {
  for (const branch of ["APPROVE", "APPROVE_WITH_CAP"] as const) {
    const decided = syntheticControlBrief("DECIDED", branch).proposals[0];
    const reconciled = syntheticControlBrief("RECONCILED", branch).proposals[0];
    assert.equal(reconciled.decision?.approvedCapMinor, decided.decision?.approvedCapMinor);
    assert.equal(reconciled.decision?.expectedAmountMinor, decided.decision?.expectedAmountMinor);

    const outcome = reconciled.reconciliations[0];
    assert.equal(outcome.approvedCapMinor, decided.decision?.approvedCapMinor);
    assert.equal(outcome.observedAmountMinor, syntheticDemoObservedMinor);
    // One currency throughout. Nothing is converted or summed across currencies.
    assert.equal(outcome.observedCurrency, outcome.authorizationCurrency);
    assert.equal(outcome.verdict, "OVER_CAP");
  }
});

test("a declined proposal creates no cap and no comparison", () => {
  const declined = syntheticControlBrief("RECONCILED", "DECLINE").proposals[0];
  assert.equal(declined.decision?.action, "DECLINE");
  assert.equal(declined.decision?.approvedCapMinor, null);
  // Nothing was authorized, so there is nothing for later evidence to be
  // measured against. The refusal is the whole record.
  assert.deepEqual(declined.reconciliations, []);
});

test("the three branches are distinct decisions, not three labels for one outcome", () => {
  const caps = syntheticDemoBranchOrder.map(
    (branch) => syntheticControlBrief("DECIDED", branch).proposals[0].decision?.approvedCapMinor ?? "none",
  );
  assert.equal(new Set(caps).size, syntheticDemoBranchOrder.length);
  assert.equal(Object.keys(syntheticDemoBranchLabels).length, syntheticDemoBranchOrder.length);
});

test("nothing in the demonstration can be mistaken for a customer or reach the network", () => {
  assert.doesNotMatch(fixtureSource, /\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon/);
  assert.doesNotMatch(demoClient, /\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon/);
  // Every identity sits in one recognizable synthetic namespace.
  const brief = syntheticControlBrief("RECONCILED");
  const entry = brief.proposals[0];
  for (const id of [
    entry.proposal.id,
    entry.proposal.submittedByUserId,
    entry.evaluation?.id,
    entry.decision?.id,
    entry.decision?.decidedByUserId,
    entry.reconciliations[0]?.id,
    entry.reconciliations[0]?.evidenceId,
    ...(entry.evaluation?.citedEvidenceIds ?? []),
  ]) {
    assert.ok(String(id).startsWith(SYNTHETIC_DEMO_UUID_NAMESPACE), `${id} must be a synthetic id`);
  }
  assert.match(entry.proposal.merchant, /placeholder/i);
  assert.match(String(entry.decision?.decidedByDisplayName), /placeholder/i);
  assert.equal(SYNTHETIC_DEMO_LABEL, "Synthetic demonstration");
  assert.match(demoClient, /SYNTHETIC_DEMO_LABEL/);
});

test("exact money stays in minor units and is never recomputed for display", () => {
  const entry = syntheticControlBrief("RECONCILED").proposals[0];
  for (const value of [
    entry.proposal.amountMinor,
    entry.proposal.projectedThirteenWeekMinor,
    entry.proposal.projectedAnnualMinor,
    entry.decision?.approvedCapMinor,
    entry.decision?.expectedAmountMinor,
    entry.reconciliations[0].observedAmountMinor,
  ]) {
    assert.match(String(value), /^\d+$/, "minor units are exact integer strings, never floats");
  }
  assert.doesNotMatch(fixtureSource, /parseFloat|Number\(|\/\s*100\b/);
});
