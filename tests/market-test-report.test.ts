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
  "idea_candidate_observed",
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
  assert.equal(summary.founderEffort.status, "PARTIAL");
  assert.equal(summary.founderEffort.recordedRows, 2);
  assert.equal(summary.founderEffort.unmeasuredRows, 4);
  assert.equal(summary.founderEffort.minutesPerConversation, null);
  assert.equal(summary.founderEffort.minutesPerClearedPayment, null);
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
  assert.match(output, /Founder effort: 60 recorded min.*PARTIAL.*2\/6 rows/);
  assert.doesNotMatch(output, /12 min\/conversation|60 min\/cleared payment/);
  assert.match(output, /Contacted channels: 1 warm intro.*1 unmeasured/);
  assert.doesNotMatch(output, /Secret|Hidden|Private|P0[1-6]|quoted|First line/);
});

test("missing founder time never becomes measured zero effort", () => {
  for (const rows of [[], [{ test_cell: "DIRECT_FINANCE", conversation_at: "2026-09-05", founder_minutes: "" }]]) {
    const summary = summarizeMarketTest(rows);
    assert.equal(summary.founderEffort.status, "UNMEASURED");
    assert.equal(summary.founderEffort.minutesPerConversation, null);
    assert.equal(summary.founderEffort.minutesPerClearedPayment, null);
    assert.match(formatMarketTestReport(summary), /Founder effort: UNMEASURED/);
    assert.doesNotMatch(formatMarketTestReport(summary), /Founder effort: 0 recorded min/);
  }
});

test("complete effort coverage allows rates and distinguishes an explicit recorded zero", () => {
  const summary = summarizeMarketTest([
    { test_cell: "DIRECT_FINANCE", founder_minutes: "30", conversation_at: "2026-09-05", payment_received_at: "2026-09-06" },
    { test_cell: "DIRECT_FINANCE", founder_minutes: "0", conversation_at: "2026-09-05" },
  ]);
  assert.equal(summary.founderEffort.status, "COMPLETE");
  assert.equal(summary.founderEffort.recordedRows, 2);
  assert.equal(summary.founderEffort.unmeasuredRows, 0);
  assert.equal(summary.founderEffort.minutesPerConversation, 15);
  assert.equal(summary.founderEffort.minutesPerClearedPayment, 30);
  assert.match(formatMarketTestReport(summary), /30 recorded min.*COMPLETE.*2\/2 rows.*15 min\/conversation/);
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

test("idea tournament selects one buyer-cell and observed job without averaging cells", () => {
  const directFinance = Array.from({ length: 5 }, (_, index) => ({
    id: `P0${index + 1}`,
    test_cell: "DIRECT_FINANCE",
    conversation_at: "2026-09-08",
    repeated_job_status: index < 3 ? "YES" : "NO",
    idea_candidate_observed: index < 3 ? "AI_SPEND_CHANGE_CONTROL" : "NONE",
    next_event_committed_at: index < 2 ? "2026-09-09" : "",
    invoice_commitment_at: index === 0 ? "2026-09-10" : "",
  }));
  const fractionalFinance = Array.from({ length: 5 }, (_, index) => ({
    id: `P1${index + 1}`,
    test_cell: "FRACTIONAL_FINANCE",
    conversation_at: "2026-09-08",
    repeated_job_status: index < 2 ? "YES" : "NO",
    idea_candidate_observed: index < 2 ? "RECOVERY_FIRST_CONTROL" : "NONE",
    next_event_committed_at: index === 0 ? "2026-09-09" : "",
  }));

  const summary = summarizeMarketTest([...directFinance, ...fractionalFinance]);
  assert.equal(summary.ideaTournament.status, "WIN_CANDIDATE");
  assert.deepEqual(summary.ideaTournament.winnerPairs, [{
    testCell: "DIRECT_FINANCE",
    ideaCandidate: "AI_SPEND_CHANGE_CONTROL",
  }]);
  assert.equal(summary.ideaTournament.candidates.AI_SPEND_CHANGE_CONTROL.observed, 3);
  assert.equal(summary.ideaTournament.candidates.RECOVERY_FIRST_CONTROL.observed, 2);
  assert.equal(summary.ideaTournament.candidates.AGENT_SPEND_AUTHORIZATION.observed, 0);
  assert.equal(
    summary.ideaTournament.pairs.DIRECT_FINANCE.AI_SPEND_CHANGE_CONTROL.directionalGate,
    "WIN_CANDIDATE",
  );
  assert.equal(
    summary.ideaTournament.pairs.FRACTIONAL_FINANCE.RECOVERY_FIRST_CONTROL.directionalGate,
    "INCOMPLETE",
  );

  const secondWinner = fractionalFinance.map((entry, index) => ({
    ...entry,
    repeated_job_status: index < 3 ? "YES" : "NO",
    idea_candidate_observed: index < 3 ? "RECOVERY_FIRST_CONTROL" : "NONE",
    next_event_committed_at: index < 2 ? "2026-09-09" : "",
    invoice_commitment_at: index === 0 ? "2026-09-10" : "",
  }));
  const multiple = summarizeMarketTest([...directFinance, ...secondWinner]);
  assert.equal(multiple.ideaTournament.status, "MULTIPLE_CANDIDATES");
  assert.equal(multiple.ideaTournament.winnerPairs.length, 2);

  const output = formatMarketTestReport(summary);
  assert.match(output, /Idea gate WIN_CANDIDATE/);
  assert.match(output, /DIRECT_FINANCE.*AI_SPEND_CHANGE_CONTROL/);
  assert.doesNotMatch(output, /P0[1-5]|P1[1-5]/);
});

test("idea candidates fail closed when invented or recorded without a conversation", () => {
  assert.throws(
    () => parseMarketTestCsv([header, row({
      id: "P01",
      conversation_at: "2026-09-08",
      idea_candidate_observed: "MAGIC_GLOBAL_WINNER",
    })].join("\n")),
    /invalid idea_candidate_observed/i,
  );
  assert.throws(
    () => parseMarketTestCsv([header, row({
      id: "P01",
      idea_candidate_observed: "AGENT_SPEND_AUTHORIZATION",
    })].join("\n")),
    /idea_candidate_observed requires conversation_at/i,
  );
  assert.throws(
    () => parseMarketTestCsv([header, row({
      id: "P01",
      idea_candidate_observed: "UNMEASURED",
    })].join("\n")),
    /idea_candidate_observed requires conversation_at/i,
  );
  assert.throws(
    () => parseMarketTestCsv([header, row({
      id: "P01",
      conversation_at: "2026-09-08",
      idea_candidate_observed: "AGENT_SPEND_AUTHORIZATION",
    })].join("\n")),
    /idea_candidate_observed requires next_event_committed_at/i,
  );
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