import type { ProposalPolicyEvaluation } from "./policy";
import { normalizeCurrency, parsePositiveMinorUnits, requireUuid } from "./money";
import { normalizeControlDateOnly } from "./outcome";
import { calendarDateInTimeZone } from "./project";

export const proposalDecisionActions = ["APPROVE", "APPROVE_WITH_CAP", "DECLINE"] as const;
export type ProposalDecisionAction = typeof proposalDecisionActions[number];
export type DecisionActorRole = "viewer" | "member" | "admin" | "owner";

export type AuthorizedProposalDecision = {
  proposalId: string;
  evaluationPolicyVersion: number;
  action: ProposalDecisionAction;
  approvedCapMinor: string | null;
  currency: string;
  expectedAmountMinor: string;
  decidedByUserId: string | null;
  decidedAt: string;
  authorizationExpiresOn: string | null;
  overrideReason: string | null;
};

export function authorizeProposalDecision(input: {
  actorRole: DecisionActorRole;
  actorUserId: string;
  evaluation: ProposalPolicyEvaluation;
  action: ProposalDecisionAction;
  approvedCapMinor?: string;
  authorizationExpiresOn?: string;
  outcomeReviewOn?: string;
  decidedAt?: string;
  submittedByUserId?: string | null;
  authorizingAdminCount?: number;
  overrideReason?: string;
}): AuthorizedProposalDecision {
  if (input.actorRole !== "admin" && input.actorRole !== "owner") {
    throw new Error("A workspace owner or admin must make the proposal decision.");
  }
  if (!proposalDecisionActions.includes(input.action)) throw new Error("Proposal decision action is not supported.");
  if (
    (input.authorizingAdminCount ?? 1) >= 2
    && input.submittedByUserId
    && input.submittedByUserId === input.actorUserId
  ) {
    throw new Error("A second owner or admin must record this decision.");
  }
  if (input.evaluation.status === "OUTSIDE_POLICY" && (input.action === "APPROVE" || input.action === "APPROVE_WITH_CAP")) {
    const override = input.overrideReason?.trim() ?? "";
    if (override.length < 1 || override.length > 500) {
      throw new Error("Approving an outside-policy proposal requires a written override reason.");
    }
  }
  const expectedAmount = parsePositiveMinorUnits(input.evaluation.proposal.amountMinor, "Expected proposal amount");
  let approvedCapMinor: string | null = null;
  if (input.action === "APPROVE") {
    if (input.approvedCapMinor !== undefined) throw new Error("APPROVE freezes the proposed per-charge amount and does not accept a separate cap.");
    approvedCapMinor = expectedAmount.toString();
  } else if (input.action === "APPROVE_WITH_CAP") {
    const cap = parsePositiveMinorUnits(input.approvedCapMinor, "Approved cap");
    if (cap > expectedAmount) throw new Error("Approved cap cannot exceed the proposed per-charge amount.");
    approvedCapMinor = cap.toString();
  } else if (input.approvedCapMinor !== undefined) {
    throw new Error("DECLINE cannot carry an approved cap.");
  }
  const decidedAt = new Date(input.decidedAt ?? new Date().toISOString());
  if (Number.isNaN(decidedAt.getTime())) throw new Error("Decision timestamp is invalid.");
  let authorizationExpiresOn: string | null = null;
  if (input.action === "DECLINE") {
    if (input.authorizationExpiresOn !== undefined) throw new Error("DECLINE cannot carry an authorization expiry.");
  } else {
    authorizationExpiresOn = normalizeControlDateOnly(input.authorizationExpiresOn, "Authorization expiry");
    if (authorizationExpiresOn < calendarDateInTimeZone(decidedAt, "Asia/Kolkata")) {
      throw new Error("Authorization expiry cannot be before the decision date.");
    }
    if (input.outcomeReviewOn !== undefined) {
      const outcomeReviewOn = normalizeControlDateOnly(input.outcomeReviewOn, "Outcome review date");
      if (authorizationExpiresOn > outcomeReviewOn) {
        throw new Error("Authorization expiry cannot be after the outcome review date.");
      }
    }
  }
  return {
    proposalId: requireUuid(input.evaluation.proposal.proposalId, "Proposal id"),
    evaluationPolicyVersion: input.evaluation.policyVersion,
    action: input.action,
    approvedCapMinor,
    currency: normalizeCurrency(input.evaluation.proposal.currency, "Decision currency"),
    expectedAmountMinor: expectedAmount.toString(),
    decidedByUserId: requireUuid(input.actorUserId, "Decision actor id"),
    decidedAt: decidedAt.toISOString(),
    authorizationExpiresOn,
    overrideReason: input.evaluation.status === "OUTSIDE_POLICY" && input.action !== "DECLINE"
      ? (input.overrideReason?.trim() ?? "")
      : null,
  };
}