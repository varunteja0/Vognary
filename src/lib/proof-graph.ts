import { primaryCurrency, type RecurringItem } from "./recurring-audit";
import { parseCalendarDate } from "./date-only";

export type ProofSourceStat = {
  source: string;
  itemCount: number;
  monthlySpend: number;
};

export type NextBestSource = {
  suggestion: string;
  reason: string;
  monthlyAtStake: number;
  merchants: string[];
};

export type ProofGraphSummary = {
  totalMonthly: number;
  itemCount: number;
  /** Spend proven by exactly one source — the trust-weakest rupees. */
  singleSourceMonthly: number;
  singleSourceShare: number;
  multiSourceMonthly: number;
  /** Spend whose evidence trail has gone quiet (2+ unproven cycles). */
  staleMonthly: number;
  averageProofRows: number;
  newestEvidenceDate: string | null;
  sources: ProofSourceStat[];
  nextBestSources: NextBestSource[];
};

export type ProofGraphOptions = {
  today?: Date;
};

export const proofConfidenceModelVersion = "proof-graph-confidence-v1";

export type ConfidenceExplanation = {
  score: number;
  modelVersion: typeof proofConfidenceModelVersion;
  proofDensity: number;
  sourceDiversity: number;
  freshness: number;
  cadenceStability: number;
  reasons: string[];
};

// The Proof Graph reads the evidence structure behind the ledger and answers:
// which rupees rest on one source, which have gone stale, and which single
// connection would strengthen the most spend. Confidence becomes explainable
// instead of a bare number.
export function buildProofGraphSummary(items: RecurringItem[], options: ProofGraphOptions = {}): ProofGraphSummary {
  const today = options.today ?? new Date();
  // Money totals are deliberately primary-currency only. Counts and freshness
  // still cover every commitment, but unlike currencies are never added.
  const totalMonthly = sumMonthly(items);

  let singleSourceMonthly = 0;
  let multiSourceMonthly = 0;
  let staleMonthly = 0;
  let proofRows = 0;
  let newestEvidence: string | null = null;

  const sourceStats = new Map<string, ProofSourceStat>();
  const statementOnly: RecurringItem[] = [];
  const manualOnly: RecurringItem[] = [];
  const mandateShaped: RecurringItem[] = [];

  for (const item of items) {
    const isPrimaryCurrency = item.currency === primaryCurrency;
    proofRows += item.evidence.length;
    const sourceCount = new Set(item.sourceNames.map((name) => name.toLowerCase())).size;
    if (isPrimaryCurrency && sourceCount <= 1) singleSourceMonthly += item.monthlyCost;
    else if (isPrimaryCurrency) multiSourceMonthly += item.monthlyCost;
    if (isPrimaryCurrency && item.missedCycles >= 2) staleMonthly += item.monthlyCost;

    for (const link of item.evidence) {
      // Future-dated rows (a manual item's expected renewal) are forward-looking
      // markers, not observations — they must not inflate evidence freshness.
      const linkDate = parseCalendarDate(link.date);
      if (!linkDate || linkDate > today) continue;
      if (!newestEvidence || link.date > newestEvidence) newestEvidence = link.date;
    }

    for (const source of item.sourceNames) {
      const existing = sourceStats.get(source) ?? { source, itemCount: 0, monthlySpend: 0 };
      existing.itemCount += 1;
      if (isPrimaryCurrency) existing.monthlySpend += item.monthlyCost;
      sourceStats.set(source, existing);
    }

    const sourceText = item.sourceNames.join(" ").toLowerCase();
    const isStatementBacked = /statement|\.csv|\.pdf|converted/.test(sourceText);
    const isReceiptBacked = /receipt|gmail|invoice/.test(sourceText);
    const isMandateCategory = ["Mandates", "App store", "Debt", "Investments", "Insurance"].includes(item.category)
      || /mandate|autopay/i.test(`${item.merchant} ${sourceText}`);

    if (isPrimaryCurrency && sourceCount <= 1) {
      if (isMandateCategory && !isStatementBacked) mandateShaped.push(item);
      else if (isStatementBacked && !isReceiptBacked) statementOnly.push(item);
      else if (!isStatementBacked) manualOnly.push(item);
    }
  }

  const nextBestSources = rankNextBestSources(statementOnly, manualOnly, mandateShaped);

  return {
    totalMonthly,
    itemCount: items.length,
    singleSourceMonthly,
    singleSourceShare: totalMonthly > 0 ? singleSourceMonthly / totalMonthly : 0,
    multiSourceMonthly,
    staleMonthly,
    averageProofRows: items.length ? proofRows / items.length : 0,
    newestEvidenceDate: newestEvidence,
    sources: [...sourceStats.values()].sort((left, right) => right.monthlySpend - left.monthlySpend),
    nextBestSources,
  };
}

/**
 * Explainable graph confidence. It deliberately does not reuse the legacy
 * detector score: every component is derived from evidence structure and can
 * be shown to the user. The geometric mean prevents one strong dimension from
 * hiding a missing one, while avoiding the collapse of a raw product.
 */
