import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeStatements } from "../src/lib/recurring-audit";
import { buildVerifiedSavings } from "../src/lib/verified-savings";

const today = new Date(2026, 6, 10); // 2026-07-10

function csv(rows: string[]): string {
  return ["Date,Description,Debit,Credit", ...rows].join("\n");
}

// Netflix and OpenAI appear in one statement source. A caller may separately
// attest that this account-specific source continuously covers the statement
// period; unrelated rows alone are never treated as coverage.
const workspaceCsv = csv([
  "2026-01-05,NETFLIX PREMIUM,649,",
  "2026-02-05,NETFLIX PREMIUM,649,",
  "2026-03-05,NETFLIX PREMIUM,649,",
  "2026-01-06,OPENAI CHATGPT PLUS,1999,",
  "2026-02-06,OPENAI CHATGPT PLUS,1999,",
  "2026-03-06,OPENAI CHATGPT PLUS,1999,",
  "2026-04-06,OPENAI CHATGPT PLUS,1999,",
  "2026-05-06,OPENAI CHATGPT PLUS,1999,",
  "2026-06-06,OPENAI CHATGPT PLUS,1999,",
]);

test("verifies a cancel when expected debits pass inside covered evidence", () => {
  const audit = analyzeStatements([{ name: "s.csv", text: workspaceCsv }], [], { today });
  const netflix = audit.recurringItems.find((item) => item.merchant === "Netflix");
  assert.ok(netflix);

  const savings = buildVerifiedSavings(audit.recurringItems, {
    [netflix.identityKey]: { action: "cancel", decidedAt: "2026-03-20" },
  }, {
    today,
    coverageWindows: [{ source: "s.csv", startDate: "2026-01-01", endDate: "2026-06-30" }],
  });

  assert.equal(savings.entries.length, 1);
  const entry = savings.entries[0];
  assert.equal(entry.status, "verified");
  assert.ok(entry.cleanCycles >= 2, `expected >=2 clean cycles, got ${entry.cleanCycles}`);
  assert.ok(Math.abs(entry.monthlySaving - netflix.monthlyCost) < 1);
  assert.ok(savings.verifiedAnnual > 0);
});

test("stays watching when evidence does not cover the expected debit", () => {
  // Only Netflix exists, and its evidence stops in March — silence after that
  // is not proof, because nothing shows the account was even looked at.
  const audit = analyzeStatements([{
    name: "s.csv",
    text: csv([
      "2026-01-05,NETFLIX PREMIUM,649,",
      "2026-02-05,NETFLIX PREMIUM,649,",
      "2026-03-05,NETFLIX PREMIUM,649,",
    ]),
  }], [], { today });
  const netflix = audit.recurringItems[0];

  const savings = buildVerifiedSavings(audit.recurringItems, {
    [netflix.identityKey]: { action: "cancel", decidedAt: "2026-03-20" },
  }, { today });

  assert.equal(savings.entries[0].status, "watching");
  assert.match(savings.entries[0].detail, /Waiting for continuous evidence/);
  assert.equal(savings.verifiedAnnual, 0);
});

test("does not use coverage from an unrelated source to prove a cancellation", () => {
  const audit = analyzeStatements([{ name: "bank-a.csv", text: workspaceCsv }], [], { today });
  const netflix = audit.recurringItems.find((item) => item.merchant === "Netflix");
  assert.ok(netflix);

  const savings = buildVerifiedSavings(audit.recurringItems, {
    [netflix.identityKey]: { action: "cancel", decidedAt: "2026-03-20" },
  }, {
    today,
    coverageWindows: [{ source: "bank-b.csv", startDate: "2026-01-01", endDate: "2026-06-30" }],
  });

  assert.equal(savings.entries[0].status, "watching");
  assert.equal(savings.entries[0].cleanCycles, 0);
  assert.equal(savings.verifiedAnnual, 0);
});

test("requires continuous same-source coverage across the full debit window", () => {
  const audit = analyzeStatements([{ name: "s.csv", text: workspaceCsv }], [], { today });
  const netflix = audit.recurringItems.find((item) => item.merchant === "Netflix");
  assert.ok(netflix);

  const savings = buildVerifiedSavings(audit.recurringItems, {
    [netflix.identityKey]: { action: "cancel", decidedAt: "2026-03-20" },
  }, {
    today,
    // Starts on the expected April debit, so it does not cover the early side
    // of the grace window and cannot prove that cycle was clean.
    coverageWindows: [{ source: "s.csv", startDate: "2026-04-05", endDate: "2026-04-30" }],
  });

  assert.equal(savings.entries[0].status, "watching");
  assert.equal(savings.entries[0].cleanCycles, 0);
});

