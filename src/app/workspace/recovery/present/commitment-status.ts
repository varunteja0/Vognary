import type { CommitmentSummaryDto, ConfidenceState, Decision } from "@/lib/recovery/contracts";

/**
 * Customer status is a presentation overlay. It never totals money, never
 * re-ranks recurrence, and never invents a merchant. It only chooses which
 * quiet/exceptional word to put on a row the server already published.
 */
export const customerStatuses = ["ON_TRACK", "NEEDS_ATTENTION", "ESTIMATE", "PLANNED_CANCELLATION"] as const;
export type CustomerStatus = (typeof customerStatuses)[number];

export const customerStatusLabels: Record<CustomerStatus, string> = {
  ON_TRACK: "On track",
  NEEDS_ATTENTION: "Needs attention",
  ESTIMATE: "Estimate",
  PLANNED_CANCELLATION: "Planned cancellation",
};

export type CustomerStatusInput = {
  savedDecision: Decision | null;
  recommendedDecision: Decision;
  confidenceState: ConfidenceState;
  overlap: boolean;
};

export function toCustomerStatus(input: CustomerStatusInput): CustomerStatus {
  if (input.savedDecision === "CANCEL") return "PLANNED_CANCELLATION";
  if (input.savedDecision === "KEEP" && !input.overlap && input.confidenceState !== "LOW" && input.confidenceState !== "UNKNOWN") {
    return "ON_TRACK";
  }
  if (input.confidenceState === "LOW" || input.confidenceState === "UNKNOWN") return "ESTIMATE";
  if (input.overlap) return "NEEDS_ATTENTION";
  if (input.savedDecision === "MONITOR" || input.savedDecision === "INVESTIGATE") return "NEEDS_ATTENTION";
  if (!input.savedDecision && input.recommendedDecision !== "KEEP") return "NEEDS_ATTENTION";
  return "ON_TRACK";
}

export function customerStatusForCommitment(
  commitment: Pick<CommitmentSummaryDto, "decision" | "recommendedDecision" | "confidence">,
  overlap: boolean,
): CustomerStatus {
  return toCustomerStatus({
    savedDecision: commitment.decision?.value ?? null,
    recommendedDecision: commitment.recommendedDecision,
    confidenceState: commitment.confidence.state,
    overlap,
  });
}

export function commitmentNeedsAttention(
  commitment: Pick<CommitmentSummaryDto, "decision" | "recommendedDecision" | "confidence">,
  overlap: boolean,
): boolean {
  const status = customerStatusForCommitment(commitment, overlap);
  return status === "NEEDS_ATTENTION" || status === "ESTIMATE";
}
