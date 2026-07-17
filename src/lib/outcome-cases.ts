import { createHash } from "node:crypto";
import { classifyCommitment, getCommitmentPolicy, type CommitmentClass } from "./commitment-policy";

export const conciergeActions = ["cancel", "downgrade", "renegotiate"] as const;
export type ConciergeAction = typeof conciergeActions[number];

export const actionCaseStatuses = [
  "awaiting-authorization",
  "authorized",
  "in-progress",
  "provider-pending",
  "executed",
  "verifying",
  "verified",
  "failed",
  "withdrawn",
  "disputed",
] as const;
export type ActionCaseStatus = typeof actionCaseStatuses[number];

export type ActionCaseActor = "customer" | "operator" | "system";

export const outcomeOffer = Object.freeze({
  id: "verified-savings-concierge",
  version: 1,
  termsVersion: "verified-savings-concierge-2026-07-17",
  authorizationVersion: 1,
  authorizationScope: "one-action-one-commitment" as const,
  successFeeBasisPoints: 1_500,
  minimumFeeMinor: 9_900,
  reviewWindowDays: 7,
});

const conciergeEligibleClasses: Readonly<Record<ConciergeAction, readonly CommitmentClass[]>> = {
  cancel: ["discretionary-subscription"],
  downgrade: ["discretionary-subscription"],
  renegotiate: ["contractual-other"],
};

const transitions: Readonly<Record<ActionCaseStatus, readonly ActionCaseStatus[]>> = {
  "awaiting-authorization": ["authorized", "withdrawn"],
  authorized: ["in-progress", "withdrawn"],
  "in-progress": ["provider-pending", "executed", "failed", "withdrawn"],
  "provider-pending": ["executed", "failed", "withdrawn"],
  executed: ["verifying", "failed", "disputed"],
  verifying: ["verified", "failed", "disputed"],
  verified: ["disputed"],
  failed: ["awaiting-authorization"],
  withdrawn: [],
  disputed: ["verified", "failed"],
};

export function getConciergeEligibility(category: string, action: unknown) {
  const commitmentClass = classifyCommitment(category);
  const policy = getCommitmentPolicy(category);
  if (!isConciergeAction(action)) {
    return {
      eligible: false as const,
      commitmentClass,
      reasonCode: "unsupported-action" as const,
      guidance: policy.consequenceWarning,
    };
  }
  if (!conciergeEligibleClasses[action].includes(commitmentClass)) {
    return {
      eligible: false as const,
      commitmentClass,
      reasonCode: "guidance-only-class" as const,
      guidance: policy.consequenceWarning,
    };
  }
  return {
    eligible: true as const,
    commitmentClass,
    reasonCode: "eligible" as const,
    guidance: policy.consequenceWarning,
  };
}

export function isConciergeAction(value: unknown): value is ConciergeAction {
  return typeof value === "string" && conciergeActions.includes(value as ConciergeAction);
}

export function isActionCaseStatus(value: unknown): value is ActionCaseStatus {
  return typeof value === "string" && actionCaseStatuses.includes(value as ActionCaseStatus);
}

export function canTransitionActionCase(
  current: ActionCaseStatus,
  next: ActionCaseStatus,
  actor: ActionCaseActor,
) {
  if (!transitions[current].includes(next)) return false;
  if (actor === "customer") return next === "withdrawn" || next === "disputed";
  if (actor === "operator") return next !== "verified";
  return next === "verifying" || next === "verified" || next === "failed";
}

export function normalizeActionCaseIdempotencyKey(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{16,128}$/.test(value)) {
    throw new Error("A valid action-case Idempotency-Key is required.");
  }
  return value;
}

export function buildAuthorizationText(input: {
  merchant: string;
  action: ConciergeAction;
  currency: string;
  maximumSuccessFeeMinor: number;
  authorizationSequence?: number;
}) {
  const merchant = normalizeBoundedText(input.merchant, 180, "merchant");
  const currency = normalizeCurrency(input.currency);
  const maximumSuccessFeeMinor = normalizeMinorAmount(input.maximumSuccessFeeMinor);
  return [
    `I authorize Vognary to perform one ${input.action} action for ${merchant}.`,
    "This authorization does not permit purchases, transfers, password collection, or changes to any other commitment.",
    `A success fee may be due only after Vognary verifies the saving; the authorized maximum is ${currency} ${formatMinor(maximumSuccessFeeMinor)}.`,
    `Authorization record ${input.authorizationSequence ?? 1}; form version ${outcomeOffer.authorizationVersion}; terms ${outcomeOffer.termsVersion}.`,
  ].join(" ");
}

export function hashAuthorizationText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function calculateOutcomeFeeMinor(
  annualSaving: number,
  pricing: { successFeeBasisPoints: number; minimumFeeMinor: number; maximumFeeMinor?: number } = {
    successFeeBasisPoints: outcomeOffer.successFeeBasisPoints,
    minimumFeeMinor: outcomeOffer.minimumFeeMinor,
  },
) {
  if (!Number.isFinite(annualSaving) || annualSaving <= 0 || annualSaving > 1_000_000_000) {
    throw new Error("Verified annual saving is invalid.");
  }
  if (!Number.isInteger(pricing.successFeeBasisPoints) || pricing.successFeeBasisPoints < 0 || pricing.successFeeBasisPoints > 10_000) {
    throw new Error("Success-fee basis points are invalid.");
  }
  if (!Number.isSafeInteger(pricing.minimumFeeMinor) || pricing.minimumFeeMinor < 0) {
    throw new Error("Minimum success fee is invalid.");
  }
  const percentageFee = Math.round(annualSaving * 100 * pricing.successFeeBasisPoints / 10_000);
  const uncapped = Math.max(pricing.minimumFeeMinor, percentageFee);
  if (pricing.maximumFeeMinor === undefined) return uncapped;
  if (!Number.isSafeInteger(pricing.maximumFeeMinor) || pricing.maximumFeeMinor <= 0) {
    throw new Error("Maximum success fee is invalid.");
  }
  return Math.min(uncapped, pricing.maximumFeeMinor);
}

export function getConciergeConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  const testModeRequested = environment.CONCIERGE_MODE === "test";
  const testMode = testModeRequested && environment.NODE_ENV !== "production";
  const missing = [
    testModeRequested && !testMode ? "CONCIERGE_MODE=test is forbidden in production" : null,
    testMode || environment.CONCIERGE_LEGAL_TERMS_STATUS === "approved"
      ? null
      : "CONCIERGE_LEGAL_TERMS_STATUS=approved",
    testMode || environment.CONCIERGE_OPERATIONS_STATUS === "production-ready"
      ? null
      : "CONCIERGE_OPERATIONS_STATUS=production-ready",
    testMode || environment.CONCIERGE_PRIVACY_REVIEW_STATUS === "approved"
      ? null
      : "CONCIERGE_PRIVACY_REVIEW_STATUS=approved",
  ].filter((entry): entry is string => Boolean(entry));
  return missing.length
    ? { status: "not-configured" as const, missing }
    : { status: "ready" as const, missing: [] as string[] };
}

function normalizeMinorAmount(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 100_000_000_000) {
    throw new Error("Maximum success fee is invalid.");
  }
  return value;
}

function normalizeCurrency(value: string) {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency is invalid.");
  return currency;
}

function normalizeBoundedText(value: string, maxLength: number, label: string) {
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`${label} is invalid.`);
  return normalized;
}

function formatMinor(value: number) {
  return (value / 100).toFixed(2);
}