test("flags not-eliminated when the charge keeps appearing after the decision", () => {
  const audit = analyzeStatements([{ name: "s.csv", text: workspaceCsv }], [], { today });
  const openai = audit.recurringItems.find((item) => item.merchant === "OpenAI");
  assert.ok(openai);

  const savings = buildVerifiedSavings(audit.recurringItems, {
    [openai.identityKey]: { action: "cancel", decidedAt: "2026-03-20" },
  }, { today });

  assert.equal(savings.entries[0].status, "not-eliminated");
  assert.match(savings.entries[0].detail, /still active/i);
});

test("verifies a downgrade when the newer charge is lower", () => {
  const audit = analyzeStatements([{
    name: "s.csv",
    text: csv([
      "2026-03-06,OPENAI CHATGPT PLUS,1999,",
      "2026-04-06,OPENAI CHATGPT PLUS,1999,",
      "2026-05-06,OPENAI CHATGPT PLUS,1999,",
      "2026-06-06,OPENAI CHATGPT PLUS,999,",
    ]),
  }], [], { today });
  const openai = audit.recurringItems[0];

  const savings = buildVerifiedSavings(audit.recurringItems, {
    [openai.identityKey]: { action: "downgrade", decidedAt: "2026-05-20" },
  }, { today });

  const entry = savings.entries[0];
  assert.equal(entry.status, "verified");
  assert.ok(entry.monthlySaving >= 900, `expected ~1000 monthly saving, got ${entry.monthlySaving}`);
});

test("keep/watch/investigate decisions never mint savings", () => {
  const audit = analyzeStatements([{ name: "s.csv", text: workspaceCsv }], [], { today });
  const savings = buildVerifiedSavings(audit.recurringItems, {
    [audit.recurringItems[0].identityKey]: { action: "keep", decidedAt: "2026-03-20" },
  }, { today });
  assert.equal(savings.entries.length, 0);
});

test("scheduled manual evidence is not treated as a post-decision charge", () => {
  const audit = analyzeStatements([], [{
    id: "manual-netflix",
    merchant: "Netflix",
    amount: 649,
    frequency: "monthly",
    nextExpectedDate: "2026-08-05",
    category: "Streaming",
    sourceName: "subscription screen",
  }], { today });
  const netflix = audit.recurringItems[0];

  const savings = buildVerifiedSavings(audit.recurringItems, {
    [netflix.identityKey]: { action: "cancel", decidedAt: "2026-07-01" },
  }, { today });

  assert.equal(savings.entries[0].status, "watching");
  assert.doesNotMatch(savings.entries[0].detail, /still active/i);
});

test("foreign-currency savings details retain the commitment currency", () => {
  const item = analyzeStatements([], [{
    id: "usd-plan",
    merchant: "USD Plan",
    amount: 20,
    currency: "USD",
    frequency: "monthly",
    nextExpectedDate: "2026-02-15",
    category: "AI tools",
    sourceName: "statement.csv",
  }], { today: new Date("2026-01-15T00:00:00.000Z") }).recurringItems[0];
  item.evidence = [{
    date: "2026-01-01",
    amount: 20,
    description: "USD PLAN",
    source: "statement.csv",
    rowNumber: 1,
    kind: "observed-charge",
  }];
  const summary = buildVerifiedSavings([item], {
    [item.identityKey]: { action: "cancel", decidedAt: "2026-01-15T00:00:00.000Z" },
  }, {
    today: new Date("2026-04-20T00:00:00.000Z"),
    coverageWindows: [{ source: "statement.csv", startDate: "2026-01-01", endDate: "2026-04-20" }],
  });

  assert.equal(summary.entries[0]?.status, "verified");
  assert.match(summary.entries[0]?.detail ?? "", /\$240(?:\.00)?\/yr/);
  assert.doesNotMatch(summary.entries[0]?.detail ?? "", /₹/);
});
