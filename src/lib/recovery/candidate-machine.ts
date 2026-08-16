export const candidateStatuses = [
  "SHADOW",
  "NOTICE_QUEUED",
  "AUTHORIZED_BY_RULE",
  "IN_PROGRESS",
  "PROVIDER_PENDING",
  "EXECUTED",
  "VERIFYING",
  "VERIFIED",
  "VETOED",
  "REVOKED",
  "EXCEPTION",
  "FAILED",
  "DISPUTED",
  "WITHDRAWN",
] as const;
export type CandidateStatus = (typeof candidateStatuses)[number];

export const terminalCandidateStatuses = [
  "VETOED",
  "REVOKED",
  "EXCEPTION",
  "FAILED",
  "DISPUTED",
  "WITHDRAWN",
  "VERIFIED",
] as const satisfies readonly CandidateStatus[];

const allowedTransitions: Readonly<Record<CandidateStatus, readonly CandidateStatus[]>> = {
  SHADOW: ["NOTICE_QUEUED", "VETOED", "REVOKED", "WITHDRAWN", "EXCEPTION"],
  NOTICE_QUEUED: ["AUTHORIZED_BY_RULE", "VETOED", "REVOKED", "EXCEPTION", "FAILED", "WITHDRAWN"],
  AUTHORIZED_BY_RULE: ["IN_PROGRESS", "VETOED", "REVOKED", "EXCEPTION", "WITHDRAWN"],
  IN_PROGRESS: ["PROVIDER_PENDING", "EXECUTED", "EXCEPTION", "FAILED", "VETOED", "REVOKED", "WITHDRAWN"],
  PROVIDER_PENDING: ["EXECUTED", "EXCEPTION", "FAILED", "VETOED", "REVOKED", "WITHDRAWN"],
  EXECUTED: ["VERIFYING", "FAILED", "DISPUTED"],
  VERIFYING: ["VERIFIED", "FAILED", "DISPUTED"],
  VERIFIED: ["DISPUTED"],
  VETOED: [],
  REVOKED: [],
  EXCEPTION: [],
  FAILED: ["SHADOW"],
  DISPUTED: ["VERIFIED", "FAILED"],
  WITHDRAWN: [],
};

export type TransitionContext = {
  executionEnabled: boolean;
  noticeDelivered: boolean;
  noticeEnabled: boolean;
  now: Date;
  vetoDeadline: Date | null;
  vetoed: boolean;
  revoked: boolean;
};

export function canTransitionCandidate(from: CandidateStatus, to: CandidateStatus, context: TransitionContext): boolean {
  if (!allowedTransitions[from].includes(to)) return false;
  if (context.revoked && to !== "REVOKED" && to !== "WITHDRAWN") return false;
  if (context.vetoed && to !== "VETOED" && to !== "WITHDRAWN") return false;
  if (to === "NOTICE_QUEUED" && !context.noticeEnabled) return false;
  if (to === "AUTHORIZED_BY_RULE") {
    if (!context.noticeDelivered || !context.vetoDeadline) return false;
    if (context.now.getTime() < context.vetoDeadline.getTime()) return false;
  }
  if ((to === "IN_PROGRESS" || to === "PROVIDER_PENDING" || to === "EXECUTED") && !context.executionEnabled) {
    return false;
  }
  return true;
}

export function shadowEvaluatorAllowedStatuses(): readonly CandidateStatus[] {
  return ["SHADOW"];
}
