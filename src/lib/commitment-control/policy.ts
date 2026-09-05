import { addMinorUnits, normalizeCurrency, parseMinorUnits, parsePositiveMinorUnits, requireUuid, subtractToHeadroom } from "./money";

const proposalCategories = ["AI_MODEL", "CLOUD_INFRASTRUCTURE", "SOFTWARE", "CONTRACTOR", "CAMPAIGN", "OTHER"] as const;
const categoryPostures = ["ALLOW", "REVIEW", "OUTSIDE_POLICY"] as const;

export type ProposalCategory = typeof proposalCategories[number];
export type CategoryPosture = typeof categoryPostures[number];
export type PolicyEvaluationStatus = "WITHIN_POLICY" | "REVIEW_REQUIRED" | "OUTSIDE_POLICY";
export type PolicyReasonCode =
  | "CATEGORY_POLICY_MISSING"
  | "CATEGORY_REQUIRES_REVIEW"
  | "CATEGORY_OUTSIDE_POLICY"
  | "CURRENCY_POLICY_MISSING"
  | "PER_CHARGE_LIMIT_EXCEEDED"
  | "THIRTEEN_WEEK_LIMIT_EXCEEDED"
  | "ANNUAL_LIMIT_EXCEEDED"
  | "EXPOSURE_NOT_CITED";

export type ProposalPolicy = {
  policyVersion: number;
  categoryRules: readonly { category: ProposalCategory; posture: CategoryPosture }[];
  currencyLimits: readonly {
    currency: string;
    maxPerChargeMinor: string;
    maxThirteenWeekMinor: string;
    maxAnnualMinor: string;
  }[];
};

export type ProposalForPolicy = {
  proposalId: string;
  amountMinor: string;
  currency: string;
  category: ProposalCategory;
  thirteenWeekMinor: string;
  annualMinor: string;
};

export type ExistingExposure = {
  currency: string;
  thirteenWeekMinor: string;
  annualMinor: string;
  evidenceIds: readonly string[];
  basis?: "PROJECTED" | "OBSERVATION_ONLY";
};

export type ProposalPolicyEvaluation = {
  proposal: ProposalForPolicy;
  policyVersion: number;
  status: PolicyEvaluationStatus;
  humanDecisionRequired: true;
  assumptionFields: readonly ["amountMinor", "currency", "category", "thirteenWeekMinor", "annualMinor"];
  citedEvidenceIds: string[];
  citedExposureBasis: "NONE" | "PROJECTED" | "OBSERVATION_ONLY";
  reasonCodes: PolicyReasonCode[];
  currencyResults: Array<{
    currency: string;
    existingThirteenWeekMinor: string;
    proposedThirteenWeekMinor: string;
    combinedThirteenWeekMinor: string;
    thirteenWeekHeadroomMinor: string | null;
    existingAnnualMinor: string;
    proposedAnnualMinor: string;
    combinedAnnualMinor: string;
    annualHeadroomMinor: string | null;
  }>;
};

const reasonOrder: readonly PolicyReasonCode[] = [
  "CATEGORY_POLICY_MISSING",
  "CATEGORY_REQUIRES_REVIEW",
  "CATEGORY_OUTSIDE_POLICY",
  "CURRENCY_POLICY_MISSING",
  "PER_CHARGE_LIMIT_EXCEEDED",
  "THIRTEEN_WEEK_LIMIT_EXCEEDED",
  "ANNUAL_LIMIT_EXCEEDED",
  "EXPOSURE_NOT_CITED",
];

