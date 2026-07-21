import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeStatements, type ManualRecurringInput } from "../src/lib/recurring-audit";
import { buildAuditReport, renderAuditReportText } from "../src/lib/audit-report";

const today = new Date(2026, 6, 10); // 2026-07-10

function csv(rows: string[]): string {
  return ["Date,Description,Debit,Credit", ...rows].join("\n");
}

// A realistic India statement: a UPI AutoPay subscription (the mandate the audit
// exists to surface) plus a manual foreign-currency SaaS charge, so the report
// has to keep ₹ and $ apart instead of inventing an exchange rate.
function indiaAudit() {
  const statements = [{
    name: "hdfc-statement.csv",
    text: csv([
      "2026-04-06,UPI AUTOPAY NETFLIX BILLDESK @ybl,649,",
      "2026-05-06,UPI AUTOPAY NETFLIX BILLDESK @ybl,649,",
      "2026-06-06,UPI AUTOPAY NETFLIX BILLDESK @ybl,649,",
      "2026-07-06,UPI AUTOPAY NETFLIX BILLDESK @ybl,649,",
    ]),
  }];
  const manual: ManualRecurringInput[] = [{
    id: "manual-vercel",
    merchant: "Vercel",
    amount: 20,
    currency: "USD",
    frequency: "monthly",
    nextExpectedDate: "2026-08-15",
    category: "SaaS",
    sourceName: "Manual entry (user confirmed)",
  }];
  return analyzeStatements(statements.map(({ name, text }) => ({ name, text })), manual, { today });
}

test("buildAuditReport totals match the deterministic audit, keeping foreign spend separate", () => {
  const audit = indiaAudit();
  const report = buildAuditReport(audit, { today });

  assert.equal(report.monthlyBurn, audit.summary.monthlyRecurringSpend, "burn is the engine's ₹ figure, never invented");
  assert.equal(report.annualBurn, audit.summary.annualRecurringSpend);
  assert.equal(report.commitmentCount, audit.recurringItems.length);
  assert.equal(report.currency, "INR", "India-first primary currency");
  // The $20 SaaS charge must NOT be folded into the ₹ burn.
  assert.equal(report.foreignMonthlyTotals.USD, 20);
  assert.ok(!Object.keys(report.foreignMonthlyTotals).includes("INR"));
});

test("buildAuditReport surfaces the UPI AutoPay mandate as a kill candidate", () => {
  const report = buildAuditReport(indiaAudit(), { today });
  const netflixKill = report.mandateKills.find((kill) => kill.merchant.includes("Netflix"));
  assert.ok(netflixKill, "the UPI AutoPay Netflix charge must appear in the kill-list");
  assert.equal(netflixKill!.rail, "upi-autopay");
});

test("top actions rank a user-chosen cancel by rupees freed", () => {
  const audit = indiaAudit();
  const netflix = audit.recurringItems.find((item) => item.merchant.includes("Netflix"));
  assert.ok(netflix);
  const report = buildAuditReport(audit, { today, actions: { [netflix!.identityKey]: "cancel" } });

  assert.ok(report.topActions.length >= 1);
  assert.equal(report.topActions[0].merchant, "Netflix");
  assert.equal(report.topActions[0].action, "cancel");
  assert.ok(report.potentialMonthlySavings >= 649, "cancelling Netflix frees at least its ₹ monthly cost");
});

test("the report names the evidence it used and refuses to imply more", () => {
  const report = buildAuditReport(indiaAudit(), { today });
  assert.ok(report.sourcesUsed.length >= 1, "at least the statement source is named");
  assert.match(report.coverageNote, /not included|only/i, "honest about what is NOT counted");
});

test("renderAuditReportText produces a copy-ready India-first report", () => {
  const audit = indiaAudit();
  const netflix = audit.recurringItems.find((item) => item.merchant.includes("Netflix"));
  const text = renderAuditReportText(buildAuditReport(audit, { today, actions: { [netflix!.identityKey]: "cancel" } }));

  assert.match(text, /₹/, "rupee-denominated");
  assert.match(text, /Netflix/);
  assert.match(text, /UPI AutoPay/i, "the mandate rail is named");
  assert.match(text, /\$20|US\$20|USD/, "foreign spend is shown, not silently dropped");
  assert.match(text, /Vognary/, "attributable to the tool that produced it");
  // Cite-or-shut-up: the report must state its numbers are evidence-backed.
  assert.match(text, /evidence|proof/i);
});
