import {
  independentSecurityAssessmentBlocker,
  independentSecurityAssessmentEvidenceFromEnvironment,
  isIndependentSecurityAssessmentCleared,
  type IndependentSecurityAssessmentEvidence,
} from "./security-assessment";

const workspaceUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type EnrollmentOptions = {
  value?: string;
  paidValue?: string;
  nodeEnv?: string;
  assessment?: IndependentSecurityAssessmentEvidence | null;
};

export function isCommitmentControlWorkspaceEnrolled(
  workspaceId: string,
  options: EnrollmentOptions = {},
) {
  const value = options.value ?? process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS;
  const nodeEnv = Object.hasOwn(options, "nodeEnv") ? options.nodeEnv : process.env.NODE_ENV;
  if (!workspaceUuid.test(workspaceId) || !value?.trim()) return false;
  if (value.trim() === "*") return isLocalNodeEnvironment(nodeEnv);
  const enrolled = parseWorkspaceIds(value);
  if (!enrolled.valid || !enrolled.ids.has(workspaceId.toLowerCase())) return false;
  if (isLocalNodeEnvironment(nodeEnv)) return true;

  const paidValue = options.paidValue ?? process.env.COMMITMENT_CONTROL_PAID_WORKSPACE_IDS;
  const paid = parseWorkspaceIds(paidValue ?? "");
  if (!paid.valid || !paid.ids.has(workspaceId.toLowerCase())) return false;
  const assessment = options.assessment === undefined
    ? independentSecurityAssessmentEvidenceFromEnvironment()
    : options.assessment;
  return assessment !== null && isIndependentSecurityAssessmentCleared(assessment);
}

export function getCommitmentControlEnrollmentReadiness(options: EnrollmentOptions = {}) {
  const value = options.value ?? process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS;
  const paidValue = options.paidValue ?? process.env.COMMITMENT_CONTROL_PAID_WORKSPACE_IDS;
  const nodeEnv = Object.hasOwn(options, "nodeEnv") ? options.nodeEnv : process.env.NODE_ENV;
  if (!value?.trim()) return { status: "disabled-no-workspaces" as const, enrolledWorkspaceCount: 0 };
  if (value.trim() === "*") {
    return isLocalNodeEnvironment(nodeEnv)
      ? { status: "ready-development-wildcard" as const, enrolledWorkspaceCount: 0 }
      : { status: "blocked-invalid-workspace-list" as const, enrolledWorkspaceCount: 0 };
  }

  const enrolled = parseWorkspaceIds(value);
  if (!enrolled.valid || !enrolled.ids.size) return { status: "blocked-invalid-workspace-list" as const, enrolledWorkspaceCount: 0 };
  if (isLocalNodeEnvironment(nodeEnv)) return { status: "ready" as const, enrolledWorkspaceCount: enrolled.ids.size };

  const paid = parseWorkspaceIds(paidValue ?? "");
  if (!paid.valid || [...enrolled.ids].some((workspaceId) => !paid.ids.has(workspaceId))) {
    return { status: "blocked-payment-evidence" as const, enrolledWorkspaceCount: enrolled.ids.size };
  }
  const assessment = options.assessment === undefined
    ? independentSecurityAssessmentEvidenceFromEnvironment()
    : options.assessment;
  const reason = assessment === null ? "assessment-not-passed" : independentSecurityAssessmentBlocker(assessment);
  if (reason !== null) {
    return { status: "blocked-security-assessment" as const, reason, enrolledWorkspaceCount: enrolled.ids.size };
  }
  return { status: "ready" as const, enrolledWorkspaceCount: enrolled.ids.size };
}

function parseWorkspaceIds(value: string) {
  const entries = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return {
    ids: new Set(entries.filter((entry) => workspaceUuid.test(entry))),
    valid: entries.every((entry) => workspaceUuid.test(entry)),
  };
}

function isLocalNodeEnvironment(nodeEnv: string | undefined) {
  return nodeEnv === "development" || nodeEnv === "test";
}