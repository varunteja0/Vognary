// The product is this five-step loop. Landing, About, /start, the Control desk,
// and agent markdown must render the same sentences. A dashboard, expense
// tracker, or SaaS inventory is a different product; do not rewrite these
// steps into those jobs.

export const COMMITMENT_CONTROL_STEPS = [
  "Cite a bill you already have.",
  "Propose the next spend as an assumption.",
  "Policy annotates existing exposure. It does not decide.",
  "A named owner or admin freezes a cap, or declines.",
  "Later receipts are compared to that frozen cap.",
] as const;

export type CommitmentControlStep = 1 | 2 | 3 | 4 | 5;

export function commitmentControlStepLabel(step: CommitmentControlStep): string {
  return `${step} · ${COMMITMENT_CONTROL_STEPS[step - 1]}`;
}

export type CommitmentControlProgress = {
  citedEvidence: boolean;
  hasPolicy: boolean;
  awaitingHumanDecision: boolean;
  authorizedAwaitingEvidence: boolean;
};

/**
 * Current unique work on the desk, from live records only.
 * A human decision in queue outranks everything else — that is the product.
 * Policy-before-proposal, then cite, then the next assumption.
 */
export function activeCommitmentControlStep(
  progress: CommitmentControlProgress,
): CommitmentControlStep {
  if (progress.awaitingHumanDecision) return 4;
  if (progress.authorizedAwaitingEvidence) return 5;
  if (!progress.hasPolicy) return 3;
  if (!progress.citedEvidence) return 1;
  return 2;
}
