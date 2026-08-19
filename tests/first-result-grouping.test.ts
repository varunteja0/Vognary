import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHomeProjection,
  type CanonicalCommitmentRecord,
} from "../src/lib/recovery/domain";
import {
  DUPLICATE_AMBIGUITY_REASON,
  IDENTITY_UNCERTAIN_REASON,
  KEEP_BASELINE_REASON,
  decideRelationshipMerge,
  extractAccountKey,
  extractProductKey,
  relationshipIdentityHint,
  type RelationshipSnapshot,
} from "../src/lib/recovery/commitment-relationship";
import { analyzeStatements, type ManualRecurringInput } from "../src/lib/recurring-audit";

const today = new Date("2026-08-19T10:00:00.000Z");

function receipt(input: {
  id: string;
  merchant: string;
  amount: number;
  nextExpectedDate: string;
  observedDate?: string;
  category?: string;
  currency?: string;
  frequency?: ManualRecurringInput["frequency"];
  evidenceDescription?: string;
  sourceName?: string;
}): ManualRecurringInput {
  const currency = input.currency ?? "INR";
  return {
    id: input.id,
    merchant: input.merchant,
    amount: input.amount,
    amountDecimal: input.amount.toFixed(2),
    currency,
    frequency: input.frequency ?? "monthly",
    nextExpectedDate: input.nextExpectedDate,
    observedDate: input.observedDate,
    category: input.category ?? "AI tools",
    sourceName: input.sourceName ?? `${input.id} receipt`,
    evidenceDescription: input.evidenceDescription
      ?? `${input.merchant} charged ${currency} ${input.amount.toFixed(2)} on ${input.observedDate ?? input.nextExpectedDate}. Renews monthly.`,
  };
}

function snapshot(partial: Partial<RelationshipSnapshot> & Pick<RelationshipSnapshot, "normalizedMerchant" | "lastChargeDate" | "averageAmount">): RelationshipSnapshot {
  return {
    merchant: partial.merchant ?? partial.normalizedMerchant,
    currency: partial.currency ?? "INR",
    frequency: partial.frequency ?? "monthly",
    evidenceDates: partial.evidenceDates ?? [partial.lastChargeDate],
    evidenceTexts: partial.evidenceTexts ?? [partial.merchant ?? partial.normalizedMerchant],
    ...partial,
  };
}

test("A: OpenAI August and September receipts collapse to one commitment", () => {
  const audit = analyzeStatements([], [
    receipt({ id: "openai-aug", merchant: "OpenAI", amount: 1999, observedDate: "2026-08-06", nextExpectedDate: "2026-09-06" }),
    receipt({ id: "openai-sep", merchant: "OpenAI", amount: 1999, observedDate: "2026-09-06", nextExpectedDate: "2026-10-06" }),
  ], { today });

  assert.equal(audit.recurringItems.length, 1);
  assert.equal(audit.recurringItems[0]?.normalizedMerchant, "OpenAI");
  assert.equal(audit.recurringItems[0]?.evidence.length, 2);
  assert.equal(audit.recurringItems[0]?.recommendationType, "keep");
  assert.equal(audit.recurringItems[0]?.recommendationReason, KEEP_BASELINE_REASON);
  assert.ok(Math.abs(audit.summary.monthlyRecurringSpend - 1999) < 1);
});

test("B: Notion August and September receipts collapse to one commitment", () => {
  const audit = analyzeStatements([], [
    receipt({
      id: "notion-aug",
      merchant: "Notion",
      amount: 830,
      category: "Other",
      observedDate: "2026-08-01",
      nextExpectedDate: "2026-09-01",
    }),
    receipt({
      id: "notion-sep",
      merchant: "Notion",
      amount: 830,
      category: "Other",
      observedDate: "2026-09-01",
      nextExpectedDate: "2026-10-01",
    }),
  ], { today });

  assert.equal(audit.recurringItems.length, 1);
  assert.equal(audit.recurringItems[0]?.normalizedMerchant, "Notion");
  assert.equal(audit.recurringItems[0]?.evidence.length, 2);
  assert.equal(audit.recurringItems[0]?.recommendationType, "keep");
});

