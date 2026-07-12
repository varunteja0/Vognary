import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceDateByFrequency,
  analyzeStatements,
  applyMergeDecisionsToAudit,
  findDuplicateCandidates,
  makePairKey,
  type ManualRecurringInput,
} from "../src/lib/recurring-audit";

const today = new Date(2026, 6, 10); // 2026-07-10

function csv(rows: string[]): string {
  return ["Date,Description,Debit,Credit", ...rows].join("\n");
}

test("detects a monthly subscription with anchored next debit", () => {
  const audit = analyzeStatements(
    [{
      name: "statement.csv",
      text: csv([
        "2026-04-06,OPENAI CHATGPT PLUS,1999,",
        "2026-05-06,OPENAI CHATGPT PLUS,1999,",
        "2026-06-06,OPENAI CHATGPT PLUS,1999,",
        "2026-07-06,OPENAI CHATGPT PLUS,1999,",
      ]),
    }],
    [],
    { today },
  );

  assert.equal(audit.recurringItems.length, 1);
  const item = audit.recurringItems[0];
  assert.equal(item.merchant, "OpenAI");
  assert.equal(item.frequency, "monthly");
  assert.equal(item.nextExpectedDate, "2026-08-06", "monthly cadence should stay anchored to the 6th");
  assert.equal(item.missedCycles, 0);
  assert.ok(item.confidenceScore >= 65);
  assert.equal(audit.summary.recurringCount, 1);
});

test("merges receipt/manual evidence into the matching statement item instead of double counting", () => {
  const manualItems: ManualRecurringInput[] = [{
    id: "receipt-1",
    merchant: "OpenAI",
    amount: 1999,
    frequency: "monthly",
    nextExpectedDate: "2026-08-10",
    category: "AI tools",
    sourceName: "Gmail receipt sync",
  }];

  const audit = analyzeStatements(
    [{
      name: "statement.csv",
      text: csv([
        "2026-05-06,OPENAI CHATGPT PLUS,1999,",
        "2026-06-06,OPENAI CHATGPT PLUS,1999,",
        "2026-07-06,OPENAI CHATGPT PLUS,1999,",
      ]),
    }],
    manualItems,
    { today },
  );

  assert.equal(audit.recurringItems.length, 1, "same commitment from two sources must merge into one item");
  const item = audit.recurringItems[0];
  assert.deepEqual([...item.sourceNames].sort(), ["Gmail receipt sync", "statement.csv"]);
  assert.ok(item.riskTags.includes("multi-source verified"));
  assert.equal(item.evidence.length, 4, "merged item keeps every proof row");
  assert.equal(item.nextExpectedDate, "2026-08-06", "earliest future date wins after merge");
  assert.ok(Math.abs(audit.summary.monthlyRecurringSpend - 1999) < 1, "summary must not double count merged evidence");
});

test("does not merge same merchant when amounts are incompatible", () => {
  const manualItems: ManualRecurringInput[] = [{
    id: "api-usage",
    merchant: "OpenAI",
    amount: 12000,
    frequency: "monthly",
    nextExpectedDate: "2026-08-01",
    category: "AI tools",
    sourceName: "OpenAI dashboard",
  }];

  const audit = analyzeStatements(
    [{
      name: "statement.csv",
      text: csv([
        "2026-05-06,OPENAI CHATGPT PLUS,1999,",
        "2026-06-06,OPENAI CHATGPT PLUS,1999,",
        "2026-07-06,OPENAI CHATGPT PLUS,1999,",
      ]),
    }],
    manualItems,
    { today },
  );

  assert.equal(audit.recurringItems.length, 2, "a 6x amount difference is a different commitment");
});

test("surfaces single-occurrence annual commitments as investigate candidates", () => {
  const audit = analyzeStatements(
    [{
      name: "statement.csv",
      text: csv([
        "2026-04-10,INSURANCE POLICY PREMIUM,4200,",
        "2026-01-10,CLOUDFLARE DOMAIN RENEWAL,1200,",
      ]),
    }],
    [],
    { today },
  );

  const insurance = audit.recurringItems.find((item) => item.category === "Insurance");
  const domain = audit.recurringItems.find((item) => item.category === "Domains");

  assert.ok(insurance, "annual insurance seen once must not vanish");
  assert.equal(insurance?.frequency, "yearly");
  assert.equal(insurance?.recommendationType, "investigate");
  assert.ok(insurance?.riskTags.includes("single occurrence"));
  assert.equal(insurance?.nextExpectedDate, "2027-04-10");

  assert.ok(domain, "domain renewal seen once must not vanish");
  assert.equal(domain?.frequency, "yearly");
});

