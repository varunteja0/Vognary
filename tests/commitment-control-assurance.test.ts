import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const threatModel = source("docs/security/commitment-control-threat-model.md");
const incidentRunbook = source("docs/security/incident-response-runbook.md");
const assessmentBrief = source("docs/security/independent-assessment-brief.md");
const operatorEvidenceTemplate = source("docs/templates/control-pilot-operator-evidence-template.md");
const disclosurePolicy = source("docs/vulnerability-disclosure-policy.md");
const securityPage = source("src/app/security/page.tsx");

test("the Control threat model covers the financial and tenant trust boundaries", () => {
  const normalizedThreatModel = threatModel.replace(/\s+/g, " ");
  for (const requirement of [
    /real customer financial data.*independent security (?:assessment|review)/i,
    /assets/i,
    /trust boundaries/i,
    /authentication/i,
    /tenant isolation/i,
    /financial integrity/i,
    /evidence integrity/i,
    /privacy/i,
    /backup/i,
    /administrator/i,
    /residual risk/i,
  ]) {
    assert.match(normalizedThreatModel, requirement);
  }
});

test("the incident runbook fails closed and separates staffing from proof", () => {
  for (const requirement of [
    /incident commander/i,
    /backup incident commander/i,
    /UNASSIGNED.*blocks customer data/i,
    /SEV-0/i,
    /COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS/i,
    /revoke.*session/i,
    /preserve.*evidence/i,
    /customer notification/i,
    /restore/i,
    /tabletop/i,
  ]) {
    assert.match(incidentRunbook, requirement);
  }
});

test("public security copy refuses unsupported superlatives and records the assessment gate", () => {
  const publicTrust = `${securityPage}\n${disclosurePolicy}`;
  assert.match(publicTrust, /independent security (?:assessment|review)/i);
  assert.match(publicTrust, /not yet proven/i);
  assert.doesNotMatch(publicTrust, /highest security|Apple-secure|bank-grade|certified secure/i);
});

test("the independent assessment handoff is synthetic, multi-tenant, and retest-gated", () => {
  const normalizedBrief = assessmentBrief.replace(/\s+/g, " ");
  for (const requirement of [
    /assessed commit SHA/i,
    /synthetic data only/i,
    /two workspaces/i,
    /owner.*admin.*member/i,
    /RBAC.*IDOR/i,
    /tenant isolation/i,
    /financial integrity/i,
    /privacy export.*erasure/i,
    /no denial-of-service/i,
    /zero unresolved Critical or High/i,
    /retest/i,
  ]) {
    assert.match(normalizedBrief, requirement);
  }
});

test("the first-pilot operator record keeps external proof restricted and hash-addressable", () => {
  const normalized = operatorEvidenceTemplate.replace(/\s+/g, " ");
  for (const requirement of [
    /do not complete.*in Git/i,
    /incident commander/i,
    /backup incident commander/i,
    /tabletop/i,
    /actual log sources/i,
    /retention/i,
    /jurisdiction/i,
    /CERT-In applicability/i,
    /Point of Contact/i,
    /clock synchronization/i,
    /proposal-review procedure/i,
    /restore drill/i,
    /monitoring delivery/i,
    /COMMITMENT_CONTROL_OPERATIONS_EVIDENCE_COMMIT_SHA/,
    /assessment report/i,
    /cleared payment/i,
    /exact workspace/i,
    /shasum -a 256/i,
  ]) {
    assert.match(normalized, requirement);
  }
});

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}