test("A+B: OpenAI plus Notion is two commitments, not four, and totals do not inflate", () => {
  const audit = analyzeStatements([], [
    receipt({ id: "openai-aug", merchant: "OpenAI", amount: 1999, observedDate: "2026-07-06", nextExpectedDate: "2026-08-06" }),
    receipt({ id: "openai-sep", merchant: "OpenAI", amount: 1999, observedDate: "2026-08-06", nextExpectedDate: "2026-09-06" }),
    receipt({ id: "notion-aug", merchant: "Notion", amount: 830, category: "Other", observedDate: "2026-07-01", nextExpectedDate: "2026-08-01" }),
    receipt({ id: "notion-sep", merchant: "Notion", amount: 830, category: "Other", observedDate: "2026-08-01", nextExpectedDate: "2026-09-01" }),
  ], { today });

  assert.equal(audit.recurringItems.length, 2);
  const merchants = audit.recurringItems.map((item) => item.normalizedMerchant).sort();
  assert.deepEqual(merchants, ["Notion", "OpenAI"]);
  assert.equal(audit.recurringItems.every((item) => item.recommendationType === "keep"), true);
  assert.ok(Math.abs(audit.summary.monthlyRecurringSpend - 2829) < 1);
});

test("C: same vendor with different workspace identifiers stays two commitments", () => {
  const audit = analyzeStatements([], [
    receipt({
      id: "openai-acme",
      merchant: "OpenAI",
      amount: 1999,
      observedDate: "2026-08-06",
      nextExpectedDate: "2026-09-06",
      evidenceDescription: "OpenAI ChatGPT Plus. Workspace: acme-eng. Charged INR 1999.00 on 2026-08-06. Renews monthly.",
    }),
    receipt({
      id: "openai-north",
      merchant: "OpenAI",
      amount: 1999,
      observedDate: "2026-08-06",
      nextExpectedDate: "2026-09-06",
      evidenceDescription: "OpenAI ChatGPT Plus. Workspace: northstar. Charged INR 1999.00 on 2026-08-06. Renews monthly.",
    }),
  ], { today });

  assert.equal(audit.recurringItems.length, 2);
  assert.equal(extractAccountKey("Workspace: acme-eng"), "acme-eng");
  assert.equal(extractAccountKey("Workspace: northstar"), "northstar");
});

test("D: same vendor with different evidenced products stays two commitments", () => {
  const audit = analyzeStatements([], [
    receipt({
      id: "plus",
      merchant: "OpenAI ChatGPT Plus",
      amount: 1999,
      observedDate: "2026-08-06",
      nextExpectedDate: "2026-09-06",
      evidenceDescription: "OpenAI ChatGPT Plus charged INR 1999.00 on 2026-08-06. Renews monthly.",
    }),
    receipt({
      id: "api",
      merchant: "OpenAI API usage",
      amount: 3200,
      observedDate: "2026-08-09",
      nextExpectedDate: "2026-09-09",
      evidenceDescription: "OpenAI API usage charged INR 3200.00 on 2026-08-09. Renews monthly.",
    }),
  ], { today });

  assert.equal(audit.recurringItems.length, 2);
  assert.equal(extractProductKey("OpenAI ChatGPT Plus"), "chatgpt-plus");
  assert.equal(extractProductKey("OpenAI API usage"), "openai-api");
});

test("E: cosmetic merchant-name variation still normalizes into one commitment", () => {
  const audit = analyzeStatements([], [
    receipt({ id: "inc", merchant: "OpenAI, Inc.", amount: 1999, observedDate: "2026-07-06", nextExpectedDate: "2026-08-06" }),
    receipt({ id: "plain", merchant: "OpenAI", amount: 1999, observedDate: "2026-08-06", nextExpectedDate: "2026-09-06" }),
  ], { today });

  assert.equal(audit.recurringItems.length, 1);
  assert.equal(audit.recurringItems[0]?.normalizedMerchant, "OpenAI");
});

