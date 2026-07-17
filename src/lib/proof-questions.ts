export const proofQuestionIntents = [
  "overview",
  "highest-spend",
  "weak-proof",
  "stale-proof",
  "upcoming-renewals",
  "verified-savings",
  "source-priority",
  "merchant",
  "unsupported",
] as const;

export type ProofQuestionIntent = typeof proofQuestionIntents[number];

export type ProofQuestionCommitment = {
  id: string;
  merchant: string;
  normalizedMerchant: string;
  category: string;
  frequency: string;
  currency: string;
  monthlyCost: number;
  annualCost: number;
  nextExpectedDate: string | null;
  lastChargeDate: string | null;
  confidenceScore: number;
  proofDensity: number | null;
  sourceDiversity: number | null;
  freshness: number | null;
  cadenceStability: number | null;
  evidenceCount: number;
  sourceNames: string[];
  newestEvidenceDate: string | null;
};

export type ProofQuestionSaving = {
  id: string;
  actionCaseId: string;
  merchant: string;
  currency: string;
  verifiedMonthlySaving: number;
  verifiedAnnualSaving: number;
  cleanCycles: number;
  requiredCleanCycles: number;
  coverageStart: string;
  coverageEnd: string;
  mintedAt: string;
};

export type ProofQuestionDataset = {
  graphRevision: number;
  asOf: string;
  commitments: ProofQuestionCommitment[];
  savings: ProofQuestionSaving[];
};

export type ProofCitation = {
  id: string;
  kind: "ledger-aggregate" | "commitment" | "verified-saving";
  title: string;
  entityId: string | null;
  graphRevision: number;
  observedAt: string;
  sourceNames: string[];
};

export type CitedClaim = {
  label: string;
  value: string;
  text: string;
  citationIds: string[];
};

export type CitedProofAnswer = {
  intent: ProofQuestionIntent;
  answerable: boolean;
  question: string;
  summary: { text: string; citationIds: string[] };
  claims: CitedClaim[];
  citations: ProofCitation[];
  limitations: string[];
  suggestedQuestions: string[];
};

const supportedSuggestions = [
  "What is my total recurring spend?",
  "Which commitments have the weakest proof?",
  "What renews next?",
  "How much have I verifiably stopped paying?",
];

export function answerProofQuestion(questionInput: unknown, dataset: ProofQuestionDataset): CitedProofAnswer {
  const question = normalizeQuestion(questionInput);
  const matchedMerchant = findMerchant(question, dataset.commitments);
  const intent = compileProofQuestion(question, Boolean(matchedMerchant));
  const answer = buildAnswer(intent, question, dataset, matchedMerchant);
  assertEveryClaimIsCited(answer);
  return answer;
}

export function compileProofQuestion(question: string, merchantMatched = false): ProofQuestionIntent {
  const value = normalizeForSearch(question);
  if (/verified sav|stopped paying|actually sav|proven sav/.test(value)) return "verified-savings";
  if (/weak|single source|low confidence|uncertain|unproven|least proven/.test(value)) return "weak-proof";
  if (/stale|outdated|old proof|freshness|gone quiet/.test(value)) return "stale-proof";
  if (/renew|upcoming|next (charge|debit|payment)|due next/.test(value)) return "upcoming-renewals";
  if (/which source|what source|source.*(add|connect|improve)|raise.*confidence|strengthen.*proof/.test(value)) return "source-priority";
  if (/highest|largest|most expensive|costliest|top spend|biggest/.test(value)) return "highest-spend";
  if (/total|how much|monthly spend|annual spend|recurring spend|overview|summary/.test(value)) return "overview";
  if (merchantMatched) return "merchant";
  return "unsupported";
}

export function assertEveryClaimIsCited(answer: CitedProofAnswer) {
  if (!answer.answerable) return answer;
  const citationIds = new Set(answer.citations.map((citation) => citation.id));
  if (!answer.summary.citationIds.length) throw new Error("A cited proof answer summary must include evidence.");
  for (const id of answer.summary.citationIds) {
    if (!citationIds.has(id)) throw new Error(`Summary citation ${id} is missing.`);
  }
  for (const claim of answer.claims) {
    if (!claim.citationIds.length) throw new Error(`Claim ${claim.label} has no citation.`);
    for (const id of claim.citationIds) {
      if (!citationIds.has(id)) throw new Error(`Claim citation ${id} is missing.`);
    }
  }
  return answer;
}

