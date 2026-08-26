import type { CategoryPosture, ProposalCategory } from "../src/lib/commitment-control/policy";

export const completeControlCategoryRules: { category: ProposalCategory; posture: CategoryPosture }[] = [
  { category: "AI_MODEL", posture: "ALLOW" },
  { category: "CLOUD_INFRASTRUCTURE", posture: "ALLOW" },
  { category: "SOFTWARE", posture: "ALLOW" },
  { category: "CONTRACTOR", posture: "REVIEW" },
  { category: "CAMPAIGN", posture: "REVIEW" },
  { category: "OTHER", posture: "REVIEW" },
];

export const defaultControlCurrencyLimits: {
  currency: string;
  maxPerChargeMinor: string;
  maxThirteenWeekMinor: string;
  maxAnnualMinor: string;
}[] = [{
  currency: "INR",
  maxPerChargeMinor: "500000",
  maxThirteenWeekMinor: "3000000",
  maxAnnualMinor: "12000000",
}];

export function completeControlPolicyRequest(input?: {
  categoryRules?: { category: ProposalCategory; posture: CategoryPosture }[];
  currencyLimits?: typeof defaultControlCurrencyLimits;
}) {
  return {
    categoryRules: input?.categoryRules ?? completeControlCategoryRules,
    currencyLimits: input?.currencyLimits ?? defaultControlCurrencyLimits,
  };
}
