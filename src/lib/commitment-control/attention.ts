import type { CommitmentControlBriefDto } from "./contracts";
import type { ControlExceptionTargetKind } from "./contracts";
import { isCanonicalControlDateOnly } from "./validation";

export type ControlAttentionKind =
  | "DECISION_REQUIRED"
  | "EVIDENCE_DUE"
  | "AUTHORIZATION_EXPIRING"
  | "AUTHORIZATION_EXPIRED"
  | "OUTCOME_REVIEW_APPROACHING"
  | "OUTCOME_REVIEW_DUE"
  | "RECONCILIATION_EXCEPTION"
  | "OUTCOME_MISSED";

export type ControlAttentionUrgency = "NOW" | "SOON";

export type ControlAttentionNextStep =
  | "DECIDE_PROPOSAL"
  | "LINK_EVIDENCE"
  | "RECORD_OUTCOME"
  | "REVIEW_EXCEPTION"
  | "REVIEW_RECORD";

export type ControlAttentionItem = {
  id: string;
  kind: ControlAttentionKind;
  proposalId: string;
  merchant: string;
  headline: string;
  body: string;
  urgency: ControlAttentionUrgency;
  nextStep: ControlAttentionNextStep;
  dueOn: string;
  targetKind?: ControlExceptionTargetKind;
  targetId?: string;
};

type ControlProposalEntry = CommitmentControlBriefDto["proposals"][number];

const urgencyRank: Record<ControlAttentionUrgency, number> = { NOW: 0, SOON: 1 };
const kindRank: Record<ControlAttentionKind, number> = {
  RECONCILIATION_EXCEPTION: 0,
  AUTHORIZATION_EXPIRED: 1,
  OUTCOME_MISSED: 2,
  DECISION_REQUIRED: 3,
  EVIDENCE_DUE: 4,
  OUTCOME_REVIEW_DUE: 5,
  AUTHORIZATION_EXPIRING: 6,
  OUTCOME_REVIEW_APPROACHING: 7,
};
const adverseCostVerdicts = new Set([
  "OVER_CAP",
  "CURRENCY_MISMATCH",
  "CANNOT_EVALUATE",
  "AUTHORIZATION_EXPIRED",
]);
const dayMilliseconds = 24 * 60 * 60 * 1_000;

export function buildControlAttention(
  entries: readonly ControlProposalEntry[],
  options: { today: string },
): readonly ControlAttentionItem[] {
  if (!isCanonicalControlDateOnly(options.today)) {
    throw new Error("Control attention requires a valid calendar date.");
  }

  const attention: ControlAttentionItem[] = [];
  for (const entry of entries) {
    const { proposal, evaluation, decision, reconciliations, outcomeObservations, exceptionReviews } = entry;
    if (evaluation !== null && decision === null) {
      attention.push(item(entry, {
        kind: "DECISION_REQUIRED",
        headline: "Decision needed",
        body: "Review the cited exposure and policy result before the first charge.",
        urgency: "NOW",
        nextStep: "DECIDE_PROPOSAL",
        dueOn: proposal.firstChargeDate,
      }));
      continue;
    }
    if (decision === null || decision.action === "DECLINE") continue;

    const reviewedTargets = new Set(exceptionReviews.map((review) => `${review.targetKind}:${review.targetId}`));
    const latest = latestReconciliation(reconciliations);
    for (const reconciliation of reconciliations) {
      const targetReviewed = reviewedTargets.has(`RECONCILIATION:${reconciliation.id}`);
      if (adverseCostVerdicts.has(reconciliation.verdict) && !targetReviewed) {
        attention.push(item(entry, {
          kind: "RECONCILIATION_EXCEPTION",
          headline: "Reconciliation needs review",
          body: reconciliationExceptionBody(reconciliation.verdict),
          urgency: "NOW",
          nextStep: "REVIEW_EXCEPTION",
          targetKind: "RECONCILIATION",
          targetId: reconciliation.id,
          dueOn: reconciliation.observedEvidenceDate ?? reconciliation.reconciledAt.slice(0, 10),
        }, reconciliation.id));
      }
      if (reconciliation.outcome?.verdict === "MISSED" && !targetReviewed) {
        attention.push(item(entry, {
          kind: "OUTCOME_MISSED",
          headline: "Outcome missed",
          body: `The user-entered observation did not meet the frozen ${reconciliation.outcome.metric} target.`,
          urgency: "NOW",
          nextStep: "REVIEW_EXCEPTION",
          targetKind: "RECONCILIATION",
          targetId: reconciliation.id,
          dueOn: reconciliation.outcome.observedOn ?? reconciliation.outcome.reviewOn,
        }, reconciliation.id));
      }
    }
    for (const observation of outcomeObservations) {
      if (observation.verdict !== "MISSED"
        || reviewedTargets.has(`OUTCOME_OBSERVATION:${observation.id}`)) continue;
      attention.push(item(entry, {
        kind: "OUTCOME_MISSED",
        headline: "Outcome missed",
        body: `The user-entered observation did not meet the frozen ${observation.target.metric} target.`,
        urgency: "NOW",
        nextStep: "REVIEW_EXCEPTION",
        targetKind: "OUTCOME_OBSERVATION",
        targetId: observation.id,
        dueOn: observation.observedOn,
      }, observation.id));
    }

    if (!latest) {
      if (proposal.firstChargeDate <= options.today) {
        attention.push(item(entry, {
          kind: "EVIDENCE_DUE",
          headline: "Evidence needs linking",
          body: "The first charge date has arrived, but no receipt is linked to the frozen authorization.",
          urgency: "NOW",
          nextStep: "LINK_EVIDENCE",
          dueOn: proposal.firstChargeDate,
        }));
      }
      if (decision.authorizationExpiresOn !== null) {
        const daysToExpiry = daysBetween(options.today, decision.authorizationExpiresOn);
        if (daysToExpiry < 0) {
          attention.push(item(entry, {
            kind: "AUTHORIZATION_EXPIRED",
            headline: "Authorization window ended",
            body: `No receipt is linked, and the frozen authorization expired on ${decision.authorizationExpiresOn}.`,
            urgency: "NOW",
            nextStep: "REVIEW_RECORD",
            dueOn: decision.authorizationExpiresOn,
          }));
        } else if (daysToExpiry <= 7) {
          attention.push(item(entry, {
            kind: "AUTHORIZATION_EXPIRING",
            headline: "Authorization expires soon",
            body: `No receipt is linked yet. The frozen authorization expires on ${decision.authorizationExpiresOn}.`,
            urgency: "NOW",
            nextStep: "LINK_EVIDENCE",
            dueOn: decision.authorizationExpiresOn,
          }));
        }
      }
    }

    const intendedOutcome = proposal.intendedOutcome;
    const outcomeObserved = outcomeObservations.length > 0 || reconciliations.some((reconciliation) =>
      reconciliation.outcome?.verdict === "MET" || reconciliation.outcome?.verdict === "MISSED");
    if (intendedOutcome !== null && !outcomeObserved) {
      const daysToReview = daysBetween(options.today, intendedOutcome.reviewOn);
      if (daysToReview <= 0) {
        attention.push(item(entry, {
          kind: "OUTCOME_REVIEW_DUE",
          headline: "Outcome review is due",
          body: `No outcome observation is recorded. Review ${intendedOutcome.metric} for ${intendedOutcome.reviewOn}.`,
          urgency: "NOW",
          nextStep: "RECORD_OUTCOME",
          dueOn: intendedOutcome.reviewOn,
        }));
      } else if (daysToReview <= 7) {
        attention.push(item(entry, {
          kind: "OUTCOME_REVIEW_APPROACHING",
          headline: "Outcome review is approaching",
          body: `No outcome observation is recorded. Review ${intendedOutcome.metric} on ${intendedOutcome.reviewOn}.`,
          urgency: "SOON",
          nextStep: "REVIEW_RECORD",
          dueOn: intendedOutcome.reviewOn,
        }));
      }
    }
  }

  return attention.sort((left, right) => urgencyRank[left.urgency] - urgencyRank[right.urgency]
    || left.dueOn.localeCompare(right.dueOn)
    || kindRank[left.kind] - kindRank[right.kind]
    || left.proposalId.localeCompare(right.proposalId)
    || left.id.localeCompare(right.id));
}

