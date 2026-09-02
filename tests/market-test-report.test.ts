import assert from "node:assert/strict";
import test from "node:test";

import {
  formatMarketTestReport,
  parseMarketTestCsv,
  summarizeMarketTest,
} from "../scripts/lib/market-test-report.mjs";

const header = [
  "id",
  "contact_cohort",
  "test_cell",
  "company_name",
  "finance_owner_public_url",
  "operator_scope_count",
  "technology_spend_responsibility",
  "buying_role",
  "contact_channel",
  "founder_minutes",
  "contacted_at",
  "replied_at",
  "conversation_at",
  "repeated_job_status",
  "job_selected",
  "enforcement_requirement",
  "next_event_committed_at",
  "offer_at",
  "invoice_commitment_at",
  "invoice_sent_at",
  "payment_received_at",
  "t5_status",
  "notes",
].join(",");

test("market report parses quoted private notes but returns cell aggregates only", () => {
  const rows = parseMarketTestCsv([
    header,
    row({ id: "P01", company_name: "Secret, Inc", test_cell: "DIRECT_FINANCE", contact_cohort: "QUALIFIED", contact_channel: "WARM_INTRO", founder_minutes: "35", contacted_at: "2026-09-02", replied_at: "2026-09-03", conversation_at: "2026-09-04", repeated_job_status: "YES", job_selected: "DECISION_TO_OUTCOME", enforcement_requirement: "ADVISORY_ACCEPTED", next_event_committed_at: "2026-09-05", offer_at: "2026-09-05", invoice_commitment_at: "2026-09-05", notes: 'First line, private\nSecond "quoted" line' }),
    row({ id: "P02", company_name: "Hidden Labs", test_cell: "DIRECT_FINANCE", contact_cohort: "QUALIFIED", contact_channel: "MANUAL_DIRECT", founder_minutes: "25", conversation_at: "2026-09-04", repeated_job_status: "YES", next_event_committed_at: "2026-09-05", payment_received_at: "2026-09-06" }),
    row({ id: "P03", company_name: "Private Systems", test_cell: "DIRECT_FINANCE", contact_cohort: "QUALIFIED", conversation_at: "2026-09-04", repeated_job_status: "YES" }),
    row({ id: "P04", company_name: "Internal Data", test_cell: "DIRECT_FINANCE", contact_cohort: "QUALIFIED", conversation_at: "2026-09-04" }),
    row({ id: "P05", company_name: "Do Not Print", test_cell: "DIRECT_FINANCE", contact_cohort: "QUALIFIED", conversation_at: "2026-09-04" }),
    row({ id: "P06", company_name: "Fractional Secret", test_cell: "FRACTIONAL_FINANCE", contact_cohort: "EXPLORATORY", contacted_at: "2026-09-02", enforcement_requirement: "NEEDS_ENFORCEMENT" }),
  ].join("\n"));

  const summary = summarizeMarketTest(rows);
  assert.equal(summary.totalRows, 6);
  assert.equal(summary.cells.DIRECT_FINANCE.conversations, 5);
  assert.equal(summary.cells.DIRECT_FINANCE.repeatedJobs, 3);
  assert.equal(summary.cells.DIRECT_FINANCE.committedEvents, 2);
  assert.equal(summary.cells.DIRECT_FINANCE.paymentOrInvoiceCommitments, 2);
  assert.equal(summary.cells.DIRECT_FINANCE.directionalGate, "WIN_CANDIDATE");
  assert.equal(summary.cells.FRACTIONAL_FINANCE.needsEnforcement, 1);
  assert.equal(summary.companyGate.status, "INCOMPLETE");
  assert.equal(summary.founderEffort.totalMinutes, 60);
  assert.equal(summary.founderEffort.minutesPerConversation, 12);
  assert.equal(summary.founderEffort.minutesPerClearedPayment, 60);
  assert.deepEqual(summary.contactedByChannel, {
    WARM_INTRO: 1,
    MANUAL_DIRECT: 0,
    REFERRAL: 0,
    PARTNER: 0,
    OTHER: 0,
    UNMEASURED: 1,
  });

  const output = formatMarketTestReport(summary);
  assert.match(output, /DIRECT_FINANCE.*WIN_CANDIDATE/);
  assert.match(output, /Founder effort: 60 recorded min.*12 min\/conversation.*60 min\/cleared payment/);
  assert.match(output, /Contacted channels: 1 warm intro.*1 unmeasured/);
  assert.doesNotMatch(output, /Secret|Hidden|Private|P0[1-6]|quoted|First line/);
});

