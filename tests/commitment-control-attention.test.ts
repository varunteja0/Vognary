import assert from "node:assert/strict";
import test from "node:test";

import { buildControlAttention, primaryControlAttention } from "../src/lib/commitment-control/attention";
import type { CommitmentControlBriefDto } from "../src/lib/commitment-control/contracts";
import { syntheticDeskRecord } from "../src/lib/synthetic-control-desk";

type ControlProposalEntry = CommitmentControlBriefDto["proposals"][number];

test("puts a proposal awaiting human authorization into attention without deciding it", () => {
  const entry = syntheticDeskRecord("model-api").entry;

  assert.deepEqual(
    buildControlAttention([entry], { today: "2026-08-25" }),
    [{
      id: `DECISION_REQUIRED:${entry.proposal.id}`,
      kind: "DECISION_REQUIRED",
      proposalId: entry.proposal.id,
      merchant: entry.proposal.merchant,
      headline: "Decision needed",
      body: "Review the cited exposure and policy result before the first charge.",
      urgency: "NOW",
      nextStep: "DECIDE_PROPOSAL",
      dueOn: entry.proposal.firstChargeDate,
    }],
  );
  assert.equal(entry.decision, null, "building attention must never manufacture a decision");
});

test("surfaces every due responsibility on an approved proposal without inventing evidence", () => {
  const approved = syntheticDeskRecord("observability").entry;

  const approaching = buildControlAttention([approved], { today: "2026-08-29" });
  assert.deepEqual(
    approaching.map(({ kind, urgency, nextStep, dueOn }) => ({ kind, urgency, nextStep, dueOn })),
    [
      { kind: "EVIDENCE_DUE", urgency: "NOW", nextStep: "LINK_EVIDENCE", dueOn: "2026-08-28" },
      { kind: "AUTHORIZATION_EXPIRING", urgency: "NOW", nextStep: "LINK_EVIDENCE", dueOn: "2026-09-05" },
      { kind: "OUTCOME_REVIEW_APPROACHING", urgency: "SOON", nextStep: "REVIEW_RECORD", dueOn: "2026-09-05" },
    ],
  );

  const overdue = buildControlAttention([approved], { today: "2026-09-06" });
  assert.deepEqual(
    overdue.map(({ kind, urgency, nextStep, dueOn }) => ({ kind, urgency, nextStep, dueOn })),
    [
      { kind: "EVIDENCE_DUE", urgency: "NOW", nextStep: "LINK_EVIDENCE", dueOn: "2026-08-28" },
      { kind: "AUTHORIZATION_EXPIRED", urgency: "NOW", nextStep: "REVIEW_RECORD", dueOn: "2026-09-05" },
      { kind: "OUTCOME_REVIEW_DUE", urgency: "NOW", nextStep: "RECORD_OUTCOME", dueOn: "2026-09-05" },
    ],
  );
  assert.deepEqual(approved.reconciliations, [], "attention must not manufacture observed evidence");
});

test("keeps adverse cost and user-entered outcome observations visible as separate exceptions", () => {
  const overCap = syntheticDeskRecord("vector-database").entry;
  const intendedOutcome = overCap.proposal.intendedOutcome;
  assert.ok(intendedOutcome);
  const latest = overCap.reconciliations[0];
  assert.ok(latest);

  const missed = {
    ...overCap,
    reconciliations: [{
      ...latest,
      outcome: {
        ...intendedOutcome,
        observedValue: "900",
        observedOn: intendedOutcome.reviewOn,
        observationBasis: "USER_ENTERED_OBSERVATION",
        verdict: "MISSED",
      },
    }],
  } satisfies ControlProposalEntry;

  const attention = buildControlAttention([missed], { today: "2026-08-24" });
  assert.deepEqual(
    attention.map(({ kind, nextStep }) => ({ kind, nextStep })),
    [
      { kind: "RECONCILIATION_EXCEPTION", nextStep: "REVIEW_EXCEPTION" },
      { kind: "OUTCOME_MISSED", nextStep: "REVIEW_EXCEPTION" },
    ],
  );
  assert.match(attention[1]?.body ?? "", /user-entered observation/i);
});

test("a later clean receipt cannot hide an earlier immutable cost exception", () => {
  const overCap = syntheticDeskRecord("vector-database").entry;
  const adverse = overCap.reconciliations[0];
  assert.ok(adverse);
  const laterMatched = {
    ...adverse,
    id: "e1000000-0000-4000-8000-000000000099",
    evidenceId: "f1000000-0000-4000-8000-000000000099",
    verdict: "MATCHED" as const,
    observedAmountMinor: adverse.expectedAmountMinor,
    reconciledAt: "2026-08-23T10:00:00.000Z",
  };

  const attention = buildControlAttention([{ ...overCap, reconciliations: [adverse, laterMatched] }], {
    today: "2026-08-24",
  });

  assert.ok(attention.some((item) => item.kind === "RECONCILIATION_EXCEPTION"));
});

