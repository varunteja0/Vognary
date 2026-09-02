import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const phaseA = readFileSync("docs/execution/phase-a-market-contact.md", "utf8");
const firstUsers = readFileSync("docs/execution/first-users-runbook.md", "utf8");
const outreach = readFileSync("docs/templates/outreach-scripts.md", "utf8");
const gitignore = readFileSync(".gitignore", "utf8");

test("Phase A runs one bounded three-cell wedge test before changing the product", () => {
  assert.match(phaseA, /20[–-]100-person/);
  assert.match(phaseA, /raised.*last 24 months/i);
  assert.match(phaseA, /₹8 lakh\/month/);
  assert.match(phaseA, /named finance owner/i);
  assert.match(phaseA, /DIRECT_FINANCE\s*\|\s*FRACTIONAL_FINANCE\s*\|\s*FINOPS_AI_OPERATIONS/);
  assert.match(phaseA, /five completed conversations per (?:test )?cell/i);
  assert.match(phaseA, /Authorization Ledger/);
  assert.match(phaseA, /rail-neutral/i);
  assert.match(phaseA, /decision-to-outcome/i);
  assert.match(phaseA, /founder-delivered control desk/i);
  assert.match(phaseA, /last real (?:financial )?(?:obligation|commitment)/i);
  assert.match(phaseA, /pre-spend/i);
  assert.match(phaseA, /up to ten (?:real )?proposals/i);
  assert.match(phaseA, /one 30-minute reconciliation review per week/i);
  assert.match(phaseA, /two additional founder-support hours/i);
  assert.match(phaseA, /one-time/i);
  assert.doesNotMatch(phaseA, /up to 50 commitment evaluations|one-business-day response SLA|monthly Razorpay subscription/i);
});

test("the private Commitment Control CRM has a committed schema and stays gitignored", () => {
  const crm = readFileSync("docs/execution/private-commitment-control-pilot-crm.csv.example", "utf8");
  assert.match(gitignore, /^docs\/execution\/private-commitment-control-pilot-crm\.csv$/m);
  for (const column of [
    "company_name",
    "contact_cohort",
    "test_cell",
    "operator_scope_count",
    "technology_spend_responsibility",
    "buying_role",
    "contacted_at",
    "replied_at",
    "conversation_at",
    "pain_class",
    "repeated_job_status",
    "job_selected",
    "enforcement_requirement",
    "next_event_committed_at",
    "spend_threshold_confirmed_at",
    "offer_at",
    "invoice_commitment_at",
    "payment_received_at",
    "pre_spend_proposal_count",
    "changed_decision_count",
    "t5_status",
    "renewal_paid_at",
  ]) {
    assert.match(crm.split("\n", 1)[0], new RegExp(`(?:^|,)${column}(?:,|$)`));
  }
  assert.match(phaseA, /QUALIFIED\s*\|\s*EXPLORATORY/);
  assert.match(phaseA, /exploratory[\s\S]*qualified_at[\s\S]*blank/i);
  assert.match(phaseA, /pending (?:LinkedIn )?invitation[\s\S]*(?:reply|conversation)/i);
  assert.match(phaseA, /npm run market:cohort-gate/);
});

test("the live first-user ladder measures proposal through repeat behavior and reconciliation", () => {
  const live = firstUsers.split("## Historical Recovery instrument", 1)[0];
  assert.match(live, /Commitment Control live session/i);
  assert.match(live, /T0.*pre-spend|T0[\s\S]*proposed obligation/i);
  assert.match(live, /T1[\s\S]*real upcoming commitment/i);
  assert.match(live, /T2[\s\S]*cited existing exposure/i);
  assert.match(live, /T3[\s\S]*frozen cap/i);
  assert.match(live, /T4[\s\S]*second proposal/i);
  assert.match(live, /T5[\s\S]*reconcil/i);
  assert.match(live, /DIRECT_FINANCE\s*\/\s*FRACTIONAL_FINANCE\s*\/\s*FINOPS_AI_OPERATIONS/);
  assert.match(live, /PRE_SPEND\s*\/\s*RECOVERY\s*\/\s*DECISION_TO_OUTCOME/);
  assert.match(live, /Repeated job: YES \/ NO \/ UNMEASURED/);
  assert.match(live, /ADVISORY_ACCEPTED\s*\/\s*NEEDS_ENFORCEMENT/);
  assert.doesNotMatch(live, /Keep \/ Review later \/ Plan to cancel/);
});

test("outreach tests the three buyer cells with one honest offer and no retired free audit", () => {
  for (const cell of ["DIRECT_FINANCE", "FRACTIONAL_FINANCE", "FINOPS_AI_OPERATIONS"]) {
    assert.match(outreach, new RegExp(cell));
  }
  assert.match(outreach, /last real (?:AI, SaaS, or cloud )?commitment/i);
  assert.match(outreach, /Authorization Ledger/);
  assert.match(outreach, /₹14,999/);
  assert.match(outreach, /synthetic demonstration/i);
  assert.match(outreach, /does not (?:pay|purchase|block)/i);
  assert.match(outreach, /founder sends/i);
  assert.doesNotMatch(outreach, /free (?:founder-assisted )?(?:pilot|audit)|Keep \/ Review|Plan to cancel|reply “audit”/i);
});