test("F: genuinely ambiguous same-vendor bills are reviewed, not silently merged", () => {
  const audit = analyzeStatements([], [
    receipt({ id: "first", merchant: "OpenAI", amount: 1999, observedDate: "2026-08-06", nextExpectedDate: "2026-09-06" }),
    receipt({ id: "second", merchant: "OpenAI", amount: 1999, observedDate: "2026-08-08", nextExpectedDate: "2026-09-08" }),
  ], { today });

  assert.equal(audit.recurringItems.length, 2);
  for (const item of audit.recurringItems) {
    assert.equal(item.recommendationType, "watch");
    assert.match(item.recommendationReason, /Identity is uncertain|Possible duplicate/i);
  }
});

test("G: replaying the same receipts does not materialize duplicate commitments", () => {
  const inputs = [
    receipt({ id: "openai-aug", merchant: "OpenAI", amount: 1999, observedDate: "2026-07-06", nextExpectedDate: "2026-08-06" }),
    receipt({ id: "openai-sep", merchant: "OpenAI", amount: 1999, observedDate: "2026-08-06", nextExpectedDate: "2026-09-06" }),
  ];
  const first = analyzeStatements([], inputs, { today });
  const second = analyzeStatements([], inputs, { today });
  assert.equal(first.recurringItems.length, 1);
  assert.equal(second.recurringItems.length, 1);
  assert.equal(first.recurringItems[0]?.identityKey, second.recurringItems[0]?.identityKey);
  assert.equal(first.recurringItems[0]?.evidence.length, 2);
});

test("a clean repeated receipt stays KEEP, not generic Review", () => {
  const audit = analyzeStatements([], [
    receipt({ id: "openai-aug", merchant: "OpenAI", amount: 1999, observedDate: "2026-07-06", nextExpectedDate: "2026-08-06" }),
    receipt({ id: "openai-sep", merchant: "OpenAI", amount: 1999, observedDate: "2026-08-06", nextExpectedDate: "2026-09-06" }),
  ], { today });
  const item = audit.recurringItems[0];
  assert.equal(item?.recommendationType, "keep");
  assert.doesNotMatch(item?.recommendationReason ?? "", /still actively used|Verify the source|Pattern is consistent/i);
});

test("a meaningful price increase is Review with an amount-change reason", () => {
  const audit = analyzeStatements([], [
    receipt({ id: "openai-aug", merchant: "OpenAI", amount: 1999, observedDate: "2026-07-06", nextExpectedDate: "2026-08-06" }),
    receipt({ id: "openai-sep", merchant: "OpenAI", amount: 2499, observedDate: "2026-08-06", nextExpectedDate: "2026-09-06" }),
  ], { today });
  assert.equal(audit.recurringItems.length, 1);
  const item = audit.recurringItems[0];
  assert.equal(item?.recommendationType, "watch");
  assert.match(item?.recommendationReason ?? "", /Price changed|higher than the earlier/i);
});

test("possible overlap is Review with an overlap reason", () => {
  const audit = analyzeStatements([], [
    receipt({ id: "openai", merchant: "OpenAI", amount: 1999, observedDate: "2026-08-06", nextExpectedDate: "2026-09-06" }),
    receipt({
      id: "claude",
      merchant: "Anthropic",
      amount: 1800,
      observedDate: "2026-08-08",
      nextExpectedDate: "2026-09-08",
      evidenceDescription: "Anthropic Claude Pro charged INR 1800.00 on 2026-08-08. Renews monthly.",
    }),
  ], { today });
  assert.equal(audit.recurringItems.length, 2);
  for (const item of audit.recurringItems) {
    assert.equal(item.recommendationType, "watch");
    assert.match(item.recommendationReason, /Possible overlap/i);
  }
});

test("KEEP without a user decision stays off the attention queue", () => {
  const now = new Date("2026-08-19T10:00:00.000Z");
  const commitment: CanonicalCommitmentRecord = {
    id: "commitment-openai",
    version: 1,
    status: "ACTIVE",
    merchant: "OpenAI",
    category: "AI tools",
    cadence: "MONTHLY",
    currency: "INR",
    amountMinor: BigInt(199_900),
    monthlyEquivalentMinor: BigInt(199_900),
    nextExpectedDate: "2026-09-06",
    confidenceScore: 78,
    confidenceReasons: ["Two persisted observations support this commitment."],
    recommendedDecision: "KEEP",
    recommendationReason: KEEP_BASELINE_REASON,
    riskTags: [],
    decision: null,
    evidenceIds: ["evidence-1", "evidence-2"],
    factCorrections: [],
    updatedAt: now.toISOString(),
  };
  const home = buildHomeProjection({
    workspace: { id: "workspace-1", name: "Founder workspace", role: "owner", version: 1 },
    generatedAt: now,
    commitments: [commitment],
    sources: [],
    changed: { state: "NO_PRIOR_BASELINE", fromVersion: null, toVersion: 1, items: [] },
  });
  assert.equal(home.reviewItemCount, 0);
  assert.deepEqual(home.needsMe, []);
});