test("an explicit disposition clears the targeted immutable exception from attention", () => {
  const overCap = syntheticDeskRecord("vector-database").entry;
  const adverse = overCap.reconciliations[0];
  assert.ok(adverse);
  const attention = buildControlAttention([{
    ...overCap,
    exceptionReviews: [{
      id: "0b000000-0000-4000-8000-000000000001",
      proposalId: overCap.proposal.id,
      decisionId: overCap.decision!.id,
      targetKind: "RECONCILIATION",
      targetId: adverse.id,
      disposition: "NO_FURTHER_ACTION",
      note: "The synthetic overage was reviewed and accepted.",
      reviewedByUserId: null,
      reviewedAt: "2026-08-24T11:00:00.000Z",
    }],
  }], { today: "2026-08-24" });

  assert.equal(attention.some((item) => item.targetId === adverse.id), false);
});

test("a standalone missed outcome stays actionable until an explicit disposition", () => {
  const approved = syntheticDeskRecord("observability").entry;
  const observation = {
    id: "0a000000-0000-4000-8000-000000000001",
    proposalId: approved.proposal.id,
    decisionId: approved.decision!.id,
    observedValue: "45",
    observedOn: approved.proposal.intendedOutcome!.reviewOn,
    target: approved.proposal.intendedOutcome!,
    observationBasis: "USER_ENTERED_OBSERVATION" as const,
    verdict: "MISSED" as const,
    observedByUserId: null,
    observedAt: "2026-09-05T10:00:00.000Z",
  };

  const open = buildControlAttention([{ ...approved, outcomeObservations: [observation] }], { today: "2026-09-06" });
  assert.deepEqual(open
    .filter((item) => item.kind === "OUTCOME_MISSED")
    .map((item) => ({
      kind: item.kind,
      nextStep: item.nextStep,
      targetKind: "targetKind" in item ? item.targetKind : undefined,
      targetId: "targetId" in item ? item.targetId : undefined,
    })), [{
    kind: "OUTCOME_MISSED",
    nextStep: "REVIEW_EXCEPTION",
    targetKind: "OUTCOME_OBSERVATION",
    targetId: observation.id,
  }]);

  const reviewed = buildControlAttention([{
    ...approved,
    outcomeObservations: [observation],
    exceptionReviews: [{
      id: "0b000000-0000-4000-8000-000000000002",
      proposalId: approved.proposal.id,
      decisionId: approved.decision!.id,
      targetKind: "OUTCOME_OBSERVATION",
      targetId: observation.id,
      disposition: "NEW_PROPOSAL_REQUIRED",
      note: "The target was missed; a fresh proposal is required.",
      reviewedByUserId: null,
      reviewedAt: "2026-09-06T10:00:00.000Z",
    }],
  }], { today: "2026-09-06" });
  assert.equal(reviewed.some((item) => item.targetId === observation.id), false);
});

test("keeps matched, met, and declined records quiet", () => {
  const matched = syntheticDeskRecord("security-assessment").entry;
  const intendedOutcome = matched.proposal.intendedOutcome;
  const latest = matched.reconciliations[0];
  assert.ok(intendedOutcome);
  assert.ok(latest);
  const met = {
    ...matched,
    reconciliations: [{
      ...latest,
      outcome: {
        ...intendedOutcome,
        observedValue: intendedOutcome.targetValue,
        observedOn: intendedOutcome.reviewOn,
        observationBasis: "USER_ENTERED_OBSERVATION",
        verdict: "MET",
      },
    }],
  } satisfies ControlProposalEntry;
  const declined = syntheticDeskRecord("launch-campaign").entry;

  assert.deepEqual(buildControlAttention([met, declined], { today: "2026-09-30" }), []);
});

test("orders attention by urgency and due date regardless of brief order", () => {
  const later = syntheticDeskRecord("cloud-failover").entry;
  const sooner = syntheticDeskRecord("model-api").entry;

  assert.deepEqual(
    buildControlAttention([later, sooner], { today: "2026-08-25" }).map((item) => item.proposalId),
    [sooner.proposal.id, later.proposal.id],
  );
  assert.throws(
    () => buildControlAttention([sooner], { today: "2026-02-30" }),
    /valid calendar date/i,
  );
});

test("chooses one highest-consequence notification per proposal while keeping every item in-app", () => {
  const approved = syntheticDeskRecord("observability").entry;
  const all = buildControlAttention([approved], { today: "2026-09-06" });

  assert.equal(all.length, 3);
  assert.deepEqual(primaryControlAttention(all).map((item) => item.kind), ["AUTHORIZATION_EXPIRED"]);
});