function buildAnswer(
  intent: ProofQuestionIntent,
  question: string,
  dataset: ProofQuestionDataset,
  merchant: ProofQuestionCommitment | null,
): CitedProofAnswer {
  if (intent === "unsupported") return unsupportedAnswer(question);
  if (intent === "merchant" && merchant) return merchantAnswer(question, dataset, merchant);
  if (intent === "verified-savings") return savingsAnswer(question, dataset);
  if (intent === "overview") return overviewAnswer(question, dataset);

  const ordered = selectCommitments(intent, dataset.commitments, dataset.asOf).slice(0, 5);
  const citations = ordered.map((item) => commitmentCitation(item, dataset));
  if (!ordered.length) {
    const aggregate = aggregateCitation(dataset, "all");
    return {
      intent,
      answerable: true,
      question,
      summary: { text: emptyResultSummary(intent), citationIds: [aggregate.id] },
      claims: [{ label: "Result", value: "None", text: emptyResultSummary(intent), citationIds: [aggregate.id] }],
      citations: [aggregate],
      limitations: standardLimitations(dataset),
      suggestedQuestions: supportedSuggestions,
    };
  }

  const claims = ordered.map((item) => commitmentClaim(intent, item));
  const first = ordered[0];
  const summaryText = intent === "highest-spend"
    ? `${first.merchant} is the largest evidenced recurring commitment in ${first.currency} at ${formatMoney(first.monthlyCost, first.currency)} per month.`
    : intent === "upcoming-renewals"
      ? `${first.merchant} is the next evidenced renewal, expected on ${first.nextExpectedDate}.`
      : intent === "source-priority"
        ? `${first.merchant} is the highest-value commitment that would benefit most from another independent proof source.`
        : intent === "stale-proof"
          ? `${first.merchant} currently has the stalest high-value proof among the returned commitments.`
          : `${first.merchant} currently has the weakest high-value proof among the returned commitments.`;
  return {
    intent,
    answerable: true,
    question,
    summary: { text: summaryText, citationIds: [citations[0].id] },
    claims: claims.map((claim, index) => ({ ...claim, citationIds: [citations[index].id] })),
    citations,
    limitations: standardLimitations(dataset),
    suggestedQuestions: supportedSuggestions,
  };
}

function overviewAnswer(question: string, dataset: ProofQuestionDataset): CitedProofAnswer {
  const currencies = [...new Set(dataset.commitments.map((item) => item.currency))].sort();
  const citations = currencies.length
    ? currencies.map((currency) => aggregateCitation(dataset, currency))
    : [aggregateCitation(dataset, "all")];
  const claims = currencies.map((currency) => {
    const items = dataset.commitments.filter((item) => item.currency === currency);
    const monthly = sum(items.map((item) => item.monthlyCost));
    const annual = sum(items.map((item) => item.annualCost));
    const citationId = aggregateCitationId(currency, dataset.graphRevision);
    return {
      label: `${currency} recurring spend`,
      value: `${formatMoney(monthly, currency)}/month`,
      text: `${items.length} evidenced commitment${items.length === 1 ? "" : "s"} total ${formatMoney(monthly, currency)} per month and ${formatMoney(annual, currency)} per year.`,
      citationIds: [citationId],
    };
  });
  if (!claims.length) claims.push({
    label: "Recurring commitments",
    value: "0",
    text: "The canonical ledger currently contains no recurring commitments.",
    citationIds: [citations[0].id],
  });
  return {
    intent: "overview",
    answerable: true,
    question,
    summary: {
      text: currencies.length > 1
        ? `Recurring spend is kept separate across ${currencies.length} currencies; Vognary does not add unlike currencies.`
        : claims[0].text,
      citationIds: citations.map((citation) => citation.id),
    },
    claims,
    citations,
    limitations: standardLimitations(dataset),
    suggestedQuestions: supportedSuggestions,
  };
}

function savingsAnswer(question: string, dataset: ProofQuestionDataset): CitedProofAnswer {
  const citations = dataset.savings.map((saving) => savingCitation(saving, dataset));
  if (!dataset.savings.length) {
    const aggregate = aggregateCitation(dataset, "verified-savings");
    return {
      intent: "verified-savings",
      answerable: true,
      question,
      summary: { text: "No saving receipt has passed Vognary's proof window yet.", citationIds: [aggregate.id] },
      claims: [{ label: "Verified savings", value: "0 receipts", text: "There are no active verified-saving receipts in this workspace.", citationIds: [aggregate.id] }],
      citations: [aggregate],
      limitations: standardLimitations(dataset),
      suggestedQuestions: supportedSuggestions,
    };
  }
  const currencies = [...new Set(dataset.savings.map((saving) => saving.currency))].sort();
  const claims: CitedClaim[] = currencies.map((currency) => {
    const savings = dataset.savings.filter((saving) => saving.currency === currency);
    return {
      label: `${currency} verified savings`,
      value: `${formatMoney(sum(savings.map((saving) => saving.verifiedAnnualSaving)), currency)}/year`,
      text: `${savings.length} proof-gated receipt${savings.length === 1 ? "" : "s"} verify ${formatMoney(sum(savings.map((saving) => saving.verifiedMonthlySaving)), currency)} per month is no longer leaving.`,
      citationIds: savings.map((saving) => `saving:${saving.id}`),
    };
  });
  return {
    intent: "verified-savings",
    answerable: true,
    question,
    summary: { text: claims.map((claim) => claim.value).join(" · "), citationIds: citations.map((citation) => citation.id) },
    claims,
    citations,
    limitations: standardLimitations(dataset),
    suggestedQuestions: supportedSuggestions,
  };
}