test("MONITOR with an explicit reason remains on the attention queue", () => {
  const now = new Date("2026-08-19T10:00:00.000Z");
  const home = buildHomeProjection({
    workspace: { id: "workspace-1", name: "Founder workspace", role: "owner", version: 1 },
    generatedAt: now,
    commitments: [{
      id: "commitment-openai",
      version: 1,
      status: "ACTIVE",
      merchant: "OpenAI",
      category: "AI tools",
      cadence: "MONTHLY",
      currency: "INR",
      amountMinor: BigInt(249_900),
      monthlyEquivalentMinor: BigInt(249_900),
      nextExpectedDate: "2026-09-06",
      confidenceScore: 78,
      confidenceReasons: ["Two persisted observations support this commitment."],
      recommendedDecision: "MONITOR",
      recommendationReason: "Price changed. The latest charge is about 25% higher than the earlier amount.",
      riskTags: ["price increased ~25%"],
      decision: null,
      evidenceIds: ["evidence-1", "evidence-2"],
      factCorrections: [],
      updatedAt: now.toISOString(),
    }],
    sources: [],
    changed: { state: "NO_PRIOR_BASELINE", fromVersion: null, toVersion: 1, items: [] },
  });
  assert.equal(home.reviewItemCount, 1);
  assert.equal(home.needsMe[0]?.detail.includes("Price changed"), true);
});

test("relationship policy splits conflicting workspaces and collapses sequential unlabeled bills", () => {
  const sequential = decideRelationshipMerge(
    snapshot({ normalizedMerchant: "OpenAI", lastChargeDate: "2026-07-06", averageAmount: 1999 }),
    snapshot({ normalizedMerchant: "OpenAI", lastChargeDate: "2026-08-06", averageAmount: 1999 }),
  );
  assert.equal(sequential.action, "collapse");

  const workspaces = decideRelationshipMerge(
    snapshot({
      normalizedMerchant: "OpenAI",
      lastChargeDate: "2026-08-06",
      averageAmount: 1999,
      evidenceTexts: ["OpenAI workspace: acme-eng"],
    }),
    snapshot({
      normalizedMerchant: "OpenAI",
      lastChargeDate: "2026-08-06",
      averageAmount: 1999,
      evidenceTexts: ["OpenAI workspace: northstar"],
    }),
  );
  assert.equal(workspaces.action, "split");

  const sameDayCopy = decideRelationshipMerge(
    snapshot({ normalizedMerchant: "OpenAI", lastChargeDate: "2026-08-06", averageAmount: 1999 }),
    snapshot({ normalizedMerchant: "OpenAI", lastChargeDate: "2026-08-06", averageAmount: 1999 }),
  );
  assert.equal(sameDayCopy.action, "collapse");

  const ambiguous = decideRelationshipMerge(
    snapshot({ normalizedMerchant: "OpenAI", lastChargeDate: "2026-08-06", averageAmount: 1999 }),
    snapshot({ normalizedMerchant: "OpenAI", lastChargeDate: "2026-08-08", averageAmount: 1999 }),
  );
  assert.equal(ambiguous.action, "ambiguous");
  assert.equal(ambiguous.reason, IDENTITY_UNCERTAIN_REASON);
  assert.equal(relationshipIdentityHint(snapshot({
    normalizedMerchant: "OpenAI",
    lastChargeDate: "2026-08-06",
    averageAmount: 1999,
  })), "rel|openai|INR|monthly|_|_");
  assert.equal(DUPLICATE_AMBIGUITY_REASON.includes("duplicate"), true);
});
