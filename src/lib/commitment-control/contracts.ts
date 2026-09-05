import { proposalDecisionActions, type ProposalDecisionAction } from "./decision";
import { normalizeCurrency, parsePositiveMinorUnits, requireUuid } from "./money";
import {
  isControlOutcomeReconciliation,
  isIntendedControlOutcome,
  normalizeControlOutcomeObservation,
  normalizeIntendedControlOutcome,
  type ControlOutcomeObservation,
  type ControlOutcomeReconciliation,
  type IntendedControlOutcome,
} from "./outcome";
import type { CategoryPosture, PolicyReasonCode, ProposalCategory, ProposalPolicy, ProposalPolicyEvaluation } from "./policy";
import { assertRecordableControlPolicy } from "./policy";
import { proposalCadences, type ProposalCadence } from "./project";
import {
  boundedControlText as boundedText,
  isCanonicalControlDateOnly as isDateOnly,
  rejectUnknownControlFields as rejectUnknown,
  requireControlRecord as requireRecord,
} from "./validation";

export type PutControlPolicyRequest = Omit<ProposalPolicy, "policyVersion">;
export type CreateControlProposalRequest = {
  merchant: string;
  purpose: string;
  category: ProposalCategory;
  amountMinor: string;
  currency: string;
  firstChargeDate: string;
  cadence: ProposalCadence;
  existingCommitmentIds: string[];
  intendedOutcome: IntendedControlOutcome;
};
export type DecideControlProposalRequest = {
  action: ProposalDecisionAction;
  approvedCapMinor?: string;
  authorizationExpiresOn?: string;
  overrideReason?: string;
};
export type ReconcileControlProposalRequest = {
  evidenceId: string;
  observedOutcome?: ControlOutcomeObservation;
};
export type RecordControlOutcomeObservationRequest = {
  observedOutcome: ControlOutcomeObservation;
};
export type RecordControlExceptionReviewRequest = {
  targetKind: ControlExceptionTargetKind;
  targetId: string;
  disposition: ControlExceptionDisposition;
  note: string;
};

export type ControlPolicyDto = ProposalPolicy & {
  createdByUserId: string | null;
  createdAt: string;
};

export type ControlProposalDto = {
  id: string;
  submittedByUserId: string | null;
  submittedByDisplayName: string | null;
  merchant: string;
  purpose: string;
  category: ProposalCategory;
  amountMinor: string;
  currency: string;
  firstChargeDate: string;
  cadence: ProposalCadence;
  asOfDate: string;
  projectedThirteenWeekMinor: string;
  projectedAnnualMinor: string;
  intendedOutcome: IntendedControlOutcome | null;
  assumptionBasis: "USER_ENTERED_ASSUMPTION";
  createdAt: string;
};

export type ControlEvaluationDto = Omit<ProposalPolicyEvaluation, "proposal"> & {
  id: string;
  proposalId: string;
  evaluatedAt: string;
};

export type ControlDecisionDto = {
  id: string;
  evaluationId: string;
  proposalId: string;
  evaluationPolicyVersion: number;
  action: ProposalDecisionAction;
  approvedCapMinor: string | null;
  currency: string;
  expectedAmountMinor: string;
  decidedByUserId: string | null;
  decidedByDisplayName: string | null;
  overrideReason: string | null;
  decidedAt: string;
  authorizationExpiresOn: string | null;
};

export type ControlReconciliationDto = {
  id: string;
  proposalId: string;
  decisionId: string;
  evidenceId: string;
  verdict: "MATCHED" | "WITHIN_CAP" | "OVER_CAP" | "CURRENCY_MISMATCH" | "CANNOT_EVALUATE" | "AUTHORIZATION_EXPIRED";
  expectedAmountMinor: string;
  approvedCapMinor: string | null;
  authorizationCurrency: string;
  observedAmountMinor: string | null;
  observedCurrency: string | null;
  observedEvidenceDate: string | null;
  outcome: ControlOutcomeReconciliation | null;
  reconciledByUserId: string | null;
  reconciledAt: string;
};

export const controlExceptionTargetKinds = ["RECONCILIATION", "OUTCOME_OBSERVATION"] as const;
export type ControlExceptionTargetKind = typeof controlExceptionTargetKinds[number];

export const controlExceptionDispositions = [
  "NO_FURTHER_ACTION",
  "NEW_PROPOSAL_REQUIRED",
  "CORRECTED_OUTSIDE_VOGNARY",
] as const;
export type ControlExceptionDisposition = typeof controlExceptionDispositions[number];

