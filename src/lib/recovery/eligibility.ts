import { classifyCommitment, executableCommitmentClass, isProtectedCommitmentClass, type CommitmentClass } from "@/lib/commitment-policy";
import { matchSupportedProvider } from "@/lib/recovery/provider-registry";
import { isWithinMandateCeilings, standingMandateVetoHours } from "@/lib/recovery/standing-mandate";

export const eligibilityCodes = [
  "MANDATE_INACTIVE",
  "PROTECTED_CLASS",
  "CONFLICTING_CLASS",
  "LOW_CONFIDENCE",
  "INSUFFICIENT_RECURRENCE",
  "UNSTABLE_FACTS",
  "AMOUNT_OVER_CEILING",
  "CURRENCY_MISMATCH",
  "UNSUPPORTED_ROUTE",
  "KEEP_OR_EXCLUDED",
  "PRIOR_VETO",
  "STALE_EVIDENCE",
  "CONTRADICTORY_UPDATE",
  "NOTICE_UNDELIVERABLE",
  "ELIGIBLE",
] as const;
export type EligibilityCode = (typeof eligibilityCodes)[number];

export const highConfidenceFloor = 80;

export type EligibilityInput = {
  mandateActive: boolean;
  category: string;
  conflictingCategories?: readonly string[];
  confidenceScore: number;
  datedOccurrenceCount: number;
  explicitProviderRenewalEvidence: boolean;
  cadenceStable: boolean;
  amountStable: boolean;
  currencyStable: boolean;
  nextDebitStable: boolean;
  amountMinor: bigint;
  amountCurrency?: string;
  mandateCurrency?: string;
  rolling30dExecutedMinor: bigint;
  perActionCeilingMinor: bigint;
  rolling30dCeilingMinor: bigint;
  merchant: string;
  decision?: "KEEP" | "MONITOR" | "DOWNGRADE" | "CANCEL" | "INVESTIGATE" | null;
  excluded?: boolean;
  priorVeto?: boolean;
  staleEvidence?: boolean;
  contradictoryUpdate?: boolean;
  noticeCanBeDelivered: boolean;
};

export type EligibilityResult = {
  commitmentClass: CommitmentClass;
  protectedOverride: boolean;
  eligibility: "ELIGIBLE" | "INELIGIBLE" | "PROTECTED" | "UNSUPPORTED_ROUTE";
  reasons: readonly EligibilityCode[];
  providerId: string | null;
  vetoWindowHours: typeof standingMandateVetoHours;
};

export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const commitmentClass = classifyCommitment(input.category, input.merchant);
  const conflicting = (input.conflictingCategories ?? [])
    .map((value) => classifyCommitment(value))
    .filter((value, index, all) => all.indexOf(value) === index && value !== commitmentClass);
  const protectedOverride = isProtectedCommitmentClass(commitmentClass)
    || conflicting.some(isProtectedCommitmentClass);
  const provider = matchSupportedProvider(input.merchant);
  const reasons: EligibilityCode[] = [];

  if (!input.mandateActive) reasons.push("MANDATE_INACTIVE");
  if (protectedOverride || isProtectedCommitmentClass(commitmentClass)) reasons.push("PROTECTED_CLASS");
  if (conflicting.length > 0) reasons.push("CONFLICTING_CLASS");
  if (input.confidenceScore < highConfidenceFloor) reasons.push("LOW_CONFIDENCE");
  if (input.datedOccurrenceCount < 2 && !input.explicitProviderRenewalEvidence) reasons.push("INSUFFICIENT_RECURRENCE");
  if (!input.cadenceStable || !input.amountStable || !input.currencyStable || !input.nextDebitStable) {
    reasons.push("UNSTABLE_FACTS");
  }
  if (input.amountCurrency && input.mandateCurrency && input.amountCurrency !== input.mandateCurrency) {
    reasons.push("CURRENCY_MISMATCH");
  } else if (!isWithinMandateCeilings({
    amountMinor: input.amountMinor,
    rolling30dExecutedMinor: input.rolling30dExecutedMinor,
    perActionCeilingMinor: input.perActionCeilingMinor,
    rolling30dCeilingMinor: input.rolling30dCeilingMinor,
  })) {
    reasons.push("AMOUNT_OVER_CEILING");
  }
  if (!provider) reasons.push("UNSUPPORTED_ROUTE");
  if (input.decision === "KEEP" || input.excluded) reasons.push("KEEP_OR_EXCLUDED");
  if (input.priorVeto) reasons.push("PRIOR_VETO");
  if (input.staleEvidence) reasons.push("STALE_EVIDENCE");
  if (input.contradictoryUpdate) reasons.push("CONTRADICTORY_UPDATE");
  if (!input.noticeCanBeDelivered) reasons.push("NOTICE_UNDELIVERABLE");

  if (reasons.includes("PROTECTED_CLASS")) {
    return {
      commitmentClass,
      protectedOverride: true,
      eligibility: "PROTECTED",
      reasons,
      providerId: provider?.id ?? null,
      vetoWindowHours: standingMandateVetoHours,
    };
  }
  if (!provider || reasons.includes("UNSUPPORTED_ROUTE")) {
    return {
      commitmentClass,
      protectedOverride,
      eligibility: "UNSUPPORTED_ROUTE",
      reasons,
      providerId: null,
      vetoWindowHours: standingMandateVetoHours,
    };
  }
  if (reasons.length > 0 || commitmentClass !== executableCommitmentClass) {
    return {
      commitmentClass,
      protectedOverride,
      eligibility: "INELIGIBLE",
      reasons: reasons.length ? reasons : ["PROTECTED_CLASS"],
      providerId: provider.id,
      vetoWindowHours: standingMandateVetoHours,
    };
  }
  return {
    commitmentClass,
    protectedOverride: false,
    eligibility: "ELIGIBLE",
    reasons: ["ELIGIBLE"],
    providerId: provider.id,
    vetoWindowHours: standingMandateVetoHours,
  };
}
