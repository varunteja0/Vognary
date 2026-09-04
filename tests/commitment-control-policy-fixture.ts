import type { IntendedControlOutcome } from "../src/lib/commitment-control/outcome";

export function testControlOutcome(overrides: Partial<IntendedControlOutcome> = {}): IntendedControlOutcome {
  return {
    metric: "Resolved fixture tasks",
    targetDirection: "AT_LEAST",
    targetValue: "10",
    unit: "tasks",
    reviewOn: "2099-12-31",
    ...overrides,
  };
}
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

export function futureControlTestDate(daysAhead = 2, now = new Date()) {
  const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(future);
}