/** A user-entered business outcome. It cites no receipt because a receipt cannot prove it. */
export type ControlOutcomeObservationDto = {
  id: string;
  proposalId: string;
  decisionId: string;
  observedValue: string;
  observedOn: string;
  target: IntendedControlOutcome;
  observationBasis: "USER_ENTERED_OBSERVATION";
  verdict: "MET" | "MISSED";
  observedByUserId: string | null;
  observedAt: string;
};

export type ControlExceptionReviewDto = {
  id: string;
  proposalId: string;
  decisionId: string;
  targetKind: ControlExceptionTargetKind;
  targetId: string;
  disposition: ControlExceptionDisposition;
  note: string;
  reviewedByUserId: string | null;
  reviewedAt: string;
};

export type CommitmentControlBriefDto = {
  policy: ControlPolicyDto | null;
  proposals: Array<{
    proposal: ControlProposalDto;
    evaluation: ControlEvaluationDto | null;
    decision: ControlDecisionDto | null;
    reconciliations: ControlReconciliationDto[];
    outcomeObservations: ControlOutcomeObservationDto[];
    exceptionReviews: ControlExceptionReviewDto[];
  }>;
  capabilities: {
    canSubmitProposal: boolean;
    canDecide: boolean;
    canConfigurePolicy: boolean;
  };
};

export type ControlPolicyWriteDto = { policy: ControlPolicyDto };
export type ControlProposalWriteDto = { proposal: ControlProposalDto; evaluation: ControlEvaluationDto };
export type ControlDecisionWriteDto = { decision: ControlDecisionDto };
export type ControlReconciliationWriteDto = {
  proposal: ControlProposalDto;
  decision: ControlDecisionDto;
  reconciliation: ControlReconciliationDto;
};
export type ControlOutcomeObservationWriteDto = {
  proposal: ControlProposalDto;
  decision: ControlDecisionDto;
  observation: ControlOutcomeObservationDto;
};
export type ControlExceptionReviewWriteDto = { review: ControlExceptionReviewDto };

export const commitmentControlEndpoints = {
  brief: { method: "GET" as const, path: "/api/workspaces/current/control/brief" },
  policy: { method: "GET" as const, path: "/api/workspaces/current/control/policy" },
  putPolicy: { method: "PUT" as const, path: "/api/workspaces/current/control/policy" },
  proposals: { method: "POST" as const, path: "/api/workspaces/current/control/proposals" },
  decision: (proposalId: string) => ({
    method: "POST" as const,
    path: `/api/workspaces/current/control/proposals/${encodeURIComponent(proposalId)}/decision`,
  }),
  reconciliations: (proposalId: string) => ({
    method: "POST" as const,
    path: `/api/workspaces/current/control/proposals/${encodeURIComponent(proposalId)}/reconciliations`,
  }),
  reconciliationCandidates: (proposalId: string) => ({
    method: "GET" as const,
    path: `/api/workspaces/current/control/proposals/${encodeURIComponent(proposalId)}/reconciliation-candidates`,
  }),
  outcome: (proposalId: string) => ({
    method: "POST" as const,
    path: `/api/workspaces/current/control/proposals/${encodeURIComponent(proposalId)}/outcome`,
  }),
  exceptionReviews: (proposalId: string) => ({
    method: "POST" as const,
    path: `/api/workspaces/current/control/proposals/${encodeURIComponent(proposalId)}/exception-reviews`,
  }),
} as const;

export function isCommitmentControlBriefDto(value: unknown): value is CommitmentControlBriefDto {
  if (!isRecord(value) || !(value.policy === null || isControlPolicyDto(value.policy)) || !Array.isArray(value.proposals)) return false;
  if (!isRecord(value.capabilities)
    || typeof value.capabilities.canSubmitProposal !== "boolean"
    || typeof value.capabilities.canDecide !== "boolean"
    || typeof value.capabilities.canConfigurePolicy !== "boolean") return false;
  return value.proposals.every((entry) => {
    if (!isRecord(entry)) return false;
    const proposal = entry.proposal;
    const evaluation = entry.evaluation;
    const decision = entry.decision;
    const reconciliations = entry.reconciliations;
    if (!isControlProposalDto(proposal)) return false;
    if (!(evaluation === null || isControlEvaluationDto(evaluation))) return false;
    if (evaluation && !evaluationMatchesProposal(evaluation, proposal)) return false;
    if (!(decision === null || isControlDecisionDto(decision))) return false;
    if (decision && (
      decision.proposalId !== proposal.id
      || !evaluation
      || decision.evaluationId !== evaluation.id
      || decision.evaluationPolicyVersion !== evaluation.policyVersion
      || decision.expectedAmountMinor !== proposal.amountMinor
      || decision.currency !== proposal.currency
      || !decisionMatchesProposalEnvelope(decision, proposal)
    )) return false;
    if (!Array.isArray(reconciliations) || !reconciliations.every(isControlReconciliationDto)) return false;
    if (reconciliations.length && (!decision || decision.action === "DECLINE")) return false;
    if (!reconciliations.every((reconciliation) => decision !== null
      && reconciliation.proposalId === proposal.id
      && reconciliation.decisionId === decision.id
      && reconciliation.expectedAmountMinor === decision.expectedAmountMinor
      && reconciliation.approvedCapMinor === decision.approvedCapMinor
      && reconciliation.authorizationCurrency === decision.currency
      && reconciliationMatchesDecisionWindow(reconciliation, decision)
      && outcomeMatchesProposal(reconciliation.outcome, proposal.intendedOutcome))) return false;
    return followThroughMatchesEnvelope(entry.outcomeObservations, entry.exceptionReviews, proposal, decision, reconciliations);
  });
}