function merchantAnswer(question: string, dataset: ProofQuestionDataset, item: ProofQuestionCommitment): CitedProofAnswer {
  const citation = commitmentCitation(item, dataset);
  return {
    intent: "merchant",
    answerable: true,
    question,
    summary: {
      text: `${item.merchant} is evidenced at ${formatMoney(item.monthlyCost, item.currency)} per month with ${item.evidenceCount} proof row${item.evidenceCount === 1 ? "" : "s"}.`,
      citationIds: [citation.id],
    },
    claims: [
      { label: "Annual cost", value: formatMoney(item.annualCost, item.currency), text: `The canonical annualized cost is ${formatMoney(item.annualCost, item.currency)}.`, citationIds: [citation.id] },
      { label: "Confidence", value: `${item.confidenceScore}%`, text: confidenceText(item), citationIds: [citation.id] },
      { label: "Next expected", value: item.nextExpectedDate ?? "Not proven", text: item.nextExpectedDate ? `The next expected debit is ${item.nextExpectedDate}.` : "No next debit date is proven yet.", citationIds: [citation.id] },
    ],
    citations: [citation],
    limitations: standardLimitations(dataset),
    suggestedQuestions: supportedSuggestions,
  };
}

function selectCommitments(intent: ProofQuestionIntent, commitments: ProofQuestionCommitment[], asOf: string) {
  if (intent === "highest-spend") return [...commitments].sort(byMonthlyDesc);
  if (intent === "upcoming-renewals") return commitments
    .filter((item) => item.nextExpectedDate && item.nextExpectedDate >= asOf.slice(0, 10))
    .sort((left, right) => String(left.nextExpectedDate).localeCompare(String(right.nextExpectedDate)) || byMonthlyDesc(left, right));
  if (intent === "stale-proof") return commitments
    .filter((item) => item.freshness === null || item.freshness < 0.7)
    .sort((left, right) => (left.freshness ?? -1) - (right.freshness ?? -1) || byMonthlyDesc(left, right));
  return commitments
    .filter((item) => item.sourceDiversity === null || item.sourceDiversity <= 0.55 || item.confidenceScore < 80)
    .sort((left, right) => weaknessScore(right) - weaknessScore(left) || byMonthlyDesc(left, right));
}

function commitmentClaim(intent: ProofQuestionIntent, item: ProofQuestionCommitment): Omit<CitedClaim, "citationIds"> {
  if (intent === "highest-spend") return {
    label: item.merchant,
    value: `${formatMoney(item.monthlyCost, item.currency)}/month`,
    text: `${formatMoney(item.annualCost, item.currency)} annualized across ${item.evidenceCount} evidence row${item.evidenceCount === 1 ? "" : "s"}.`,
  };
  if (intent === "upcoming-renewals") return {
    label: item.merchant,
    value: item.nextExpectedDate ?? "Not proven",
    text: `${formatMoney(item.monthlyCost, item.currency)} monthly equivalent; next expected debit ${item.nextExpectedDate}.`,
  };
  if (intent === "stale-proof") return {
    label: item.merchant,
    value: item.newestEvidenceDate ?? "No observed date",
    text: `Freshness component ${formatComponent(item.freshness)}; ${item.evidenceCount} proof row${item.evidenceCount === 1 ? "" : "s"}.`,
  };
  if (intent === "source-priority") return {
    label: item.merchant,
    value: `${formatMoney(item.monthlyCost, item.currency)}/month`,
    text: `${sourceCount(item)} current source${sourceCount(item) === 1 ? "" : "s"}; add an independent statement or receipt that covers this same commitment.`,
  };
  return {
    label: item.merchant,
    value: `${item.confidenceScore}% confidence`,
    text: confidenceText(item),
  };
}

function commitmentCitation(item: ProofQuestionCommitment, dataset: ProofQuestionDataset): ProofCitation {
  return {
    id: `commitment:${item.id}`,
    kind: "commitment",
    title: `${item.merchant} · ${item.evidenceCount} proof row${item.evidenceCount === 1 ? "" : "s"}`,
    entityId: item.id,
    graphRevision: dataset.graphRevision,
    observedAt: item.newestEvidenceDate ?? item.lastChargeDate ?? dataset.asOf,
    sourceNames: item.sourceNames,
  };
}