test("company gate separates incomplete, rework, failure, and go using cleared payments", () => {
  const baseRows = Array.from({ length: 10 }, (_, index) => ({
    test_cell: "FINOPS_AI_OPERATIONS",
    offer_at: `2026-09-${String(index + 1).padStart(2, "0")}`,
  }));

  assert.equal(summarizeMarketTest(baseRows).companyGate.status, "FAIL");
  assert.equal(summarizeMarketTest(baseRows.map((entry, index) => ({ ...entry, payment_received_at: index === 0 ? "2026-09-12" : "" }))).companyGate.status, "REWORK");
  assert.equal(summarizeMarketTest(baseRows.map((entry, index) => ({ ...entry, payment_received_at: index < 2 ? "2026-09-12" : "" }))).companyGate.status, "GO");
  assert.equal(summarizeMarketTest(baseRows.slice(0, 9)).companyGate.status, "INCOMPLETE");
});

test("cohort gate requires public evidence rather than five assigned labels", () => {
  const direct = Array.from({ length: 5 }, () => ({ test_cell: "DIRECT_FINANCE", contact_cohort: "QUALIFIED" }));
  const fractional = Array.from({ length: 5 }, (_, index) => ({
    test_cell: "FRACTIONAL_FINANCE",
    contact_cohort: "EXPLORATORY",
    operator_scope_count: index === 4 ? "4" : "5",
    finance_owner_public_url: "https://example.test/public-role",
  }));
  const finops = Array.from({ length: 5 }, (_, index) => ({
    test_cell: "FINOPS_AI_OPERATIONS",
    contact_cohort: "EXPLORATORY",
    technology_spend_responsibility: index === 4 ? "UNMEASURED" : "YES",
    finance_owner_public_url: "https://example.test/public-role",
  }));

  const incomplete = summarizeMarketTest([...direct, ...fractional, ...finops]);
  assert.equal(incomplete.cells.DIRECT_FINANCE.evidenceReadyCandidates, 5);
  assert.equal(incomplete.cells.FRACTIONAL_FINANCE.evidenceReadyCandidates, 4);
  assert.equal(incomplete.cells.FINOPS_AI_OPERATIONS.evidenceReadyCandidates, 4);
  assert.equal(incomplete.cohortGate.status, "INCOMPLETE");

  fractional[4].operator_scope_count = "5";
  finops[4].technology_spend_responsibility = "YES";
  const ready = summarizeMarketTest([...direct, ...fractional, ...finops]);
  assert.equal(ready.cohortGate.status, "READY");
  assert.match(formatMarketTestReport(ready), /Cohort gate READY/);
});

test("market effort fields fail closed on invented channels or malformed minutes", () => {
  assert.throws(
    () => parseMarketTestCsv([header, row({ id: "P01", contact_channel: "AUTOMATED_COLD", founder_minutes: "15" })].join("\n")),
    /invalid contact_channel/i,
  );
  for (const founder_minutes of ["-1", "1.5", "01", "unsafe"]) {
    assert.throws(
      () => parseMarketTestCsv([header, row({ id: "P01", contact_channel: "WARM_INTRO", founder_minutes })].join("\n")),
      /invalid founder_minutes/i,
    );
  }
});

function row(values: Record<string, string>) {
  return header.split(",").map((field) => quote(values[field] ?? "")).join(",");
}

function quote(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}