/**
 * A proposal holds at most one observed outcome in total, wherever it was
 * recorded, and a disposition exists only against an adverse record on the same
 * authorized decision.
 */
function followThroughMatchesEnvelope(
  outcomeObservations: unknown,
  exceptionReviews: unknown,
  proposal: ControlProposalDto,
  decision: ControlDecisionDto | null,
  reconciliations: readonly ControlReconciliationDto[],
) {
  if (!Array.isArray(outcomeObservations) || !outcomeObservations.every(isControlOutcomeObservationDto)) return false;
  if (!Array.isArray(exceptionReviews) || !exceptionReviews.every(isControlExceptionReviewDto)) return false;
  if ((outcomeObservations.length || exceptionReviews.length) && (!decision || decision.action === "DECLINE")) return false;
  if (outcomeObservations.length > 1) return false;
  if (outcomeObservations.length && reconciliations.some((entry) => entry.outcome?.verdict === "MET" || entry.outcome?.verdict === "MISSED")) return false;
  if (!outcomeObservations.every((observation) => decision !== null
    && observation.proposalId === proposal.id
    && observation.decisionId === decision.id
    && proposal.intendedOutcome !== null
    && targetMatchesIntendedOutcome(observation.target, proposal.intendedOutcome))) return false;

  const adverseReconciliations = new Set(reconciliations
    .filter((entry) => adverseReconciliationVerdicts.has(entry.verdict) || entry.outcome?.verdict === "MISSED")
    .map((entry) => entry.id));
  const adverseObservations = new Set(outcomeObservations
    .filter((observation) => observation.verdict === "MISSED")
    .map((observation) => observation.id));
  const reviewedTargets = new Set<string>();
  return exceptionReviews.every((review) => {
    if (decision === null
      || review.proposalId !== proposal.id
      || review.decisionId !== decision.id
      || reviewedTargets.has(review.targetId)) return false;
    reviewedTargets.add(review.targetId);
    return review.targetKind === "RECONCILIATION"
      ? adverseReconciliations.has(review.targetId)
      : adverseObservations.has(review.targetId);
  });
}

export function isControlPolicyWriteDto(value: unknown): value is ControlPolicyWriteDto {
  return isRecord(value) && isControlPolicyDto(value.policy);
}

export function isControlProposalWriteDto(value: unknown): value is ControlProposalWriteDto {
  return isRecord(value)
    && isControlProposalDto(value.proposal)
    && isControlEvaluationDto(value.evaluation)
    && evaluationMatchesProposal(value.evaluation, value.proposal);
}

export function isControlDecisionWriteDto(value: unknown): value is ControlDecisionWriteDto {
  return isRecord(value)
    && isControlDecisionDto(value.decision)
    && (value.decision.action === "DECLINE" || value.decision.authorizationExpiresOn !== null);
}

export function isControlReconciliationWriteDto(value: unknown): value is ControlReconciliationWriteDto {
  return isRecord(value)
    && isControlProposalDto(value.proposal)
    && isControlDecisionDto(value.decision)
    && value.decision.action !== "DECLINE"
    && value.decision.proposalId === value.proposal.id
    && value.decision.expectedAmountMinor === value.proposal.amountMinor
    && value.decision.currency === value.proposal.currency
    && decisionMatchesProposalEnvelope(value.decision, value.proposal)
    && isControlReconciliationDto(value.reconciliation)
    && value.reconciliation.proposalId === value.decision.proposalId
    && value.reconciliation.decisionId === value.decision.id
    && value.reconciliation.expectedAmountMinor === value.decision.expectedAmountMinor
    && value.reconciliation.approvedCapMinor === value.decision.approvedCapMinor
    && value.reconciliation.authorizationCurrency === value.decision.currency
    && reconciliationMatchesDecisionWindow(value.reconciliation, value.decision)
    && outcomeMatchesProposal(value.reconciliation.outcome, value.proposal.intendedOutcome);
}