/** Email interrupts once per proposal; the in-app surface keeps the complete list. */
export function primaryControlAttention(
  items: readonly ControlAttentionItem[],
): readonly ControlAttentionItem[] {
  const primaryByProposal = new Map<string, ControlAttentionItem>();
  for (const item of items) {
    const current = primaryByProposal.get(item.proposalId);
    if (!current
      || kindRank[item.kind] < kindRank[current.kind]
      || (kindRank[item.kind] === kindRank[current.kind] && item.dueOn < current.dueOn)) {
      primaryByProposal.set(item.proposalId, item);
    }
  }
  return [...primaryByProposal.values()].sort((left, right) =>
    urgencyRank[left.urgency] - urgencyRank[right.urgency]
    || left.dueOn.localeCompare(right.dueOn)
    || kindRank[left.kind] - kindRank[right.kind]
    || left.proposalId.localeCompare(right.proposalId)
    || left.id.localeCompare(right.id));
}

function item(
  entry: ControlProposalEntry,
  value: Omit<ControlAttentionItem, "id" | "proposalId" | "merchant">,
  occurrenceId?: string,
): ControlAttentionItem {
  return {
    id: `${value.kind}:${entry.proposal.id}${occurrenceId ? `:${occurrenceId}` : ""}`,
    proposalId: entry.proposal.id,
    merchant: entry.proposal.merchant,
    ...value,
  };
}

function daysBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  return Math.round((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / dayMilliseconds);
}

function latestReconciliation(reconciliations: ControlProposalEntry["reconciliations"]) {
  return reconciliations.reduce<(typeof reconciliations)[number] | null>((latest, candidate) =>
    latest === null || candidate.reconciledAt > latest.reconciledAt ? candidate : latest, null);
}

function reconciliationExceptionBody(verdict: ControlProposalEntry["reconciliations"][number]["verdict"]): string {
  switch (verdict) {
    case "OVER_CAP":
      return "The observed cost is above the frozen cap. The authorization itself has not changed.";
    case "CURRENCY_MISMATCH":
      return "The observed and authorized currencies differ, so Vognary did not compare the amounts.";
    case "CANNOT_EVALUATE":
      return "The linked evidence has no comparable amount and currency.";
    case "AUTHORIZATION_EXPIRED":
      return "The observed evidence date is after the frozen authorization window.";
    case "MATCHED":
    case "WITHIN_CAP":
      return "The observed cost is within the frozen authorization.";
  }
}