export function evaluateProposalPolicy(input: {
  proposal: ProposalForPolicy;
  policy: ProposalPolicy;
  existingExposure: readonly ExistingExposure[];
  eligibleUncited?: boolean;
}): ProposalPolicyEvaluation {
  const proposal = normalizeProposal(input.proposal);
  const policy = parsePolicy(input.policy);
  const categoryRule = policy.categoryRules.find((rule) => rule.category === proposal.category);
  const reasons = new Set<PolicyReasonCode>();

  if (!categoryRule) reasons.add("CATEGORY_POLICY_MISSING");
  else if (categoryRule.posture === "REVIEW") reasons.add("CATEGORY_REQUIRES_REVIEW");
  else if (categoryRule.posture === "OUTSIDE_POLICY") reasons.add("CATEGORY_OUTSIDE_POLICY");
  const exposureByCurrency = new Map<string, { thirteenWeekMinor: bigint; annualMinor: bigint }>();
  const citedEvidenceIds = new Set<string>();
  for (const entry of input.existingExposure) {
    const currency = normalizeCurrency(entry.currency, "Existing exposure currency");
    if (!entry.evidenceIds.length) throw new Error("Existing exposure must cite persisted evidence.");
    for (const evidenceId of entry.evidenceIds) citedEvidenceIds.add(requireUuid(evidenceId, "Evidence id"));
    const current = exposureByCurrency.get(currency) ?? { thirteenWeekMinor: BigInt(0), annualMinor: BigInt(0) };
    exposureByCurrency.set(currency, {
      thirteenWeekMinor: addMinorUnits(current.thirteenWeekMinor, parseMinorUnits(entry.thirteenWeekMinor, "Existing 13-week exposure"), "Existing 13-week exposure"),
      annualMinor: addMinorUnits(current.annualMinor, parseMinorUnits(entry.annualMinor, "Existing annual exposure"), "Existing annual exposure"),
    });
  }

  const proposalAmount = parsePositiveMinorUnits(proposal.amountMinor, "Proposal amount");
  const proposedThirteenWeek = parseMinorUnits(proposal.thirteenWeekMinor, "Proposed 13-week exposure");
  const proposedAnnual = parseMinorUnits(proposal.annualMinor, "Proposed annual exposure");
  const currencies = [...new Set([...exposureByCurrency.keys(), proposal.currency])].sort();
  const currencyResults = currencies.map((currency) => {
    const existing = exposureByCurrency.get(currency) ?? { thirteenWeekMinor: BigInt(0), annualMinor: BigInt(0) };
    const proposedForCurrency = currency === proposal.currency ? proposedThirteenWeek : BigInt(0);
    const proposedAnnualForCurrency = currency === proposal.currency ? proposedAnnual : BigInt(0);
    const combinedThirteenWeek = addMinorUnits(existing.thirteenWeekMinor, proposedForCurrency, "Combined 13-week exposure");
    const combinedAnnual = addMinorUnits(existing.annualMinor, proposedAnnualForCurrency, "Combined annual exposure");
    const currencyLimit = policy.currencyLimits.find((limit) => limit.currency === currency);

    if (!currencyLimit) reasons.add("CURRENCY_POLICY_MISSING");
    else {
      if (currency === proposal.currency && proposalAmount > currencyLimit.maxPerChargeMinor) reasons.add("PER_CHARGE_LIMIT_EXCEEDED");
      if (combinedThirteenWeek > currencyLimit.maxThirteenWeekMinor) reasons.add("THIRTEEN_WEEK_LIMIT_EXCEEDED");
      if (combinedAnnual > currencyLimit.maxAnnualMinor) reasons.add("ANNUAL_LIMIT_EXCEEDED");
    }

    return {
      currency,
      existingThirteenWeekMinor: existing.thirteenWeekMinor.toString(),
      proposedThirteenWeekMinor: proposedForCurrency.toString(),
      combinedThirteenWeekMinor: combinedThirteenWeek.toString(),
      thirteenWeekHeadroomMinor: currencyLimit ? subtractToHeadroom(currencyLimit.maxThirteenWeekMinor, combinedThirteenWeek) : null,
      existingAnnualMinor: existing.annualMinor.toString(),
      proposedAnnualMinor: proposedAnnualForCurrency.toString(),
      combinedAnnualMinor: combinedAnnual.toString(),
      annualHeadroomMinor: currencyLimit ? subtractToHeadroom(currencyLimit.maxAnnualMinor, combinedAnnual) : null,
    };
  });

  const reasonCodes = reasonOrder.filter((reason) => reasons.has(reason));
  if (input.eligibleUncited && input.existingExposure.length === 0) {
    reasons.add("EXPOSURE_NOT_CITED");
  }
  const orderedReasons = reasonOrder.filter((reason) => reasons.has(reason) || reasonCodes.includes(reason));
  const status: PolicyEvaluationStatus = orderedReasons.some((reason) => reason === "CATEGORY_OUTSIDE_POLICY" || reason.endsWith("_EXCEEDED"))
    ? "OUTSIDE_POLICY"
    : orderedReasons.length
      ? "REVIEW_REQUIRED"
      : "WITHIN_POLICY";
  const citedExposureBasis = input.existingExposure.some((entry) => entry.basis === "OBSERVATION_ONLY")
    ? "OBSERVATION_ONLY" as const
    : input.existingExposure.length
      ? "PROJECTED" as const
      : "NONE" as const;

  return {
    proposal,
    policyVersion: policy.policyVersion,
    status,
    humanDecisionRequired: true,
    assumptionFields: ["amountMinor", "currency", "category", "thirteenWeekMinor", "annualMinor"],
    citedEvidenceIds: [...citedEvidenceIds].sort(),
    citedExposureBasis,
    reasonCodes: orderedReasons,
    currencyResults,
  };
}