export function isControlOutcomeObservationWriteDto(value: unknown): value is ControlOutcomeObservationWriteDto {
  return isRecord(value)
    && isControlProposalDto(value.proposal)
    && isControlDecisionDto(value.decision)
    && value.decision.action !== "DECLINE"
    && value.decision.proposalId === value.proposal.id
    && decisionMatchesProposalEnvelope(value.decision, value.proposal)
    && isControlOutcomeObservationDto(value.observation)
    && value.observation.proposalId === value.proposal.id
    && value.observation.decisionId === value.decision.id
    && value.proposal.intendedOutcome !== null
    && targetMatchesIntendedOutcome(value.observation.target, value.proposal.intendedOutcome);
}

export function isControlExceptionReviewWriteDto(value: unknown): value is ControlExceptionReviewWriteDto {
  return isRecord(value) && isControlExceptionReviewDto(value.review);
}

function isControlOutcomeObservationDto(value: unknown): value is ControlOutcomeObservationDto {
  if (!isRecord(value)
    || !isUuid(value.id)
    || !isUuid(value.proposalId)
    || !isUuid(value.decisionId)
    || !isIntendedControlOutcome(value.target)
    || value.observationBasis !== "USER_ENTERED_OBSERVATION"
    || (value.verdict !== "MET" && value.verdict !== "MISSED")
    || !isNullableUuid(value.observedByUserId)
    || !isTimestamp(value.observedAt)
    || typeof value.observedValue !== "string"
    || typeof value.observedOn !== "string") return false;
  const target = value.target;
  const expected = isControlOutcomeReconciliation({
    ...target,
    observedValue: value.observedValue,
    observedOn: value.observedOn,
    observationBasis: "USER_ENTERED_OBSERVATION",
    verdict: value.verdict,
  });
  return expected;
}

function isControlExceptionReviewDto(value: unknown): value is ControlExceptionReviewDto {
  return isRecord(value)
    && isUuid(value.id)
    && isUuid(value.proposalId)
    && isUuid(value.decisionId)
    && typeof value.targetKind === "string"
    && controlExceptionTargetKinds.includes(value.targetKind as ControlExceptionTargetKind)
    && isUuid(value.targetId)
    && typeof value.disposition === "string"
    && controlExceptionDispositions.includes(value.disposition as ControlExceptionDisposition)
    && isBoundedText(value.note, 1, 500)
    && isNullableUuid(value.reviewedByUserId)
    && isTimestamp(value.reviewedAt);
}

function targetMatchesIntendedOutcome(target: IntendedControlOutcome, intended: IntendedControlOutcome) {
  return target.metric === intended.metric
    && target.targetDirection === intended.targetDirection
    && target.targetValue === intended.targetValue
    && target.unit === intended.unit
    && target.reviewOn === intended.reviewOn;
}

function isControlPolicyDto(value: unknown): value is ControlPolicyDto {
  if (!isRecord(value)
    || !isPositiveInteger(value.policyVersion)
    || !Array.isArray(value.categoryRules)
    || !Array.isArray(value.currencyLimits)
    || !isNullableUuid(value.createdByUserId)
    || !isTimestamp(value.createdAt)) return false;
  const categories = new Set<string>();
  for (const rule of value.categoryRules) {
    if (!isRecord(rule)
      || typeof rule.category !== "string"
      || !proposalCategories.includes(rule.category as ProposalCategory)
      || typeof rule.posture !== "string"
      || !categoryPostures.includes(rule.posture as CategoryPosture)
      || categories.has(rule.category)) return false;
    categories.add(rule.category);
  }
  const currencies = new Set<string>();
  for (const limit of value.currencyLimits) {
    if (!isRecord(limit)
      || !isCurrency(limit.currency)
      || !isPositiveMinorUnits(limit.maxPerChargeMinor)
      || !isPositiveMinorUnits(limit.maxThirteenWeekMinor)
      || !isPositiveMinorUnits(limit.maxAnnualMinor)
      || currencies.has(limit.currency)) return false;
    currencies.add(limit.currency);
  }
  return true;
}

