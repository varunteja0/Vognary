import { canTransitionCandidate, type CandidateStatus } from "@/lib/recovery/candidate-machine";

export const executionBlockCodes = [
  "EXECUTION_DISABLED",
  "SHADOW_GATE",
  "MANDATE_INACTIVE",
  "REVOKED",
  "VETOED",
  "INELIGIBLE",
  "PROVIDER_DISABLED",
  "UNSUPPORTED_ROUTE",
  "NOTICE_NOT_DELIVERED",
  "VETO_WINDOW_OPEN",
  "STATUS_NOT_AUTHORIZED",
] as const;
export type ExecutionBlockCode = (typeof executionBlockCodes)[number];

export type ExecutionGateInput = {
  executionEnabled: boolean;
  shadowGatePassed: boolean;
  mandateActive: boolean;
  eligibility: "ELIGIBLE" | "INELIGIBLE" | "PROTECTED" | "UNSUPPORTED_ROUTE";
  status: CandidateStatus;
  noticeDelivered: boolean;
  vetoDeadline: Date | null;
  now: Date;
  vetoed: boolean;
  revoked: boolean;
  providerExecutable: boolean;
  providerDisabled: boolean;
  outcome: "EXECUTED" | "EXCEPTION" | "FAILED";
};

export function executionBlockReason(input: ExecutionGateInput): ExecutionBlockCode | null {
  const honestException = input.outcome === "EXCEPTION";
  if (!input.executionEnabled && !honestException) return "EXECUTION_DISABLED";
  if (!honestException && !input.shadowGatePassed) return "SHADOW_GATE";
  if (!input.mandateActive || input.revoked) return input.revoked ? "REVOKED" : "MANDATE_INACTIVE";
  if (input.vetoed) return "VETOED";
  if (input.eligibility === "PROTECTED") return "INELIGIBLE";
  if (!honestException && input.eligibility !== "ELIGIBLE") return "INELIGIBLE";
  if (input.eligibility !== "ELIGIBLE" && input.eligibility !== "UNSUPPORTED_ROUTE") return "INELIGIBLE";
  if (!honestException && input.providerDisabled) return "PROVIDER_DISABLED";
  if (!honestException && !input.providerExecutable) return "UNSUPPORTED_ROUTE";
  if (!honestException) {
    if (!input.noticeDelivered || !input.vetoDeadline) return "NOTICE_NOT_DELIVERED";
    if (input.now.getTime() < input.vetoDeadline.getTime()) return "VETO_WINDOW_OPEN";
  }

  const context = {
    executionEnabled: input.executionEnabled,
    noticeDelivered: input.noticeDelivered,
    noticeEnabled: true,
    now: input.now,
    vetoDeadline: input.vetoDeadline,
    vetoed: input.vetoed,
    revoked: input.revoked,
  };
  const target: CandidateStatus = input.outcome === "EXECUTED"
    ? "EXECUTED"
    : input.outcome === "EXCEPTION"
      ? "EXCEPTION"
      : "FAILED";
  if (canTransitionCandidate(input.status, target, context)) return null;
  if (input.status === "AUTHORIZED_BY_RULE" && canTransitionCandidate("AUTHORIZED_BY_RULE", "IN_PROGRESS", context)) {
    if (canTransitionCandidate("IN_PROGRESS", target, context)) return null;
  }
  return "STATUS_NOT_AUTHORIZED";
}