function normalizeProposal(proposal: ProposalForPolicy): ProposalForPolicy {
  if (!proposalCategories.includes(proposal.category)) throw new Error("Proposal category is not supported.");
  return {
    proposalId: requireUuid(proposal.proposalId, "Proposal id"),
    amountMinor: parsePositiveMinorUnits(proposal.amountMinor, "Proposal amount").toString(),
    currency: normalizeCurrency(proposal.currency, "Proposal currency"),
    category: proposal.category,
    thirteenWeekMinor: parseMinorUnits(proposal.thirteenWeekMinor, "Proposed 13-week exposure").toString(),
    annualMinor: parseMinorUnits(proposal.annualMinor, "Proposed annual exposure").toString(),
  };
}

export function normalizeProposalPolicy(policy: ProposalPolicy): ProposalPolicy {
  const normalized = parsePolicy(policy);
  assertRecordableControlPolicy(normalized);
  return {
    policyVersion: normalized.policyVersion,
    categoryRules: normalized.categoryRules,
    currencyLimits: normalized.currencyLimits.map((limit) => ({
      currency: limit.currency,
      maxPerChargeMinor: limit.maxPerChargeMinor.toString(),
      maxThirteenWeekMinor: limit.maxThirteenWeekMinor.toString(),
      maxAnnualMinor: limit.maxAnnualMinor.toString(),
    })),
  };
}

export function assertRecordableControlPolicy(policy: {
  categoryRules: readonly { category: ProposalCategory }[];
  currencyLimits: readonly unknown[];
}) {
  const seen = new Set(policy.categoryRules.map((rule) => rule.category));
  if (proposalCategories.some((category) => !seen.has(category))) {
    throw new Error("Policy must set a posture for every category.");
  }
  if (!policy.currencyLimits.length) {
    throw new Error("Policy must include at least one currency with three positive caps.");
  }
}

function parsePolicy(policy: ProposalPolicy) {
  if (!Number.isSafeInteger(policy.policyVersion) || policy.policyVersion < 1) throw new Error("Policy version must be a positive integer.");
  const seenCategories = new Set<ProposalCategory>();
  const categoryRules = policy.categoryRules.map((rule) => {
    if (!proposalCategories.includes(rule.category) || !categoryPostures.includes(rule.posture)) throw new Error("Policy category rule is not supported.");
    if (seenCategories.has(rule.category)) throw new Error("Policy categories must be unique.");
    seenCategories.add(rule.category);
    return { ...rule };
  });
  const seenCurrencies = new Set<string>();
  const currencyLimits = policy.currencyLimits.map((limit) => {
    const currency = normalizeCurrency(limit.currency, "Policy currency");
    if (seenCurrencies.has(currency)) throw new Error("Policy currencies must be unique.");
    seenCurrencies.add(currency);
    return {
      currency,
      maxPerChargeMinor: parsePositiveMinorUnits(limit.maxPerChargeMinor, "Per-charge limit"),
      maxThirteenWeekMinor: parsePositiveMinorUnits(limit.maxThirteenWeekMinor, "13-week limit"),
      maxAnnualMinor: parsePositiveMinorUnits(limit.maxAnnualMinor, "Annual limit"),
    };
  });
  return { policyVersion: policy.policyVersion, categoryRules, currencyLimits };
}