function isControlProposalDto(value: unknown): value is ControlProposalDto {
  return isRecord(value)
    && isUuid(value.id)
    && isNullableUuid(value.submittedByUserId)
    && (value.submittedByDisplayName === null || isBoundedText(value.submittedByDisplayName, 1, 120))
    && isBoundedText(value.merchant, 1, 240)
    && isBoundedText(value.purpose, 1, 500)
    && typeof value.category === "string"
    && proposalCategories.includes(value.category as ProposalCategory)
    && isPositiveMinorUnits(value.amountMinor)
    && isCurrency(value.currency)
    && isDateOnly(value.firstChargeDate)
    && typeof value.cadence === "string"
    && proposalCadences.includes(value.cadence as ProposalCadence)
    && isDateOnly(value.asOfDate)
    && value.firstChargeDate >= value.asOfDate
    && isMinorUnits(value.projectedThirteenWeekMinor)
    && isMinorUnits(value.projectedAnnualMinor)
    && (value.intendedOutcome === null || isIntendedControlOutcome(value.intendedOutcome))
    && value.assumptionBasis === "USER_ENTERED_ASSUMPTION"
    && isTimestamp(value.createdAt);
}

function isControlEvaluationDto(value: unknown): value is ControlEvaluationDto {
  if (!isRecord(value)
    || !isUuid(value.id)
    || !isUuid(value.proposalId)
    || !isPositiveInteger(value.policyVersion)
    || !["WITHIN_POLICY", "REVIEW_REQUIRED", "OUTSIDE_POLICY"].includes(String(value.status))
    || value.humanDecisionRequired !== true
    || !Array.isArray(value.assumptionFields)
    || value.assumptionFields.join("|") !== "amountMinor|currency|category|thirteenWeekMinor|annualMinor"
    || !Array.isArray(value.citedEvidenceIds)
    || !value.citedEvidenceIds.every(isUuid)
    || !Array.isArray(value.reasonCodes)
    || !value.reasonCodes.every((reason) => typeof reason === "string" && policyReasonCodes.includes(reason as PolicyReasonCode))
    || !["NONE", "PROJECTED", "OBSERVATION_ONLY"].includes(String(value.citedExposureBasis))
    || !Array.isArray(value.currencyResults)
    || !value.currencyResults.length
    || !isTimestamp(value.evaluatedAt)) return false;
  const currencies = new Set<string>();
  return value.currencyResults.every((result) => {
    if (!isRecord(result)
      || !isCurrency(result.currency)
      || currencies.has(result.currency)
      || !isMinorUnits(result.existingThirteenWeekMinor)
      || !isMinorUnits(result.proposedThirteenWeekMinor)
      || !isMinorUnits(result.combinedThirteenWeekMinor)
      || !isNullableMinorUnits(result.thirteenWeekHeadroomMinor)
      || !isMinorUnits(result.existingAnnualMinor)
      || !isMinorUnits(result.proposedAnnualMinor)
      || !isMinorUnits(result.combinedAnnualMinor)
      || !isNullableMinorUnits(result.annualHeadroomMinor)) return false;
    currencies.add(result.currency);
    return BigInt(result.combinedThirteenWeekMinor) === BigInt(result.existingThirteenWeekMinor) + BigInt(result.proposedThirteenWeekMinor)
      && BigInt(result.combinedAnnualMinor) === BigInt(result.existingAnnualMinor) + BigInt(result.proposedAnnualMinor);
  });
}

function evaluationMatchesProposal(evaluation: ControlEvaluationDto, proposal: ControlProposalDto) {
  const proposalCurrency = evaluation.currencyResults.find((result) => result.currency === proposal.currency);
  return evaluation.proposalId === proposal.id
    && proposalCurrency !== undefined
    && proposalCurrency.proposedThirteenWeekMinor === proposal.projectedThirteenWeekMinor
    && proposalCurrency.proposedAnnualMinor === proposal.projectedAnnualMinor;
}

function isControlDecisionDto(value: unknown): value is ControlDecisionDto {
  if (!isRecord(value)
    || !isUuid(value.id)
    || !isUuid(value.evaluationId)
    || !isUuid(value.proposalId)
    || !isPositiveInteger(value.evaluationPolicyVersion)
    || typeof value.action !== "string"
    || !proposalDecisionActions.includes(value.action as ProposalDecisionAction)
    || !isPositiveMinorUnits(value.expectedAmountMinor)
    || !isNullableMinorUnits(value.approvedCapMinor)
    || !isCurrency(value.currency)
    || !isNullableUuid(value.decidedByUserId)
    || !(value.decidedByDisplayName === null || isBoundedText(value.decidedByDisplayName, 1, 120))
    || !(value.overrideReason === null || isBoundedText(value.overrideReason, 1, 500))
    || !isTimestamp(value.decidedAt)
    || !(value.authorizationExpiresOn === null || isDateOnly(value.authorizationExpiresOn))) return false;
  if (value.authorizationExpiresOn !== null && value.authorizationExpiresOn < value.decidedAt.slice(0, 10)) return false;
  if (value.action === "DECLINE") return value.approvedCapMinor === null && value.authorizationExpiresOn === null;
  if (value.approvedCapMinor === null) return false;
  if (value.action === "APPROVE") return value.approvedCapMinor === value.expectedAmountMinor;
  return BigInt(value.approvedCapMinor) <= BigInt(value.expectedAmountMinor);
}

