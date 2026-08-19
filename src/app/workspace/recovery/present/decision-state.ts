import type { CommitmentSummaryDto, DecisionOutcomeKind, HomeProjectionDto } from "@/lib/recovery/contracts";
import { formatDay } from "../labels";

export type DecisionStateTone = "due" | "keep" | "cancel" | "neutral";

export function commitmentDecisionStateLabel(
  commitment: CommitmentSummaryDto,
  home: HomeProjectionDto | null,
): string {
  return commitmentDecisionState(commitment, home).label;
}

export function commitmentDecisionState(
  commitment: CommitmentSummaryDto,
  home: HomeProjectionDto | null,
): { label: string; tone: DecisionStateTone } {
  const queued = home?.decisionQueue.some((card) => card.commitmentId === commitment.id) === true;
  if (queued) return { label: "Decision due", tone: "due" };
  const cycle = commitment.cycle;
  if (cycle?.action === "KEEP") return { label: "Keep", tone: "keep" };
  if (cycle?.action === "REVIEW_LATER") {
    return { label: cycle.reviewAt ? `Review ${formatDay(cycle.reviewAt)}` : "Review later", tone: "neutral" };
  }
  if (cycle?.action === "PLAN_TO_CANCEL") return { label: "Plan to cancel", tone: "cancel" };
  if (commitment.decision?.value === "KEEP") return { label: "Keep", tone: "keep" };
  if (commitment.decision?.value === "MONITOR") return { label: "Review later", tone: "neutral" };
  if (commitment.decision?.value === "CANCEL") return { label: "Plan to cancel", tone: "cancel" };
  return { label: "No decision yet", tone: "neutral" };
}

// An outcome that contradicts a recorded intent must be impossible to miss; a
// confirmed one stays quiet, and an unknown one never reads as attention.
export function decisionOutcomeTone(kind: DecisionOutcomeKind): "alert" | "settled" | "open" | "unknown" {
  if (kind === "CHARGE_AFTER_CANCEL_PLAN") return "alert";
  if (kind === "CONTINUED_AS_PLANNED") return "settled";
  if (kind === "CANNOT_VERIFY") return "unknown";
  return "open";
}