test("ignores single-occurrence rows without recurring semantics", () => {
  const audit = analyzeStatements(
    [{
      name: "statement.csv",
      text: csv([
        "2026-06-01,SWIGGY ORDER 88213,450,",
        "2026-06-14,AMAZON RETAIL 71D22,2300,",
      ]),
    }],
    [],
    { today },
  );

  assert.equal(audit.recurringItems.length, 0, "one-off purchases are not recurring candidates");
});

test("rolls stale next-debit dates forward and tags the evidence gap", () => {
  const audit = analyzeStatements(
    [{
      name: "old-statement.csv",
      text: csv([
        "2026-01-05,NETFLIX PREMIUM,649,",
        "2026-02-05,NETFLIX PREMIUM,649,",
        "2026-03-05,NETFLIX PREMIUM,649,",
      ]),
    }],
    [],
    { today },
  );

  const item = audit.recurringItems[0];
  assert.ok(item, "recurring item expected");
  assert.ok(new Date(item.nextExpectedDate) >= today, "next expected date must never sit in the past");
  assert.equal(item.nextExpectedDate, "2026-08-05");
  assert.ok(item.missedCycles >= 2);
  assert.ok(item.riskTags.some((tag) => tag.startsWith("stale evidence since")), `expected stale tag, got ${item.riskTags.join(", ")}`);
});

test("detects a price increase after a stable run and escalates keep to watch", () => {
  const audit = analyzeStatements(
    [{
      name: "statement.csv",
      text: csv([
        "2026-03-02,SPOTIFY PREMIUM,119,",
        "2026-04-02,SPOTIFY PREMIUM,119,",
        "2026-05-02,SPOTIFY PREMIUM,119,",
        "2026-06-02,SPOTIFY PREMIUM,199,",
      ]),
    }],
    [],
    { today },
  );

  const item = audit.recurringItems[0];
  assert.ok(item.priceChange, "price change expected");
  assert.equal(item.priceChange?.direction, "increase");
  assert.equal(item.priceChange?.latestAmount, 199);
  assert.ok(item.riskTags.some((tag) => tag.startsWith("price increased")));
  assert.equal(item.recommendationType, "watch");
});

test("keeps variable usage bills out of price-change detection", () => {
  const audit = analyzeStatements(
    [{
      name: "statement.csv",
      text: csv([
        "2026-03-02,AWS CLOUD BILL,2100,",
        "2026-04-02,AWS CLOUD BILL,3400,",
        "2026-05-02,AWS CLOUD BILL,2650,",
        "2026-06-02,AWS CLOUD BILL,4100,",
      ]),
    }],
    [],
    { today },
  );

  const item = audit.recurringItems[0];
  assert.equal(item.priceChange, null, "fluctuating usage bills are not plan-price changes");
});

test("parses Debit/Credit split columns and skips credits", () => {
  const audit = analyzeStatements(
    [{
      name: "statement.csv",
      text: csv([
        "2026-05-01,SALARY CREDIT,,95000",
        "2026-05-06,OPENAI CHATGPT,1999,",
        "2026-06-06,OPENAI CHATGPT,1999,",
      ]),
    }],
    [],
    { today },
  );

  assert.equal(audit.transactions.length, 2, "credit rows are excluded from debit analysis");
  assert.equal(audit.recurringItems.length, 1);
});

test("merchant normalization keeps words intact when stripping payment noise", () => {
  const audit = analyzeStatements(
    [{
      name: "statement.csv",
      text: csv([
        "2026-05-03,UPI AUTOPAY SIMPLILEARN COURSE,999,",
        "2026-06-03,UPI AUTOPAY SIMPLILEARN COURSE,999,",
      ]),
    }],
    [],
    { today },
  );

  const item = audit.recurringItems[0];
  assert.ok(item, "recurring item expected");
  assert.match(item.merchant, /Simplilearn/i, `payment-rail words must strip on word boundaries, got "${item.merchant}"`);
});

test("merges duplicate manual/receipt inputs for the same commitment", () => {
  const manualItems: ManualRecurringInput[] = [
    {
      id: "gmail-1",
      merchant: "OpenAI",
      amount: 1999,
      frequency: "monthly",
      nextExpectedDate: "2026-08-06",
      category: "AI tools",
      sourceName: "Gmail receipt sync",
    },
    {
      id: "paste-1",
      merchant: "OpenAI",
      amount: 1999,
      frequency: "monthly",
      nextExpectedDate: "2026-08-06",
      category: "AI tools",
      sourceName: "Pasted receipt snippet",
    },
  ];

  const audit = analyzeStatements([], manualItems, { today });

  assert.equal(audit.recurringItems.length, 1, "identical evidence from two capture paths is one commitment");
  assert.ok(Math.abs(audit.summary.monthlyRecurringSpend - 1999) < 1);
  assert.deepEqual([...audit.recurringItems[0].sourceNames].sort(), ["Gmail receipt sync", "Pasted receipt snippet"]);
});