function isControlReconciliationDto(value: unknown): value is ControlReconciliationDto {
  if (!isRecord(value)
    || !isUuid(value.id)
    || !isUuid(value.proposalId)
    || !isUuid(value.decisionId)
    || !isUuid(value.evidenceId)
    || !["MATCHED", "WITHIN_CAP", "OVER_CAP", "CURRENCY_MISMATCH", "CANNOT_EVALUATE", "AUTHORIZATION_EXPIRED"].includes(String(value.verdict))
    || !isPositiveMinorUnits(value.expectedAmountMinor)
    || !isNullableMinorUnits(value.approvedCapMinor)
    || !isCurrency(value.authorizationCurrency)
    || !isNullableMinorUnits(value.observedAmountMinor)
    || !(value.observedCurrency === null || isCurrency(value.observedCurrency))
    || !(value.observedEvidenceDate === null || isDateOnly(value.observedEvidenceDate))
    || !(value.outcome === null || isControlOutcomeReconciliation(value.outcome))
    || !isNullableUuid(value.reconciledByUserId)
    || !isTimestamp(value.reconciledAt)) return false;
  if (value.verdict === "AUTHORIZATION_EXPIRED") {
    return value.observedEvidenceDate !== null
      && value.observedAmountMinor !== null
      && value.observedCurrency !== null;
  }
  if (value.verdict === "CANNOT_EVALUATE") return value.observedAmountMinor === null || value.observedCurrency === null;
  if (value.verdict === "CURRENCY_MISMATCH") return value.observedCurrency !== null && value.observedCurrency !== value.authorizationCurrency;
  if (value.observedAmountMinor === null || value.observedCurrency !== value.authorizationCurrency || value.approvedCapMinor === null) return false;
  const observed = BigInt(value.observedAmountMinor);
  const expected = BigInt(value.expectedAmountMinor);
  const cap = BigInt(value.approvedCapMinor);
  if (value.verdict === "MATCHED") return observed === expected && observed <= cap;
  if (value.verdict === "OVER_CAP") return observed > cap;
  return observed <= cap && observed !== expected;
}

function decisionMatchesProposalEnvelope(decision: ControlDecisionDto, proposal: ControlProposalDto) {
  if (proposal.intendedOutcome === null) return true;
  if (decision.action === "DECLINE") return decision.authorizationExpiresOn === null;
  return decision.authorizationExpiresOn !== null
    && decision.authorizationExpiresOn >= decision.decidedAt.slice(0, 10)
    && decision.authorizationExpiresOn <= proposal.intendedOutcome.reviewOn;
}

function reconciliationMatchesDecisionWindow(
  reconciliation: ControlReconciliationDto,
  decision: ControlDecisionDto,
) {
  if (decision.authorizationExpiresOn !== null
    && reconciliation.observedAmountMinor !== null
    && reconciliation.observedCurrency !== null
    && reconciliation.observedEvidenceDate === null) return false;
  const afterExpiry = decision.authorizationExpiresOn !== null
    && reconciliation.observedEvidenceDate !== null
    && reconciliation.observedEvidenceDate > decision.authorizationExpiresOn;
  return reconciliation.verdict === "AUTHORIZATION_EXPIRED" ? afterExpiry : !afterExpiry;
}

function outcomeMatchesProposal(
  outcome: ControlOutcomeReconciliation | null,
  intended: IntendedControlOutcome | null,
) {
  if (outcome === null || intended === null) return outcome === null && intended === null;
  return outcome.metric === intended.metric
    && outcome.targetDirection === intended.targetDirection
    && outcome.targetValue === intended.targetValue
    && outcome.unit === intended.unit
    && outcome.reviewOn === intended.reviewOn;
}

const policyReasonCodes: readonly PolicyReasonCode[] = [
  "CATEGORY_POLICY_MISSING",
  "CATEGORY_REQUIRES_REVIEW",
  "CATEGORY_OUTSIDE_POLICY",
  "CURRENCY_POLICY_MISSING",
  "PER_CHARGE_LIMIT_EXCEEDED",
  "THIRTEEN_WEEK_LIMIT_EXCEEDED",
  "ANNUAL_LIMIT_EXCEEDED",
  "EXPOSURE_NOT_CITED",
];

