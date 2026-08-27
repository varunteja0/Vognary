import assert from "node:assert/strict";
import test from "node:test";
import type { CommitmentSummaryDto } from "../src/lib/recovery/contracts";
import {
  commitmentGroupKey,
  findGroupForCommitment,
  groupCommitments,
  groupDecisionState,
  groupNeedsAttention,
  representativeCommitment,
} from "../src/app/workspace/recovery/present/commitment-groups";

function summary(partial: Partial<CommitmentSummaryDto> & Pick<CommitmentSummaryDto, "id" | "merchant">): CommitmentSummaryDto {
  return {
    id: partial.id,
    version: partial.version ?? 1,
    status: partial.status ?? "ACTIVE",
    merchant: partial.merchant,
    category: partial.category ?? "Software",
    cadence: partial.cadence ?? "MONTHLY",
    amount: partial.amount ?? { currency: "INR", minor: "83000", exponent: 2, display: "₹830.00" },
    monthlyEquivalent: partial.monthlyEquivalent ?? { currency: "INR", minor: "83000", exponent: 2, display: "₹830.00" },
    nextExpectedDate: partial.nextExpectedDate ?? "2026-09-01",
    confidence: partial.confidence ?? { state: "HIGH", score: 90, scale: "PERCENT_0_100", reasons: [] },
    recommendedDecision: partial.recommendedDecision ?? "KEEP",
    decision: partial.decision ?? null,
    cycle: partial.cycle ?? null,
    evidenceCount: partial.evidenceCount ?? 1,
    updatedAt: partial.updatedAt ?? "2026-08-27T00:00:00.000Z",
  };
}

test("commitmentGroupKey groups by merchant, currency, and cadence", () => {
  const notion = summary({ id: "n1", merchant: "Notion" });
  const notionCopy = summary({ id: "n2", merchant: "  notion  " });
  const openAi = summary({ id: "o1", merchant: "OpenAI", amount: { currency: "INR", minor: "199900", exponent: 2, display: "₹1,999.00" }, monthlyEquivalent: { currency: "INR", minor: "199900", exponent: 2, display: "₹1,999.00" } });
  assert.equal(commitmentGroupKey(notion), commitmentGroupKey(notionCopy));
  assert.notEqual(commitmentGroupKey(notion), commitmentGroupKey(openAi));
});

test("groupCommitments collapses duplicate merchants into one group", () => {
  const groups = groupCommitments([
    summary({ id: "n1", merchant: "Notion", nextExpectedDate: "2026-09-01" }),
    summary({ id: "n2", merchant: "Notion", nextExpectedDate: "2026-08-01" }),
    summary({ id: "o1", merchant: "OpenAI", amount: { currency: "INR", minor: "199900", exponent: 2, display: "₹1,999.00" }, monthlyEquivalent: { currency: "INR", minor: "199900", exponent: 2, display: "₹1,999.00" } }),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups.find((group) => group.merchant === "Notion")?.commitments.length, 2);
  assert.equal(representativeCommitment(groups.find((group) => group.merchant === "Notion")!).id, "n1");
});

test("groupDecisionState prefers decision due over no decision yet", () => {
  const groups = groupCommitments([
    summary({ id: "n1", merchant: "Notion", decision: { value: "CANCEL", decidedAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z" }, cycle: { action: "PLAN_TO_CANCEL", dueDate: "2026-09-01", reviewAt: null } }),
    summary({ id: "n2", merchant: "Notion", nextExpectedDate: "2026-08-01" }),
  ]);
  const home = {
    decisionQueue: [{ commitmentId: "n2", merchant: "Notion", dueDate: "2026-08-06", daysAway: 3, charge: summary({ id: "n2", merchant: "Notion" }).amount, stake: null, headline: "", sentence: "", excerpt: null, citedEvidenceId: null, provisional: false, reasonKeys: [], reasons: [], overlapMerchants: [], askPurpose: false, evidenceIds: [] }],
  } as unknown as Parameters<typeof groupDecisionState>[1];
  const state = groupDecisionState(groups[0]!, home);
  assert.equal(state.label, "Decision due");
  assert.equal(state.tone, "due");
});

test("groupNeedsAttention is true when any charge in the group needs attention", () => {
  const groups = groupCommitments([
    summary({ id: "n1", merchant: "Notion", confidence: { state: "HIGH", score: 90, scale: "PERCENT_0_100", reasons: [] }, decision: { value: "KEEP", decidedAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z" } }),
    summary({ id: "n2", merchant: "Notion", confidence: { state: "LOW", score: 20, scale: "PERCENT_0_100", reasons: [] } }),
  ]);
  assert.equal(groupNeedsAttention(groups[0]!, new Set()), true);
});

test("findGroupForCommitment returns the owning group", () => {
  const groups = groupCommitments([
    summary({ id: "n1", merchant: "Notion" }),
    summary({ id: "o1", merchant: "OpenAI", amount: { currency: "INR", minor: "199900", exponent: 2, display: "₹1,999.00" }, monthlyEquivalent: { currency: "INR", minor: "199900", exponent: 2, display: "₹1,999.00" } }),
  ]);
  assert.equal(findGroupForCommitment(groups, "n1")?.merchant, "Notion");
});
