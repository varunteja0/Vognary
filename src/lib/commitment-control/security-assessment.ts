const commitSha = /^[0-9a-f]{40}$/i;
const sha256 = /^[0-9a-f]{64}$/i;
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

export type IndependentSecurityAssessmentEvidence = {
  status?: string;
  retestStatus?: string;
  assessedAt?: string;
  retestedAt?: string;
  assessedCommitSha?: string;
  deployedCommitSha?: string;
  reportSha256?: string;
  retestSha256?: string;
  openCriticalHigh?: string;
  openDataImpactingMedium?: string;
  publicDisclosureStatus?: string;
};

export type IndependentSecurityAssessmentBlocker =
  | "assessment-not-passed"
  | "retest-not-passed"
  | "assessment-date-invalid"
  | "retest-date-invalid"
  | "retest-before-assessment"
  | "assessed-commit-invalid"
  | "deployed-commit-invalid"
  | "assessed-commit-mismatch"
  | "report-hash-invalid"
  | "retest-hash-invalid"
  | "open-critical-high"
  | "open-data-impacting-medium";

export function independentSecurityAssessmentEvidenceFromEnvironment(): IndependentSecurityAssessmentEvidence {
  return {
    status: process.env.COMMITMENT_CONTROL_SECURITY_ASSESSMENT_STATUS,
    retestStatus: process.env.COMMITMENT_CONTROL_SECURITY_RETEST_STATUS,
    assessedAt: process.env.COMMITMENT_CONTROL_SECURITY_ASSESSMENT_AT,
    retestedAt: process.env.COMMITMENT_CONTROL_SECURITY_RETEST_AT,
    assessedCommitSha: process.env.COMMITMENT_CONTROL_SECURITY_ASSESSED_COMMIT_SHA,
    deployedCommitSha: process.env.VERCEL_GIT_COMMIT_SHA || process.env.COMMITMENT_CONTROL_DEPLOYED_COMMIT_SHA,
    reportSha256: process.env.COMMITMENT_CONTROL_SECURITY_REPORT_SHA256,
    retestSha256: process.env.COMMITMENT_CONTROL_SECURITY_RETEST_SHA256,
    openCriticalHigh: process.env.COMMITMENT_CONTROL_SECURITY_OPEN_CRITICAL_HIGH,
    openDataImpactingMedium: process.env.COMMITMENT_CONTROL_SECURITY_OPEN_DATA_IMPACTING_MEDIUM,
    publicDisclosureStatus: process.env.COMMITMENT_CONTROL_SECURITY_PUBLIC_DISCLOSURE_STATUS,
  };
}

export function isIndependentSecurityAssessmentCleared(evidence: IndependentSecurityAssessmentEvidence) {
  return independentSecurityAssessmentBlocker(evidence) === null;
}

export function independentSecurityAssessmentBlocker(
  evidence: IndependentSecurityAssessmentEvidence,
): IndependentSecurityAssessmentBlocker | null {
  const assessedAt = evidence.assessedAt?.trim() ?? "";
  const retestedAt = evidence.retestedAt?.trim() ?? "";
  const assessedCommitSha = evidence.assessedCommitSha?.trim().toLowerCase() ?? "";
  const deployedCommitSha = evidence.deployedCommitSha?.trim().toLowerCase() ?? "";
  if (evidence.status?.trim() !== "passed") return "assessment-not-passed";
  if (evidence.retestStatus?.trim() !== "passed") return "retest-not-passed";
  if (!validPastOrPresentDate(assessedAt)) return "assessment-date-invalid";
  if (!validPastOrPresentDate(retestedAt)) return "retest-date-invalid";
  if (retestedAt < assessedAt) return "retest-before-assessment";
  if (!commitSha.test(assessedCommitSha)) return "assessed-commit-invalid";
  if (!commitSha.test(deployedCommitSha)) return "deployed-commit-invalid";
  if (assessedCommitSha !== deployedCommitSha) return "assessed-commit-mismatch";
  if (!sha256.test(evidence.reportSha256?.trim() ?? "")) return "report-hash-invalid";
  if (!sha256.test(evidence.retestSha256?.trim() ?? "")) return "retest-hash-invalid";
  if (evidence.openCriticalHigh?.trim() !== "0") return "open-critical-high";
  if (evidence.openDataImpactingMedium?.trim() !== "0") return "open-data-impacting-medium";
  return null;
}

function validPastOrPresentDate(value: string) {
  if (!dateOnly.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false;
  return parsed.getTime() <= Date.now();
}
