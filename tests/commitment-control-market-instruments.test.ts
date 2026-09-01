import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const phaseA = readFileSync("docs/execution/phase-a-market-contact.md", "utf8");
const firstUsers = readFileSync("docs/execution/first-users-runbook.md", "utf8");
const gitignore = readFileSync(".gitignore", "utf8");

test("Phase A targets one funded finance-owned Commitment Control beachhead", () => {
  assert.match(phaseA, /20[–-]100-person/);
  assert.match(phaseA, /raised.*last 24 months/i);
  assert.match(phaseA, /₹8 lakh\/month/);
  assert.match(phaseA, /named finance owner/i);
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
    "contacted_at",
    "conversation_at",
    "pain_class",
    "spend_threshold_confirmed_at",
    "offer_at",
    "payment_received_at",
    "pre_spend_proposal_count",
    "changed_decision_count",
    "renewal_paid_at",
  ]) {
    assert.match(crm.split("\n", 1)[0], new RegExp(`(?:^|,)${column}(?:,|$)`));
  }
  assert.match(phaseA, /QUALIFIED\s*\|\s*EXPLORATORY/);
  assert.match(phaseA, /exploratory[\s\S]*qualified_at[\s\S]*blank/i);
});

test("the live first-user ladder measures proposal to frozen cap and second-proposal behavior", () => {
  const live = firstUsers.split("## Historical Recovery instrument", 1)[0];
  assert.match(live, /Commitment Control live session/i);
  assert.match(live, /T0.*pre-spend|T0[\s\S]*proposed obligation/i);
  assert.match(live, /T1[\s\S]*real upcoming commitment/i);
  assert.match(live, /T2[\s\S]*cited existing exposure/i);
  assert.match(live, /T3[\s\S]*frozen cap/i);
  assert.match(live, /T4[\s\S]*second proposal/i);
  assert.doesNotMatch(live, /Keep \/ Review later \/ Plan to cancel/);
});