test("manual items with past renewal dates roll forward", () => {
  const audit = analyzeStatements(
    [],
    [{
      id: "m1",
      merchant: "Google Play subscription",
      amount: 299,
      frequency: "monthly",
      nextExpectedDate: "2026-05-12",
      category: "App store",
      sourceName: "Google Play subscription screen",
    }],
    { today },
  );

  const item = audit.recurringItems[0];
  assert.equal(item.nextExpectedDate, "2026-07-12");
  assert.ok(item.riskTags.includes("renewal date passed; confirm status"));
});

test("surfaces same-merchant different-amount pairs as duplicate candidates", () => {
  const manualItems: ManualRecurringInput[] = [{
    id: "api-usage",
    merchant: "OpenAI",
    amount: 12000,
    frequency: "monthly",
    nextExpectedDate: "2026-08-01",
    category: "AI tools",
    sourceName: "OpenAI dashboard",
  }];

  const audit = analyzeStatements(
    [{
      name: "statement.csv",
      text: ["Date,Description,Debit,Credit",
        "2026-05-06,OPENAI CHATGPT PLUS,1999,",
        "2026-06-06,OPENAI CHATGPT PLUS,1999,",
        "2026-07-06,OPENAI CHATGPT PLUS,1999,",
      ].join("\n"),
    }],
    manualItems,
    { today },
  );

  assert.equal(audit.recurringItems.length, 2, "amount gate keeps them separate");
  const candidates = findDuplicateCandidates(audit.recurringItems);
  assert.equal(candidates.length, 1);
  assert.match(candidates[0].reason, /Same merchant/);

  const separated = findDuplicateCandidates(audit.recurringItems, { [candidates[0].pairKey]: "separate" });
  assert.equal(separated.length, 0, "decided pairs are not asked again");
});

test("applyMergeDecisionsToAudit combines confirmed pairs and recomputes totals", () => {
  const manualItems: ManualRecurringInput[] = [{
    id: "api-usage",
    merchant: "OpenAI",
    amount: 2400,
    frequency: "monthly",
    nextExpectedDate: "2026-08-01",
    category: "AI tools",
    sourceName: "OpenAI dashboard",
  }];

  const audit = analyzeStatements(
    [{
      name: "statement.csv",
      text: ["Date,Description,Debit,Credit",
        "2026-05-06,OPENAI CHATGPT PLUS,1799,",
        "2026-06-06,OPENAI CHATGPT PLUS,1799,",
        "2026-07-06,OPENAI CHATGPT PLUS,1799,",
      ].join("\n"),
    }],
    manualItems,
    { today },
  );
  assert.equal(audit.recurringItems.length, 2, "25%+ apart stays unmerged automatically");

  const pairKey = makePairKey(audit.recurringItems[0].identityKey, audit.recurringItems[1].identityKey);
  assert.equal(pairKey, findDuplicateCandidates(audit.recurringItems)[0]?.pairKey, "merge decisions use stable commitment identities");
  const merged = applyMergeDecisionsToAudit(audit, { [pairKey]: "merge" }, { today });

  assert.equal(merged.recurringItems.length, 1);
  const item = merged.recurringItems[0];
  assert.ok(item.riskTags.includes("user-confirmed same commitment"));
  assert.equal(item.evidence.length, 4);
  assert.ok(merged.summary.monthlyRecurringSpend < audit.summary.monthlyRecurringSpend, "summary recomputes after merge");
  assert.deepEqual(applyMergeDecisionsToAudit(audit, {}), audit, "no decisions returns the audit unchanged");
});

test("advanceDateByFrequency clamps month-end anchors", () => {
  const jan31 = new Date(2026, 0, 31);
  const feb = advanceDateByFrequency(jan31, "monthly", 30.44, 31);
  assert.equal(feb.getMonth(), 1, "advances into February");
  assert.equal(feb.getDate(), 28, "clamps to the last day of February");

  const mar = advanceDateByFrequency(feb, "monthly", 30.44, 31);
  assert.equal(mar.getDate(), 31, "restores the anchor day when the month allows it");
});
