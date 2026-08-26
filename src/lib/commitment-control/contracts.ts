import { proposalDecisionActions, type ProposalDecisionAction } from "./decision";
import { normalizeCurrency, parsePositiveMinorUnits, requireUuid } from "./money";
import type { CategoryPosture, PolicyReasonCode, ProposalCategory, ProposalPolicy, ProposalPolicyEvaluation } from "./policy";
import { assertRecordableControlPolicy } from "./policy";
import { proposalCadences, type ProposalCadence } from "./project";

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
};
export type DecideControlProposalRequest = {
  action: ProposalDecisionAction;
  approvedCapMinor?: string;
  overrideReason?: string;
};
export type ReconcileControlProposalRequest = { evidenceId: string };

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
};

export type ControlReconciliationDto = {
  id: string;
  proposalId: string;
  decisionId: string;
  evidenceId: string;
  verdict: "MATCHED" | "WITHIN_CAP" | "OVER_CAP" | "CURRENCY_MISMATCH" | "CANNOT_EVALUATE";
  expectedAmountMinor: string;
  approvedCapMinor: string | null;
  authorizationCurrency: string;
  observedAmountMinor: string | null;
  observedCurrency: string | null;
  reconciledByUserId: string | null;
  reconciledAt: string;
};

export type CommitmentControlBriefDto = {
  policy: ControlPolicyDto | null;
  proposals: Array<{
    proposal: ControlProposalDto;
    evaluation: ControlEvaluationDto | null;
    decision: ControlDecisionDto | null;
    reconciliations: ControlReconciliationDto[];
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
export type ControlReconciliationWriteDto = { decision: ControlDecisionDto; reconciliation: ControlReconciliationDto };

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
    )) return false;
    if (!Array.isArray(reconciliations) || !reconciliations.every(isControlReconciliationDto)) return false;
    if (reconciliations.length && (!decision || decision.action === "DECLINE")) return false;
    return reconciliations.every((reconciliation) => decision !== null
      && reconciliation.proposalId === proposal.id
      && reconciliation.decisionId === decision.id
      && reconciliation.expectedAmountMinor === decision.expectedAmountMinor
      && reconciliation.approvedCapMinor === decision.approvedCapMinor
      && reconciliation.authorizationCurrency === decision.currency);
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
  return isRecord(value) && isControlDecisionDto(value.decision);
}

export function isControlReconciliationWriteDto(value: unknown): value is ControlReconciliationWriteDto {
  return isRecord(value)
    && isControlDecisionDto(value.decision)
    && value.decision.action !== "DECLINE"
    && isControlReconciliationDto(value.reconciliation)
    && value.reconciliation.proposalId === value.decision.proposalId
    && value.reconciliation.decisionId === value.decision.id
    && value.reconciliation.expectedAmountMinor === value.decision.expectedAmountMinor
    && value.reconciliation.approvedCapMinor === value.decision.approvedCapMinor
    && value.reconciliation.authorizationCurrency === value.decision.currency;
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
    && isCanonicalDateOnly(value.firstChargeDate)
    && typeof value.cadence === "string"
    && proposalCadences.includes(value.cadence as ProposalCadence)
    && isCanonicalDateOnly(value.asOfDate)
    && value.firstChargeDate >= value.asOfDate
    && isPositiveMinorUnits(value.projectedThirteenWeekMinor)
    && isPositiveMinorUnits(value.projectedAnnualMinor)
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
    || !isTimestamp(value.decidedAt)) return false;
  if (value.action === "DECLINE") return value.approvedCapMinor === null;
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
    || !["MATCHED", "WITHIN_CAP", "OVER_CAP", "CURRENCY_MISMATCH", "CANNOT_EVALUATE"].includes(String(value.verdict))
    || !isPositiveMinorUnits(value.expectedAmountMinor)
    || !isNullableMinorUnits(value.approvedCapMinor)
    || !isCurrency(value.authorizationCurrency)
    || !isNullableMinorUnits(value.observedAmountMinor)
    || !(value.observedCurrency === null || isCurrency(value.observedCurrency))
    || !isNullableUuid(value.reconciledByUserId)
    || !isTimestamp(value.reconciledAt)) return false;
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

function isCanonicalDateOnly(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
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
  rejectUnknown(record, ["merchant", "purpose", "category", "amountMinor", "currency", "firstChargeDate", "cadence", "existingCommitmentIds"], "proposal request");
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
  return {
    merchant: boundedText(record.merchant, "Proposal merchant", 1, 240),
    purpose: boundedText(record.purpose, "Proposal purpose", 1, 500),
    category: record.category as ProposalCategory,
    amountMinor: parsePositiveMinorUnits(record.amountMinor, "Proposal amount").toString(),
    currency: normalizeCurrency(record.currency, "Proposal currency"),
    firstChargeDate: record.firstChargeDate,
    cadence: record.cadence as (typeof proposalCadences)[number],
    existingCommitmentIds: record.existingCommitmentIds.map((id, index) => requireUuid(id, `Existing commitment id ${index + 1}`)),
  };
}

export function normalizeControlDecisionRequest(value: unknown): DecideControlProposalRequest {
  const record = requireRecord(value, "Decision request");
  rejectUnknown(record, ["action", "approvedCapMinor", "overrideReason"], "decision request");
  if (typeof record.action !== "string" || !proposalDecisionActions.includes(record.action as (typeof proposalDecisionActions)[number])) {
    throw new Error("Proposal decision action is not supported.");
  }
  if (record.action === "APPROVE" && record.approvedCapMinor !== undefined) throw new Error("APPROVE does not accept a cap.");
  if (record.action === "DECLINE" && record.approvedCapMinor !== undefined) throw new Error("DECLINE cannot carry a cap.");
  if (record.action === "APPROVE_WITH_CAP" && record.approvedCapMinor === undefined) throw new Error("APPROVE_WITH_CAP requires a cap.");
  const overrideReason = record.overrideReason === undefined
    ? undefined
    : boundedText(record.overrideReason, "Override reason", 1, 500);
  return {
    action: record.action as (typeof proposalDecisionActions)[number],
    ...(record.approvedCapMinor === undefined
      ? {}
      : { approvedCapMinor: parsePositiveMinorUnits(record.approvedCapMinor, "Approved cap").toString() }),
    ...(overrideReason === undefined ? {} : { overrideReason }),
  };
}

export function normalizeControlReconciliationRequest(value: unknown): ReconcileControlProposalRequest {
  const record = requireRecord(value, "Reconciliation request");
  rejectUnknown(record, ["evidenceId"], "reconciliation request");
  return { evidenceId: requireUuid(record.evidenceId, "Evidence id") };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (Object.prototype.toString.call(value) !== "[object Object]") throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function rejectUnknown(record: Record<string, unknown>, allowed: readonly string[], label: string) {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(record).find((key) => !allowedSet.has(key));
  if (unknown) throw new Error(`${label} has unknown field ${unknown}.`);
}

function boundedText(value: unknown, label: string, minimum: number, maximum: number) {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) throw new Error(`${label} length is invalid.`);
  return normalized;
}

function isDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}