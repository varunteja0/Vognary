import assert from "node:assert/strict";
import test from "node:test";
import {
  getCommitmentControlEnrollmentReadiness,
  isCommitmentControlWorkspaceEnrolled,
} from "../src/lib/commitment-control/enrollment";
import {
  independentSecurityAssessmentEvidenceFromEnvironment,
  isIndependentSecurityAssessmentCleared,
} from "../src/lib/commitment-control/security-assessment";

const workspaceId = "a1000000-0000-4000-8000-000000000001";
const assessedCommitSha = "a".repeat(40);
const clearedAssessment = {
  status: "passed",
  retestStatus: "passed",
  assessedAt: "2026-09-01",
  retestedAt: "2026-09-01",
  assessedCommitSha,
  deployedCommitSha: assessedCommitSha,
  reportSha256: "b".repeat(64),
  retestSha256: "c".repeat(64),
  openCriticalHigh: "0",
  openDataImpactingMedium: "0",
} as const;

test("Commitment Control enrollment is fail-closed and matches exact workspace UUIDs", () => {
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, { value: undefined, nodeEnv: "production" }), false);
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, { value: "", nodeEnv: "production" }), false);
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, {
    value: "b1000000-0000-4000-8000-000000000001, A1000000-0000-4000-8000-000000000001",
    paidValue: workspaceId,
    nodeEnv: "production",
    assessment: clearedAssessment,
  }), true);
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, {
    value: "b1000000-0000-4000-8000-000000000001",
    nodeEnv: "production",
  }), false);
});

test("production enrollment requires cleared payment and release-bound independent assessment evidence", () => {
  const enrolled = {
    value: workspaceId,
    paidValue: workspaceId,
    nodeEnv: "production",
    assessment: clearedAssessment,
  } as const;

  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, { ...enrolled, paidValue: "" }), false);
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, { ...enrolled, assessment: null }), false);
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, {
    ...enrolled,
    assessment: { ...clearedAssessment, retestedAt: undefined },
  }), false);
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, {
    ...enrolled,
    assessment: { ...clearedAssessment, deployedCommitSha: "d".repeat(40) },
  }), false);
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, {
    ...enrolled,
    assessment: { ...clearedAssessment, openCriticalHigh: "1" },
  }), false);
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, {
    ...enrolled,
    assessment: { ...clearedAssessment, openDataImpactingMedium: "1" },
  }), false);
  assert.equal(isIndependentSecurityAssessmentCleared({
    ...clearedAssessment,
    assessedAt: "2999-01-01",
    retestedAt: "2999-01-02",
  }), false);
  assert.equal(isIndependentSecurityAssessmentCleared({
    ...clearedAssessment,
    assessedAt: "2026-09-02",
    retestedAt: "2026-09-01",
  }), false);
});

test("the wildcard is development-only and cannot enroll every production workspace", () => {
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, { value: "*", nodeEnv: "test" }), true);
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, { value: "*", nodeEnv: "development" }), true);
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, { value: "*", nodeEnv: "production" }), false);
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, { value: "*", nodeEnv: "staging" }), false);
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, { value: "*", nodeEnv: undefined }), false);
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, {
    value: workspaceId,
    paidValue: "",
    nodeEnv: undefined,
    assessment: null,
  }), false);
});

test("production readiness names payment and assessment blockers without exposing workspace ids", () => {
  assert.deepEqual(getCommitmentControlEnrollmentReadiness({ value: "", paidValue: "", nodeEnv: "production", assessment: null }), {
    status: "disabled-no-workspaces",
    enrolledWorkspaceCount: 0,
  });
  assert.equal(getCommitmentControlEnrollmentReadiness({
    value: workspaceId,
    paidValue: "",
    nodeEnv: "production",
    assessment: clearedAssessment,
  }).status, "blocked-payment-evidence");
  assert.equal(getCommitmentControlEnrollmentReadiness({
    value: workspaceId,
    paidValue: workspaceId,
    nodeEnv: "production",
    assessment: null,
  }).status, "blocked-security-assessment");
  const ready = getCommitmentControlEnrollmentReadiness({
    value: workspaceId,
    paidValue: workspaceId,
    nodeEnv: "production",
    assessment: clearedAssessment,
  });
  assert.deepEqual(ready, { status: "ready", enrolledWorkspaceCount: 1 });
  assert.doesNotMatch(JSON.stringify(ready), new RegExp(workspaceId, "i"));

  assert.deepEqual(getCommitmentControlEnrollmentReadiness({
    value: workspaceId,
    paidValue: workspaceId,
    nodeEnv: "production",
    assessment: { ...clearedAssessment, deployedCommitSha: "d".repeat(40) },
  }), {
    status: "blocked-security-assessment",
    reason: "assessed-commit-mismatch",
    enrolledWorkspaceCount: 1,
  });
  assert.equal(getCommitmentControlEnrollmentReadiness({
    paidValue: workspaceId,
    nodeEnv: "production",
    assessment: clearedAssessment,
    value: `${workspaceId},not-a-uuid`,
  }).status, "blocked-invalid-workspace-list");
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, {
    value: workspaceId,
    nodeEnv: "production",
    assessment: clearedAssessment,
    paidValue: `${workspaceId},not-a-uuid`,
  }), false);
});

test("an explicit deployed commit supports non-Vercel hosts while Vercel remains authoritative", () => {
  const names = ["VERCEL_GIT_COMMIT_SHA", "COMMITMENT_CONTROL_DEPLOYED_COMMIT_SHA"] as const;
  const saved = new Map(names.map((name) => [name, process.env[name]] as const));
  try {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    process.env.COMMITMENT_CONTROL_DEPLOYED_COMMIT_SHA = "d".repeat(40);
    assert.equal(independentSecurityAssessmentEvidenceFromEnvironment().deployedCommitSha, "d".repeat(40));
    process.env.VERCEL_GIT_COMMIT_SHA = "e".repeat(40);
    assert.equal(independentSecurityAssessmentEvidenceFromEnvironment().deployedCommitSha, "e".repeat(40));
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});