export function explainProofConfidence(item: RecurringItem, options: ProofGraphOptions = {}): ConfidenceExplanation {
  const today = options.today ?? new Date();
  const observed = item.evidence
    .filter((entry) => entry.kind !== "scheduled")
    .flatMap((entry) => {
      const date = parseCalendarDate(entry.date);
      return date && date <= today ? [{ ...entry, parsedDate: date }] : [];
    })
    .sort((left, right) => left.parsedDate.getTime() - right.parsedDate.getTime());
  const requiredRows = requiredProofRows(item.frequency);
  const proofDensity = clamp01(observed.length / requiredRows);
  const independentSources = new Set(item.sourceNames.map(normalizeSourceIdentity).filter(Boolean)).size;
  const sourceDiversity = independentSources === 0 ? 0 : independentSources === 1 ? 0.55 : independentSources === 2 ? 0.82 : 1;
  const cycleDays = cadenceDays(item.frequency, item.averageGapDays);
  const latest = observed.at(-1)?.parsedDate ?? null;
  const ageDays = latest ? Math.max(0, Math.floor((startOfDay(today).getTime() - startOfDay(latest).getTime()) / 86_400_000)) : Infinity;
  const freshness = latest ? clamp01(1 - Math.max(0, ageDays - cycleDays) / (cycleDays * 3)) : 0;
  const cadenceStability = calculateCadenceStability(observed.map((entry) => entry.parsedDate), cycleDays);
  const product = proofDensity * sourceDiversity * freshness * cadenceStability;
  const score = product <= 0 ? 0 : Math.min(99, Math.round(99 * product ** 0.25));
  const reasons = [
    `${observed.length} observed proof row(s); ${requiredRows} expected for ${item.frequency} confidence.`,
    independentSources >= 2
      ? `${independentSources} independent source labels corroborate this commitment.`
      : independentSources === 1
        ? "Only one source currently supports this commitment."
        : "No observed source currently supports this commitment.",
    latest
      ? `Newest observed proof is ${ageDays} day(s) old against a ${Math.round(cycleDays)}-day cadence.`
      : "No usable observed proof date is available.",
    observed.length >= 3
      ? "Cadence stability is computed from observed intervals."
      : "More observed cycles are needed for strong cadence stability.",
  ];
  return {
    score,
    modelVersion: proofConfidenceModelVersion,
    proofDensity,
    sourceDiversity,
    freshness,
    cadenceStability,
    reasons,
  };
}

function rankNextBestSources(
  statementOnly: RecurringItem[],
  manualOnly: RecurringItem[],
  mandateShaped: RecurringItem[],
): NextBestSource[] {
  const suggestions: NextBestSource[] = [];

  const statementSpend = sumMonthly(statementOnly);
  if (statementOnly.length) {
    suggestions.push({
      suggestion: "Connect Gmail receipts",
      reason: "These commitments are proven only by statement rows. A matching receipt raises confidence and catches plan changes early.",
      monthlyAtStake: statementSpend,
      merchants: topMerchants(statementOnly),
    });
  }

  const manualSpend = sumMonthly(manualOnly);
  if (manualOnly.length) {
    suggestions.push({
      suggestion: "Import a bank/card statement",
      reason: "These commitments rest on manual or receipt evidence alone. One statement export proves the actual debits.",
      monthlyAtStake: manualSpend,
      merchants: topMerchants(manualOnly),
    });
  }

  const mandateSpend = sumMonthly(mandateShaped);
  if (mandateShaped.length) {
    suggestions.push({
      suggestion: "Run guided mandate capture",
      reason: "Mandate-shaped commitments need the source screen (UPI app, bank e-mandate list, app store) confirmed to trust amount and next debit.",
      monthlyAtStake: mandateSpend,
      merchants: topMerchants(mandateShaped),
    });
  }

  return suggestions.sort((left, right) => right.monthlyAtStake - left.monthlyAtStake).slice(0, 3);
}

function sumMonthly(items: RecurringItem[]): number {
  return items
    .filter((item) => item.currency === primaryCurrency)
    .reduce((total, item) => total + item.monthlyCost, 0);
}

function topMerchants(items: RecurringItem[]): string[] {
  return [...items]
    .sort((left, right) => right.monthlyCost - left.monthlyCost)
    .slice(0, 2)
    .map((item) => item.merchant);
}

function requiredProofRows(frequency: RecurringItem["frequency"]) {
  if (frequency === "weekly") return 4;
  if (frequency === "biweekly" || frequency === "monthly" || frequency === "irregular") return 3;
  if (frequency === "semimonthly") return 4;
  if (frequency === "bimonthly" || frequency === "quarterly") return 2;
  return 1;
}

function cadenceDays(frequency: RecurringItem["frequency"], observedAverage: number) {
  if (Number.isFinite(observedAverage) && observedAverage > 0) return observedAverage;
  if (frequency === "weekly") return 7;
  if (frequency === "biweekly") return 14;
  if (frequency === "semimonthly") return 15.22;
  if (frequency === "monthly") return 30.44;
  if (frequency === "bimonthly") return 60.88;
  if (frequency === "quarterly") return 91.31;
  if (frequency === "yearly") return 365.24;
  return 30.44;
}

function calculateCadenceStability(dates: Date[], expectedGapDays: number) {
  if (dates.length < 2) return 0.45;
  const gaps = dates.slice(1).map((date, index) => Math.max(1, (date.getTime() - dates[index].getTime()) / 86_400_000));
  const meanDeviation = gaps.reduce((total, gap) => total + Math.abs(gap - expectedGapDays), 0) / gaps.length;
  return clamp01(1 - meanDeviation / Math.max(expectedGapDays, 1));
}

function normalizeSourceIdentity(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
