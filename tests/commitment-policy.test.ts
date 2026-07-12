import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCommitment,
  getCommitmentPolicy,
  isCommitmentActionAllowed,
  listCommitmentPolicies,
  type CommitmentClass,
} from "../src/lib/commitment-policy";
import { analyzeStatements } from "../src/lib/recurring-audit";

const today = new Date(2026, 6, 10);

test("maps financial categories into all seven commitment classes", () => {
  const cases: Array<[string, CommitmentClass]> = [
    ["AI tools", "discretionary-subscription"],
    ["Streaming", "discretionary-subscription"],
    ["Cloud hosting", "usage-based-cloud"],
    ["API usage", "usage-based-cloud"],
    ["Debt", "debt-emi"],
    ["Loan repayment", "debt-emi"],
    ["Insurance", "insurance"],
    ["Investments", "investment-sip"],
    ["SIP", "investment-sip"],
    ["Utilities", "utility"],
    ["Telecom", "utility"],
    ["Domains", "contractual-other"],
    ["Unclassified", "contractual-other"],
  ];

  for (const [category, expected] of cases) assert.equal(classifyCommitment(category), expected, category);
  assert.equal(listCommitmentPolicies().length, 7);
});

test("protected financial classes never allow generic cancel or downgrade actions", () => {
  for (const category of ["Cloud hosting", "Debt", "Insurance", "Investments", "Utilities", "Other"]) {
    const policy = getCommitmentPolicy(category);
    assert.equal(isCommitmentActionAllowed(category, "cancel"), false, category);
    assert.equal(isCommitmentActionAllowed(category, "downgrade"), false, category);
    assert.ok(policy.consequenceWarning.length > 30, `${category} needs an explicit consequence warning`);
    assert.ok(policy.terminology.recurringAmount.length > 0);
    assert.ok(policy.safeActions.includes("keep"));
    assert.ok(policy.safeActions.includes("investigate"));
  }

  assert.equal(isCommitmentActionAllowed("AI tools", "cancel"), true);
  assert.equal(isCommitmentActionAllowed("AI tools", "downgrade"), true);
});

test("high-cost protected commitments receive class-safe review language", () => {
  const cases = [
    {
      description: "HDFC LOAN EMI AUTOPAY",
      amount: 50_000,
      category: "Debt",
      reason: /lender|repayment|auto-debit/i,
      riskTag: /repayment obligation/i,
    },
    {
      description: "LIC INSURANCE POLICY PREMIUM",
      amount: 18_000,
      category: "Insurance",
      reason: /coverage|lapse|premium/i,
      riskTag: /coverage continuity/i,
    },
    {
      description: "ZERODHA SIP MUTUAL FUND",
      amount: 30_000,
      category: "Investments",
      reason: /investment contribution|liquidity|adviser/i,
      riskTag: /not burn/i,
    },
    {
      description: "AIRTEL POSTPAID UTILITY BILL",
      amount: 5_000,
      category: "Utilities",
      reason: /usage|tariff|continuity|essential/i,
      riskTag: /essential-service continuity/i,
    },
    {
      description: "AWS CLOUD INFRASTRUCTURE USAGE",
      amount: 25_000,
      category: "Cloud hosting",
      reason: /utilization|rightsize|outages|data loss/i,
      riskTag: /usage-based cost/i,
    },
  ];

  for (const fixture of cases) {
    const item = auditOne(fixture.description, fixture.amount);
    assert.equal(item.category, fixture.category, fixture.description);
    assert.equal(["cancel", "downgrade"].includes(item.recommendationType), false, fixture.description);
    assert.equal(item.recommendationType, "watch", `${fixture.category} is high enough for a safe review`);
    assert.doesNotMatch(item.recommendationReason, /\b(?:cancel|downgrade|monthly burn|actively used)\b/i);
    assert.match(item.recommendationReason, fixture.reason);
    assert.ok(item.riskTags.some((tag) => fixture.riskTag.test(tag)), `${fixture.category}: ${item.riskTags.join(", ")}`);
  }
});

test("high-cost discretionary SaaS keeps the existing downgrade recommendation", () => {
  const item = auditOne("OPENAI CHATGPT TEAM", 5_000);
  assert.equal(item.category, "AI tools");
  assert.equal(item.recommendationType, "downgrade");
  assert.match(item.recommendationReason, /High recurring builder spend/i);
  assert.match(item.recommendationReason, /downgrade idle seats/i);
});

test("a protected price increase uses its own financial terminology", () => {
  const audit = analyzeStatements([{
    name: "insurance.csv",
    text: statement([
      "2026-03-05,LIC INSURANCE POLICY PREMIUM,5000,",
      "2026-04-05,LIC INSURANCE POLICY PREMIUM,5000,",
      "2026-05-05,LIC INSURANCE POLICY PREMIUM,5000,",
      "2026-06-05,LIC INSURANCE POLICY PREMIUM,6500,",
    ]),
  }], [], { today });

  const item = audit.recurringItems[0];
  assert.equal(item.recommendationType, "watch");
  assert.match(item.recommendationReason, /premium.*higher/i);
  assert.match(item.recommendationReason, /coverage|lapse/i);
  assert.doesNotMatch(item.recommendationReason, /plan change.*renewal/i);
});

function auditOne(description: string, amount: number) {
  const audit = analyzeStatements([{
    name: "policy.csv",
    text: statement([
      `2026-04-05,${description},${amount},`,
      `2026-05-05,${description},${amount},`,
      `2026-06-05,${description},${amount},`,
    ]),
  }], [], { today });

  const item = audit.recurringItems[0];
  assert.ok(item, `expected a recurring item for ${description}`);
  return item;
}

function statement(rows: string[]) {
  return ["Date,Description,Debit,Credit", ...rows].join("\n");
}