const adverseReconciliationVerdicts = new Set<ControlReconciliationDto["verdict"]>([
  "OVER_CAP",
  "CURRENCY_MISMATCH",
  "CANNOT_EVALUATE",
  "AUTHORIZATION_EXPIRED",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isNullableUuid(value: unknown): value is string | null {
  return value === null || isUuid(value);
}

function isMinorUnits(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 19
    && /^(?:0|[1-9]\d*)$/.test(value)
    && BigInt(value) <= BigInt("9223372036854775807");
}

function isPositiveMinorUnits(value: unknown): value is string {
  return isMinorUnits(value) && value !== "0";
}

function isNullableMinorUnits(value: unknown): value is string | null {
  return value === null || isMinorUnits(value);
}

function isCurrency(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return normalizeCurrency(value) === value;
  } catch {
    return false;
  }
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isBoundedText(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.trim() === value && value.length >= minimum && value.length <= maximum;
}

const proposalCategories: readonly ProposalCategory[] = ["AI_MODEL", "CLOUD_INFRASTRUCTURE", "SOFTWARE", "CONTRACTOR", "CAMPAIGN", "OTHER"];
const categoryPostures: readonly CategoryPosture[] = ["ALLOW", "REVIEW", "OUTSIDE_POLICY"];

export function normalizeControlPolicyRequest(value: unknown): PutControlPolicyRequest {
  const record = requireRecord(value, "Policy request");
  rejectUnknown(record, ["categoryRules", "currencyLimits"], "policy request");
  if (!Array.isArray(record.categoryRules) || record.categoryRules.length > proposalCategories.length) {
    throw new Error("Policy categoryRules must be an array with at most one rule per category.");
  }
  if (!Array.isArray(record.currencyLimits) || record.currencyLimits.length > 20) {
    throw new Error("Policy currencyLimits must be an array with at most 20 currencies.");
  }
  const normalized = {
    categoryRules: record.categoryRules.map((entry, index) => {
      const rule = requireRecord(entry, `Category rule ${index + 1}`);
      rejectUnknown(rule, ["category", "posture"], `category rule ${index + 1}`);
      if (typeof rule.category !== "string" || !proposalCategories.includes(rule.category as ProposalCategory)) {
        throw new Error(`Category rule ${index + 1} category is not supported.`);
      }
      if (typeof rule.posture !== "string" || !categoryPostures.includes(rule.posture as CategoryPosture)) {
        throw new Error(`Category rule ${index + 1} posture is not supported.`);
      }
      return { category: rule.category as ProposalCategory, posture: rule.posture as CategoryPosture };
    }),
    currencyLimits: record.currencyLimits.map((entry, index) => {
      const limit = requireRecord(entry, `Currency limit ${index + 1}`);
      rejectUnknown(limit, ["currency", "maxPerChargeMinor", "maxThirteenWeekMinor", "maxAnnualMinor"], `currency limit ${index + 1}`);
      return {
        currency: normalizeCurrency(limit.currency, `Currency limit ${index + 1} currency`),
        maxPerChargeMinor: parsePositiveMinorUnits(limit.maxPerChargeMinor, `Currency limit ${index + 1} per-charge limit`).toString(),
        maxThirteenWeekMinor: parsePositiveMinorUnits(limit.maxThirteenWeekMinor, `Currency limit ${index + 1} 13-week limit`).toString(),
        maxAnnualMinor: parsePositiveMinorUnits(limit.maxAnnualMinor, `Currency limit ${index + 1} annual limit`).toString(),
      };
    }),
  };
  assertRecordableControlPolicy(normalized);
  return normalized;
}

export function normalizeControlProposalRequest(value: unknown): CreateControlProposalRequest {
  const record = requireRecord(value, "Proposal request");
  rejectUnknown(record, ["merchant", "purpose", "category", "amountMinor", "currency", "firstChargeDate", "cadence", "existingCommitmentIds", "intendedOutcome"], "proposal request");
  if (typeof record.category !== "string" || !proposalCategories.includes(record.category as ProposalCategory)) {
    throw new Error("Proposal category is not supported.");
  }
  if (typeof record.cadence !== "string" || !proposalCadences.includes(record.cadence as (typeof proposalCadences)[number])) {
    throw new Error("Proposal cadence is not supported.");
  }
  if (typeof record.firstChargeDate !== "string" || !isDateOnly(record.firstChargeDate)) {
    throw new Error("Proposal firstChargeDate must be a real ISO calendar date.");
  }
  if (!Array.isArray(record.existingCommitmentIds) || record.existingCommitmentIds.length > 50) {
    throw new Error("Proposal existingCommitmentIds must be an array with at most 50 ids.");
  }
  const intendedOutcome = normalizeIntendedControlOutcome(record.intendedOutcome);
  if (intendedOutcome.reviewOn < record.firstChargeDate) {
    throw new Error("Intended outcome review date cannot be before the first charge date.");
  }
  return {
    merchant: boundedText(record.merchant, "Proposal merchant", 1, 240),
    purpose: boundedText(record.purpose, "Proposal purpose", 1, 500),
    category: record.category as ProposalCategory,
    amountMinor: parsePositiveMinorUnits(record.amountMinor, "Proposal amount").toString(),
    currency: normalizeCurrency(record.currency, "Proposal currency"),
    firstChargeDate: record.firstChargeDate,
    cadence: record.cadence as (typeof proposalCadences)[number],
    existingCommitmentIds: record.existingCommitmentIds.map((id, index) => requireUuid(id, `Existing commitment id ${index + 1}`)),
    intendedOutcome,
  };
}

export function normalizeControlDecisionRequest(value: unknown): DecideControlProposalRequest {
  const record = requireRecord(value, "Decision request");
  rejectUnknown(record, ["action", "approvedCapMinor", "authorizationExpiresOn", "overrideReason"], "decision request");
  if (typeof record.action !== "string" || !proposalDecisionActions.includes(record.action as (typeof proposalDecisionActions)[number])) {
    throw new Error("Proposal decision action is not supported.");
  }
  if (record.action === "APPROVE" && record.approvedCapMinor !== undefined) throw new Error("APPROVE does not accept a cap.");
  if (record.action === "DECLINE" && record.approvedCapMinor !== undefined) throw new Error("DECLINE cannot carry a cap.");
  if (record.action === "APPROVE_WITH_CAP" && record.approvedCapMinor === undefined) throw new Error("APPROVE_WITH_CAP requires a cap.");
  if (record.action === "DECLINE" && record.authorizationExpiresOn !== undefined) throw new Error("DECLINE cannot carry an authorization expiry.");
  let authorizationExpiresOn: string | undefined;
  if (record.action !== "DECLINE") {
    if (typeof record.authorizationExpiresOn !== "string" || !isDateOnly(record.authorizationExpiresOn)) {
      throw new Error("An approved decision requires a real ISO authorization expiry date.");
    }
    authorizationExpiresOn = record.authorizationExpiresOn;
  }
  const overrideReason = record.overrideReason === undefined
    ? undefined
    : boundedText(record.overrideReason, "Override reason", 1, 500);
  return {
    action: record.action as (typeof proposalDecisionActions)[number],
    ...(record.approvedCapMinor === undefined
      ? {}
      : { approvedCapMinor: parsePositiveMinorUnits(record.approvedCapMinor, "Approved cap").toString() }),
    ...(authorizationExpiresOn === undefined ? {} : { authorizationExpiresOn }),
    ...(overrideReason === undefined ? {} : { overrideReason }),
  };
}

export function normalizeControlReconciliationRequest(value: unknown): ReconcileControlProposalRequest {
  const record = requireRecord(value, "Reconciliation request");
  rejectUnknown(record, ["evidenceId", "observedOutcome"], "reconciliation request");
  return {
    evidenceId: requireUuid(record.evidenceId, "Evidence id"),
    ...(record.observedOutcome === undefined
      ? {}
      : { observedOutcome: normalizeControlOutcomeObservation(record.observedOutcome) }),
  };
}

export function normalizeControlOutcomeObservationRequest(value: unknown): RecordControlOutcomeObservationRequest {
  const record = requireRecord(value, "Outcome observation request");
  rejectUnknown(record, ["observedOutcome"], "outcome observation request");
  return { observedOutcome: normalizeControlOutcomeObservation(record.observedOutcome) };
}

export function normalizeControlExceptionReviewRequest(value: unknown): RecordControlExceptionReviewRequest {
  const record = requireRecord(value, "Exception review request");
  rejectUnknown(record, ["targetKind", "targetId", "disposition", "note"], "exception review request");
  if (typeof record.targetKind !== "string" || !controlExceptionTargetKinds.includes(record.targetKind as ControlExceptionTargetKind)) {
    throw new Error("Exception review target kind is not supported.");
  }
  if (typeof record.disposition !== "string" || !controlExceptionDispositions.includes(record.disposition as ControlExceptionDisposition)) {
    throw new Error("Exception review disposition is not supported.");
  }
  return {
    targetKind: record.targetKind as ControlExceptionTargetKind,
    targetId: requireUuid(record.targetId, "Exception review target id"),
    disposition: record.disposition as ControlExceptionDisposition,
    note: boundedText(record.note, "Exception review note", 1, 500),
  };
}