function savingCitation(saving: ProofQuestionSaving, dataset: ProofQuestionDataset): ProofCitation {
  return {
    id: `saving:${saving.id}`,
    kind: "verified-saving",
    title: `${saving.merchant} · ${saving.cleanCycles}/${saving.requiredCleanCycles} clean proof cycles`,
    entityId: saving.id,
    graphRevision: dataset.graphRevision,
    observedAt: saving.coverageEnd,
    sourceNames: ["Verified saving receipt"],
  };
}

function aggregateCitation(dataset: ProofQuestionDataset, currency: string): ProofCitation {
  const relevantRows = currency === "verified-savings"
    ? dataset.savings.length
    : currency === "all"
      ? dataset.commitments.length
      : dataset.commitments.filter((item) => item.currency === currency).length;
  return {
    id: aggregateCitationId(currency, dataset.graphRevision),
    kind: "ledger-aggregate",
    title: `Canonical ledger aggregate · ${relevantRows} row${relevantRows === 1 ? "" : "s"}`,
    entityId: null,
    graphRevision: dataset.graphRevision,
    observedAt: dataset.asOf,
    sourceNames: ["Living Proof Graph"],
  };
}

function aggregateCitationId(currency: string, revision: number) {
  return `ledger:${currency.toLowerCase()}:${revision}`;
}

function findMerchant(question: string, commitments: ProofQuestionCommitment[]) {
  const normalized = normalizeForSearch(question);
  return [...commitments]
    .filter((item) => {
      const merchant = normalizeForSearch(item.merchant);
      const normalizedMerchant = normalizeForSearch(item.normalizedMerchant);
      return (merchant.length >= 3 && normalized.includes(merchant))
        || (normalizedMerchant.length >= 3 && normalized.includes(normalizedMerchant));
    })
    .sort((left, right) => right.normalizedMerchant.length - left.normalizedMerchant.length)[0] ?? null;
}

function unsupportedAnswer(question: string): CitedProofAnswer {
  return {
    intent: "unsupported",
    answerable: false,
    question,
    summary: { text: "I could not compile that question into a supported Proof Graph query, so I will not guess.", citationIds: [] },
    claims: [],
    citations: [],
    limitations: ["Ask about recurring totals, largest costs, weak or stale proof, upcoming renewals, source priority, verified savings, or a merchant already in the ledger."],
    suggestedQuestions: supportedSuggestions,
  };
}

function emptyResultSummary(intent: ProofQuestionIntent) {
  if (intent === "upcoming-renewals") return "No future renewal date is currently proven in the canonical ledger.";
  if (intent === "stale-proof") return "No commitment currently falls below the stale-proof threshold.";
  return "No commitment currently falls below the weak-proof threshold.";
}

function standardLimitations(dataset: ProofQuestionDataset) {
  return [
    `Answer compiled from graph revision ${dataset.graphRevision}; evidence added after ${dataset.asOf} is not included.`,
    "Currencies are never converted or added together.",
  ];
}

function confidenceText(item: ProofQuestionCommitment) {
  return `${item.evidenceCount} proof row${item.evidenceCount === 1 ? "" : "s"} across ${sourceCount(item)} source${sourceCount(item) === 1 ? "" : "s"}; proof density ${formatComponent(item.proofDensity)}, source diversity ${formatComponent(item.sourceDiversity)}, freshness ${formatComponent(item.freshness)}, cadence stability ${formatComponent(item.cadenceStability)}.`;
}

function weaknessScore(item: ProofQuestionCommitment) {
  return item.monthlyCost * (1 - item.confidenceScore / 100) + (item.sourceDiversity === null || item.sourceDiversity <= 0.55 ? item.monthlyCost : 0);
}

function sourceCount(item: ProofQuestionCommitment) {
  return new Set(item.sourceNames.map((source) => source.toLowerCase())).size;
}

function normalizeQuestion(value: unknown) {
  if (typeof value !== "string") throw new Error("Question must be text.");
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length < 3 || normalized.length > 300) throw new Error("Question must contain 3 to 300 characters.");
  return normalized;
}

function normalizeForSearch(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9₹$€£]+/g, " ").replace(/\s+/g, " ").trim();
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatComponent(value: number | null) {
  return value === null ? "not computed" : `${Math.round(value * 100)}%`;
}

function sum(values: number[]) {
  return Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;
}

function byMonthlyDesc(left: ProofQuestionCommitment, right: ProofQuestionCommitment) {
  return right.monthlyCost - left.monthlyCost || left.merchant.localeCompare(right.merchant);
}
