export type CommitmentClass =
  | "discretionary-subscription"
  | "usage-based-cloud"
  | "debt-emi"
  | "insurance"
  | "investment-sip"
  | "utility"
  | "contractual-other";

export type CommitmentAction =
  | "keep"
  | "monitor"
  | "investigate"
  | "cancel"
  | "downgrade"
  | "rightsize"
  | "set-spend-cap"
  | "review-repayment"
  | "contact-lender"
  | "review-coverage"
  | "compare-coverage"
  | "review-contribution"
  | "consult-adviser"
  | "review-plan"
  | "switch-after-continuity-check"
  | "review-contract"
  | "renegotiate";

export type CommitmentTerminology = {
  singular: string;
  recurringAmount: string;
  nextEvent: string;
  reviewVerb: string;
};

export type CommitmentPolicy = {
  class: CommitmentClass;
  label: string;
  terminology: CommitmentTerminology;
  safeActions: readonly CommitmentAction[];
  consequenceWarning: string;
  highCostReviewThreshold: number | null;
  highCostGuidance: string;
  defaultGuidance: string;
  riskTag: string;
};

const policies: Record<CommitmentClass, CommitmentPolicy> = {
  "discretionary-subscription": {
    class: "discretionary-subscription",
    label: "Discretionary subscription",
    terminology: {
      singular: "subscription",
      recurringAmount: "subscription spend",
      nextEvent: "renewal date",
      reviewVerb: "review usage",
    },
    safeActions: ["keep", "monitor", "investigate", "downgrade", "cancel"],
    consequenceWarning: "Confirm notice periods, retained data, and access needs before changing the subscription.",
    highCostReviewThreshold: 1_200,
    highCostGuidance: "Confirm active users and required features before renewing.",
    defaultGuidance: "Keep it when the subscription is still actively used and worth its cost.",
    riskTag: "discretionary subscription",
  },
  "usage-based-cloud": {
    class: "usage-based-cloud",
    label: "Usage-based infrastructure",
    terminology: {
      singular: "usage-based service",
      recurringAmount: "infrastructure cost",
      nextEvent: "billing window",
      reviewVerb: "review utilization",
    },
    safeActions: ["keep", "monitor", "investigate", "rightsize", "set-spend-cap"],
    consequenceWarning: "Downsizing or deleting resources without dependency checks can cause outages or data loss.",
    highCostReviewThreshold: 2_500,
    highCostGuidance: "Review utilization, idle resources, budgets, and spend caps; rightsize only after checking dependencies.",
    defaultGuidance: "Monitor usage and budgets because the amount can change without a plan renewal.",
    riskTag: "usage-based cost",
  },
  "debt-emi": {
    class: "debt-emi",
    label: "Debt or EMI obligation",
    terminology: {
      singular: "repayment obligation",
      recurringAmount: "scheduled repayment",
      nextEvent: "payment due date",
      reviewVerb: "review repayment terms",
    },
    safeActions: ["keep", "monitor", "investigate", "review-repayment", "contact-lender"],
    consequenceWarning: "Stopping an auto-debit does not remove the debt and can cause fees, credit impact, or default.",
    highCostReviewThreshold: 2_500,
    highCostGuidance: "Verify the lender, outstanding balance, interest rate, tenure, and due date; contact the lender before changing payment instructions.",
    defaultGuidance: "Keep the repayment funded and verify it against the lender's current schedule.",
    riskTag: "repayment obligation — do not cancel autopay",
  },
  insurance: {
    class: "insurance",
    label: "Insurance coverage",
    terminology: {
      singular: "insurance policy",
      recurringAmount: "premium",
      nextEvent: "premium due date",
      reviewVerb: "review coverage",
    },
    safeActions: ["keep", "monitor", "investigate", "review-coverage", "compare-coverage"],
    consequenceWarning: "Do not let coverage lapse before confirming replacement coverage, exclusions, waiting periods, and surrender terms.",
    highCostReviewThreshold: 1_200,
    highCostGuidance: "Review coverage, beneficiaries, exclusions, waiting periods, and comparable policies before making a change.",
    defaultGuidance: "Keep the premium funded until coverage and any replacement policy are confirmed.",
    riskTag: "coverage continuity required",
  },
  "investment-sip": {
    class: "investment-sip",
    label: "Investment or SIP contribution",
    terminology: {
      singular: "investment contribution",
      recurringAmount: "contribution",
      nextEvent: "contribution date",
      reviewVerb: "review contribution plan",
    },
    safeActions: ["keep", "monitor", "investigate", "review-contribution", "consult-adviser"],
    consequenceWarning: "This is an investment contribution, not discretionary burn; changes can affect goals, taxes, exit loads, or protection benefits.",
    highCostReviewThreshold: 2_500,
    highCostGuidance: "Review the contribution against liquidity, time horizon, risk tolerance, and goals; use a qualified adviser for personal investment advice.",
    defaultGuidance: "Keep it when it still matches the documented investment plan and available liquidity.",
    riskTag: "investment contribution — not burn",
  },
  utility: {
    class: "utility",
    label: "Essential utility",
    terminology: {
      singular: "utility service",
      recurringAmount: "essential-service bill",
      nextEvent: "billing due date",
      reviewVerb: "review usage and tariff",
    },
    safeActions: ["keep", "monitor", "investigate", "review-plan", "switch-after-continuity-check"],
    consequenceWarning: "Stopping payment or service can interrupt an essential connection; confirm continuity before switching providers or plans.",
    highCostReviewThreshold: 1_200,
    highCostGuidance: "Check measured usage, billing errors, tariff, and plan fit; preserve service continuity during any switch.",
    defaultGuidance: "Keep the account funded and monitor usage, tariff, and billing accuracy.",
    riskTag: "essential-service continuity",
  },
  "contractual-other": {
    class: "contractual-other",
    label: "Contractual or unclassified commitment",
    terminology: {
      singular: "recurring commitment",
      recurringAmount: "committed spend",
      nextEvent: "next contractual date",
      reviewVerb: "review terms",
    },
    safeActions: ["keep", "monitor", "investigate", "review-contract", "renegotiate"],
    consequenceWarning: "Review notice periods, termination fees, service dependencies, and legal obligations before changing this commitment.",
    highCostReviewThreshold: 2_500,
    highCostGuidance: "Confirm the owner, contract term, notice period, obligations, and renegotiation options.",
    defaultGuidance: "Keep it until the owner and contractual terms have been verified.",
    riskTag: "terms review required",
  },
};

const protectedCategoryRules: Array<{
  pattern: RegExp;
  scripts: readonly string[];
  class: Exclude<CommitmentClass, "discretionary-subscription">;
}> = [
  { pattern: /\b(?:debt|loan|emi|mortgage|instal+l?ment|repayment|nach|ecs|autopay)\b/i, scripts: ["ऑटोपे", "एमी"], class: "debt-emi" },
  { pattern: /\b(?:insurance|policy premium|coverage premium|lic)\b/i, scripts: [], class: "insurance" },
  { pattern: /\b(?:investments?|sip|mutual fund|pension contribution)\b/i, scripts: ["एसआईपी"], class: "investment-sip" },
  { pattern: /\b(?:utilities?|telecom|electricity|water|gas|broadband|internet|mobile|phone)\b/i, scripts: [], class: "utility" },
  {
    pattern: /\b(?:aws|gcp|azure|vercel|cloudflare|cloud hosting|cloud infrastructure|infrastructure usage|compute usage|api usage|ai usage|usage costs?)\b/i,
    scripts: [],
    class: "usage-based-cloud",
  },
];

const discretionaryCategoryRule = {
  pattern: /\b(?:subscription|saas|streaming|ai tools?|developer tools?|creative tools?|design tools?|productivity|app store|social tools?|entertainment)\b/i,
};

export const executableCommitmentClass = "discretionary-subscription" as const satisfies CommitmentClass;

export function isProtectedCommitmentClass(commitmentClass: CommitmentClass): boolean {
  return commitmentClass !== executableCommitmentClass;
}

function matchesProtectedRule(haystack: string, rule: (typeof protectedCategoryRules)[number]): boolean {
  if (rule.pattern.test(haystack)) return true;
  return rule.scripts.some((token) => haystack.includes(token));
}

export function classifyCommitment(...texts: readonly string[]): CommitmentClass {
  const normalized = texts.map((value) => value.trim()).filter(Boolean).join(" ").trim();
  if (!normalized) return "contractual-other";
  const protectedHit = protectedCategoryRules.find((rule) => matchesProtectedRule(normalized, rule));
  if (protectedHit) return protectedHit.class;
  if (discretionaryCategoryRule.pattern.test(normalized)) return "discretionary-subscription";
  return "contractual-other";
}

export function getCommitmentPolicy(category: string): CommitmentPolicy {
  return policies[classifyCommitment(category)];
}

export function isCommitmentActionAllowed(category: string, action: CommitmentAction) {
  return getCommitmentPolicy(category).safeActions.includes(action);
}

export function listCommitmentPolicies(): readonly CommitmentPolicy[] {
  return Object.values(policies);
}
