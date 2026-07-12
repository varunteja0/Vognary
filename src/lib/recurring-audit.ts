import { parseIsoDateOnly } from "./date-only";
import { getCommitmentPolicy, type CommitmentPolicy } from "./commitment-policy";

export type Frequency =
  | "weekly"
  | "biweekly"
  | "semimonthly"
  | "monthly"
  | "bimonthly"
  | "quarterly"
  | "yearly"
  | "irregular";

export type Direction = "debit" | "credit" | "unknown";

export type ParsedTransaction = {
  id: string;
  rowNumber: number;
  source: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
  direction: Direction;
  normalizedMerchant: string;
  category: string;
};

export type EvidenceLink = {
  date: string;
  amount: number;
  description: string;
  source: string;
  rowNumber: number;
  /** Scheduled/manual evidence must never be mistaken for an observed debit. */
  kind?: "observed-charge" | "scheduled";
};

export type RecommendationType = "keep" | "watch" | "downgrade" | "cancel" | "investigate";

export type PriceChange = {
  direction: "increase" | "decrease";
  previousAmount: number;
  latestAmount: number;
  changePercent: number;
};

export type RecurringItem = {
  id: string;
  /** Canonical PostgreSQL id when this item includes server-synced evidence. */
  canonicalRecurringItemId?: string;
  /**
   * Stable identity for user state (actions, notes, owners, merge decisions).
   * Derived from merchant + currency, NOT charge dates, so importing next
   * month's statement never orphans the user's review work.
   */
  identityKey: string;
  merchant: string;
  normalizedMerchant: string;
  category: string;
  currency: string;
  frequency: Frequency;
  averageGapDays: number;
  amountMin: number;
  amountMax: number;
  averageAmount: number;
  monthlyCost: number;
  annualCost: number;
  lastChargeDate: string;
  nextExpectedDate: string;
  confidenceScore: number;
  recommendationType: RecommendationType;
  recommendationReason: string;
  riskTags: string[];
  evidence: EvidenceLink[];
  sourceNames: string[];
  missedCycles: number;
  priceChange: PriceChange | null;
};

export type AuditSummary = {
  transactionCount: number;
  recurringCount: number;
  /** Totals below are in the primary currency only; foreign spend is separate. */
  primaryCurrency: string;
  monthlyRecurringSpend: number;
  annualRecurringSpend: number;
  reviewableMonthlySpend: number;
  foreignMonthlyTotals: Record<string, number>;
  renewalsNextTenDays: number;
  averageConfidence: number;
};

export type AuditResult = {
  transactions: ParsedTransaction[];
  recurringItems: RecurringItem[];
  summary: AuditSummary;
  warnings: string[];
};

export type StatementSource = {
  name: string;
  text: string;
};

export type ManualRecurringInput = {
  id: string;
  canonicalRecurringItemId?: string;
  merchant: string;
  amount: number;
  currency?: string;
  frequency: Frequency;
  nextExpectedDate: string;
  category: string;
  sourceName?: string;
};

export type AnalyzeOptions = {
  today?: Date;
};

type MerchantRule = {
  pattern: RegExp;
  merchant: string;
  category: string;
};

type FrequencyModel = {
  frequency: Frequency;
  expectedGapDays: number;
  label: string;
};

const dayInMs = 24 * 60 * 60 * 1000;

export const primaryCurrency = "INR";

const merchantRules: MerchantRule[] = [
  { pattern: /OPEN\s?AI|CHATGPT|CHAT\s?GPT/i, merchant: "OpenAI", category: "AI tools" },
  { pattern: /ANTHROPIC|CLAUDE/i, merchant: "Anthropic", category: "AI tools" },
  { pattern: /KLING|KWAI/i, merchant: "Kling", category: "AI tools" },
  { pattern: /PERPLEXITY/i, merchant: "Perplexity", category: "AI tools" },
  { pattern: /RUNWAY|MIDJOURNEY|ELEVENLABS/i, merchant: "AI creative tool", category: "AI tools" },
  { pattern: /CURSOR|ANYSPHERE/i, merchant: "Cursor", category: "AI tools" },
  { pattern: /GITHUB|GIT\s?HUB/i, merchant: "GitHub", category: "Developer tools" },
  { pattern: /VERCEL/i, merchant: "Vercel", category: "Cloud hosting" },
  { pattern: /RENDER/i, merchant: "Render", category: "Cloud hosting" },
  { pattern: /AWS|AMAZON WEB SERVICES/i, merchant: "AWS", category: "Cloud hosting" },
  { pattern: /GOOGLE CLOUD|GCP|CLOUD GOOGLE/i, merchant: "Google Cloud", category: "Cloud hosting" },
  { pattern: /DIGITAL\s?OCEAN/i, merchant: "DigitalOcean", category: "Cloud hosting" },
  { pattern: /NETFLIX/i, merchant: "Netflix", category: "Streaming" },
  { pattern: /SPOTIFY/i, merchant: "Spotify", category: "Streaming" },
  { pattern: /YOUTUBE|GOOGLE\*YOUTUBE/i, merchant: "YouTube", category: "Streaming" },
  { pattern: /APPLE|ICLOUD|APP STORE/i, merchant: "Apple", category: "App store" },
  { pattern: /GOOGLE PLAY|PLAYSTORE|PLAY STORE/i, merchant: "Google Play", category: "App store" },
  { pattern: /ADOBE/i, merchant: "Adobe", category: "Creative tools" },
  { pattern: /CANVA/i, merchant: "Canva", category: "Creative tools" },
  { pattern: /FIGMA/i, merchant: "Figma", category: "Design tools" },
  { pattern: /NOTION/i, merchant: "Notion", category: "Productivity" },
  { pattern: /SLACK/i, merchant: "Slack", category: "Productivity" },
  { pattern: /ZOOM/i, merchant: "Zoom", category: "Productivity" },
  { pattern: /X\.COM|TWITTER|X PREMIUM/i, merchant: "X", category: "Social tools" },
  { pattern: /RAZORPAY/i, merchant: "Razorpay", category: "Payments" },
  { pattern: /CASHFREE/i, merchant: "Cashfree", category: "Payments" },
  { pattern: /HOSTINGER|GODADDY|NAMECHEAP|CLOUDFLARE/i, merchant: "Domain or hosting provider", category: "Domains" },
  { pattern: /\b(?:LOAN|EMI|ECS|NACH)\b/i, merchant: "Loan or EMI", category: "Debt" },
  { pattern: /SIP|MUTUAL FUND|ZERODHA|GROWW|KUVERA/i, merchant: "Investment SIP", category: "Investments" },
  { pattern: /INSURANCE|POLICY|LIC|HDFC LIFE|ICICI PRU/i, merchant: "Insurance", category: "Insurance" },
  { pattern: /AIRTEL|JIO|VI |VODAFONE/i, merchant: "Telecom", category: "Utilities" },
];

const frequencyModels: FrequencyModel[] = [
  { frequency: "weekly", expectedGapDays: 7, label: "weekly" },
  { frequency: "biweekly", expectedGapDays: 14, label: "biweekly" },
  { frequency: "semimonthly", expectedGapDays: 15.22, label: "twice a month" },
  { frequency: "monthly", expectedGapDays: 30.44, label: "monthly" },
  { frequency: "bimonthly", expectedGapDays: 60.88, label: "every two months" },
  { frequency: "quarterly", expectedGapDays: 91.31, label: "quarterly" },
  { frequency: "yearly", expectedGapDays: 365.25, label: "yearly" },
];

// semimonthly is detected by day-of-month bimodality, never by average gap —
// its ~15.2-day average would otherwise be swallowed by biweekly.
const gapMatchedModels = frequencyModels.filter((model) => model.frequency !== "semimonthly");

const singleOccurrenceCategoryRules: Record<string, Frequency> = {
  Insurance: "yearly",
  Domains: "yearly",
  Debt: "monthly",
  Investments: "monthly",
  Utilities: "monthly",
  "App store": "monthly",
};

const singleOccurrenceKeywordPattern = /renew|annual|yearly|membership|premium|policy|subscription|autopay|mandate|\bemi\b|\bsip\b/i;

const monthAnchoredFrequencies = new Set<Frequency>(["monthly", "bimonthly", "quarterly", "yearly"]);

const genericMerchantNames = new Set([
  "Domain or hosting provider",
  "Loan or EMI",
  "Investment SIP",
  "Insurance",
  "Telecom",
  "AI creative tool",
  "Unknown merchant",
]);

export function analyzeStatement(input: string, sourceName = "statement.csv", options: AnalyzeOptions = {}): AuditResult {
  return analyzeStatements([{ name: sourceName, text: input }], [], options);
}

export function analyzeStatements(
  sources: StatementSource[],
  manualItems: ManualRecurringInput[] = [],
  options: AnalyzeOptions = {},
): AuditResult {
  const today = startOfDay(options.today ?? new Date());
  const warnings: string[] = [];
  const uniqueSources = dedupeIdenticalSources(sources, warnings);
  const transactions = uniqueSources.flatMap((source) => parseCsvStatement(source.text, source.name, warnings));
  const detectedItems = detectRecurringItems(transactions, today);
  const recurringItems = assignIdentityKeys(
    mergeManualEvidence(detectedItems, manualItems, today),
  ).sort((left, right) => right.monthlyCost - left.monthlyCost);

  return {
    transactions,
    recurringItems,
    summary: summarizeAudit(transactions, recurringItems, today),
    warnings,
  };
}

// Importing the same file twice (same text, any filename) must never double
// the ledger. Identical source texts are analyzed once, with a warning.
function dedupeIdenticalSources(sources: StatementSource[], warnings: string[]): StatementSource[] {
  const seen = new Map<string, string>();
  const unique: StatementSource[] = [];

  for (const source of sources) {
    const existingName = seen.get(source.text);
    if (existingName !== undefined) {
      warnings.push(`"${source.name}" has identical content to "${existingName}" and was skipped to prevent double counting.`);
      continue;
    }
    seen.set(source.text, source.name);
    unique.push(source);
  }

  return unique;
}

export function createEmptyAudit(): AuditResult {
  return {
    transactions: [],
    recurringItems: [],
    summary: summarizeAudit([], [], startOfDay(new Date())),
    warnings: [],
  };
}

export function getFrequencyMonthlyMultiplier(frequency: Frequency): number {
  const model = frequencyModels.find((item) => item.frequency === frequency);
  const expectedGapDays = model?.expectedGapDays ?? 30.44;
  return 30.44 / expectedGapDays;
}

export function getFrequencyGapDays(frequency: Frequency): number {
  return frequencyModels.find((item) => item.frequency === frequency)?.expectedGapDays ?? 30.44;
}

export function advanceDateByFrequency(date: Date, frequency: Frequency, fallbackGapDays = 30.44, anchorDay?: number): Date {
  switch (frequency) {
    case "weekly":
      return addDays(date, 7);
    case "biweekly":
      return addDays(date, 14);
    case "semimonthly":
      return addDays(date, 15);
    case "monthly":
      return addMonthsAnchored(date, 1, anchorDay);
    case "bimonthly":
      return addMonthsAnchored(date, 2, anchorDay);
    case "quarterly":
      return addMonthsAnchored(date, 3, anchorDay);
    case "yearly":
      return addMonthsAnchored(date, 12, anchorDay);
    default:
      return addDays(date, Math.max(7, Math.round(fallbackGapDays || 30.44)));
  }
}

function summarizeAudit(transactions: ParsedTransaction[], recurringItems: RecurringItem[], today: Date): AuditSummary {
  const tenDaysFromNow = addDays(today, 10);
  const renewalsNextTenDays = recurringItems.filter((item) => {
    const nextDate = parseDate(item.nextExpectedDate);
    return nextDate && nextDate >= today && nextDate <= tenDaysFromNow;
  }).length;

  const primaryItems = recurringItems.filter((item) => item.currency === primaryCurrency);
  const monthlyRecurringSpend = primaryItems.reduce((total, item) => total + item.monthlyCost, 0);
  const reviewableMonthlySpend = primaryItems.reduce((total, item) => {
    if (["cancel", "downgrade", "investigate", "watch"].includes(item.recommendationType)) {
      return total + item.monthlyCost;
    }
    return total;
  }, 0);

  // Foreign-currency spend is reported separately, never silently summed into
  // primary-currency totals at a fictional exchange rate.
  const foreignMonthlyTotals: Record<string, number> = {};
  for (const item of recurringItems) {
    if (item.currency === primaryCurrency) continue;
    foreignMonthlyTotals[item.currency] = (foreignMonthlyTotals[item.currency] ?? 0) + item.monthlyCost;
  }

  const averageConfidence = recurringItems.length
    ? recurringItems.reduce((total, item) => total + item.confidenceScore, 0) / recurringItems.length
    : 0;

  return {
    transactionCount: transactions.length,
    recurringCount: recurringItems.length,
    primaryCurrency,
    monthlyRecurringSpend,
    annualRecurringSpend: monthlyRecurringSpend * 12,
    reviewableMonthlySpend,
    foreignMonthlyTotals,
    renewalsNextTenDays,
    averageConfidence,
  };
}

// Identity keys: merchant + currency, independent of charge dates. When one
// merchant genuinely carries multiple commitments (plan + usage), later items
// get a deterministic ::2/::3 suffix by cost rank.
function assignIdentityKeys(items: RecurringItem[]): RecurringItem[] {
  const byBase = new Map<string, RecurringItem[]>();
  for (const item of items) {
    const base = `${item.normalizedMerchant.trim().toLowerCase()}::${item.currency}`;
    const group = byBase.get(base);
    if (group) group.push(item);
    else byBase.set(base, [item]);
  }

  const keyed: RecurringItem[] = [];
  for (const [base, group] of byBase) {
    const ordered = [...group].sort((left, right) => right.monthlyCost - left.monthlyCost);
    ordered.forEach((item, index) => {
      keyed.push({ ...item, identityKey: index === 0 ? base : `${base}::${index + 1}` });
    });
  }
  return keyed;
}

function buildManualRecurringItem(input: ManualRecurringInput, today: Date): RecurringItem {
  const normalized = normalizeMerchant(input.merchant);
  const multiplier = getFrequencyMonthlyMultiplier(input.frequency);
  const averageGapDays = getFrequencyGapDays(input.frequency);
  const monthlyCost = input.amount * multiplier;
  const sourceName = input.sourceName || "manual entry";
  const currency = normalizeCurrency(input.currency);
  const projected = projectNextExpectedDate(input.nextExpectedDate, today, input.frequency, averageGapDays);
  const category = input.category || normalized.category;
  const policy = getCommitmentPolicy(category);
  const recommendation = recommendItem(category, monthlyCost, 72, projected.date, 0, today);
  const riskTags = new Set(["manual entry", ...recommendation.riskTags]);
  if (projected.missedCycles >= 1) riskTags.add(`${policy.terminology.nextEvent} passed; confirm status`);
  if (currency !== primaryCurrency) riskTags.add(`foreign currency (${currency})`);

  return {
    id: input.id,
    canonicalRecurringItemId: input.canonicalRecurringItemId,
    identityKey: `${normalized.merchant.trim().toLowerCase()}::${currency}`,
    merchant: input.merchant.trim() || normalized.merchant,
    normalizedMerchant: normalized.merchant,
    category,
    currency,
    frequency: input.frequency,
    averageGapDays,
    amountMin: input.amount,
    amountMax: input.amount,
    averageAmount: input.amount,
    monthlyCost,
    annualCost: monthlyCost * 12,
    lastChargeDate: input.nextExpectedDate,
    nextExpectedDate: projected.date,
    confidenceScore: 72,
    recommendationType: recommendation.type === "keep" ? "watch" : recommendation.type,
    recommendationReason: `Recorded from ${sourceName}. Verify the source. ${recommendation.reason}`,
    riskTags: [...riskTags],
    evidence: [
      {
        date: input.nextExpectedDate,
        amount: input.amount,
        description: input.merchant,
        source: sourceName,
        rowNumber: 1,
        kind: "scheduled",
      },
    ],
    sourceNames: [sourceName],
    missedCycles: projected.missedCycles,
    priceChange: null,
  };
}

function mergeManualEvidence(detected: RecurringItem[], manualInputs: ManualRecurringInput[], today: Date): RecurringItem[] {
  const items = [...detected];
  const standalone: RecurringItem[] = [];

  for (const input of manualInputs) {
    const manualItem = buildManualRecurringItem(input, today);

    const detectedIndex = items.findIndex((item) => canMergeEvidence(item, manualItem));
    if (detectedIndex !== -1) {
      items[detectedIndex] = mergeEvidence(items[detectedIndex], manualItem, input, today);
      continue;
    }

    const standaloneIndex = standalone.findIndex((item) => canMergeEvidence(item, manualItem));
    if (standaloneIndex !== -1) {
      standalone[standaloneIndex] = mergeEvidence(standalone[standaloneIndex], manualItem, input, today);
      continue;
    }

    standalone.push(manualItem);
  }

  return [...items, ...standalone];
}

function canMergeEvidence(item: RecurringItem, manual: RecurringItem): boolean {
  if (item.normalizedMerchant.toLowerCase() !== manual.normalizedMerchant.toLowerCase()) return false;
  // A USD charge and an INR charge are different commitments, whatever the name.
  if (item.currency !== manual.currency) return false;

  const frequencyCompatible = item.frequency === manual.frequency
    || item.frequency === "irregular"
    || manual.frequency === "irregular";
  if (!frequencyCompatible) return false;

  const larger = Math.max(item.averageAmount, manual.averageAmount);
  if (!larger) return false;
  return Math.abs(item.averageAmount - manual.averageAmount) / larger <= 0.25;
}

function mergeEvidence(target: RecurringItem, manual: RecurringItem, input: ManualRecurringInput, today: Date): RecurringItem {
  const evidence = [...target.evidence, ...manual.evidence].sort((left, right) => compareDate(left.date, right.date));
  const sourceNames = [...new Set([...target.sourceNames, ...manual.sourceNames])];
  const amounts = evidence.map((link) => link.amount).filter((amount) => Number.isFinite(amount) && amount > 0);
  const averageAmount = average(amounts);
  const amountMin = amounts.length ? Math.min(...amounts) : target.amountMin;
  const amountMax = amounts.length ? Math.max(...amounts) : target.amountMax;
  const amountVariance = averageAmount ? (amountMax - amountMin) / averageAmount : 0;
  const frequency = target.frequency === "irregular" ? manual.frequency : target.frequency;
  const monthlyCost = averageAmount * getFrequencyMonthlyMultiplier(frequency);
  const confidenceScore = Math.min(98, Math.max(target.confidenceScore, manual.confidenceScore) + 6);
  const nextExpectedDate = pickNextExpectedDate(target.nextExpectedDate, manual.nextExpectedDate, today);
  const merchant = genericMerchantNames.has(target.merchant) && input.merchant.trim() ? input.merchant.trim() : target.merchant;
  const recommendation = recommendItem(target.category, monthlyCost, confidenceScore, nextExpectedDate, amountVariance, today);

  const singleSourceTags = new Set(["single occurrence", "needs verification", "manual entry"]);
  const riskTags = [...new Set([
    ...target.riskTags.filter((tag) => !singleSourceTags.has(tag)),
    ...manual.riskTags.filter((tag) => !singleSourceTags.has(tag)),
    ...recommendation.riskTags,
    "multi-source verified",
  ])];

  return {
    ...target,
    canonicalRecurringItemId: target.canonicalRecurringItemId ?? manual.canonicalRecurringItemId,
    merchant,
    frequency,
    amountMin,
    amountMax,
    averageAmount,
    monthlyCost,
    annualCost: monthlyCost * 12,
    nextExpectedDate,
    confidenceScore,
    recommendationType: recommendation.type,
    recommendationReason: `${recommendation.reason} Confirmed by ${sourceNames.length} independent sources.`,
    riskTags,
    evidence,
    sourceNames,
  };
}

export type MergeDecision = "merge" | "separate";

export type DuplicateCandidate = {
  pairKey: string;
  leftKey: string;
  rightKey: string;
  leftMerchant: string;
  rightMerchant: string;
  monthlyCost: number;
  reason: string;
  score: number;
};

// Pair keys are built from stable identity keys, so a decision made today
// still applies after next month's import. "::" lives inside identity keys,
// so pairs join with "||".
export function makePairKey(leftKey: string, rightKey: string): string {
  return [leftKey, rightKey].sort().join("||");
}

export function findDuplicateCandidates(
  items: RecurringItem[],
  decisions: Record<string, MergeDecision> = {},
): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = [];

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const left = items[i];
      const right = items[j];
      if (left.currency !== right.currency) continue;
      const pairKey = makePairKey(left.identityKey, right.identityKey);
      if (decisions[pairKey]) continue;

      const sameMerchant = left.normalizedMerchant.toLowerCase() === right.normalizedMerchant.toLowerCase();
      if (sameMerchant) {
        const sameFrequency = left.frequency === right.frequency;
        candidates.push({
          pairKey,
          leftKey: left.identityKey,
          rightKey: right.identityKey,
          leftMerchant: left.merchant,
          rightMerchant: right.merchant,
          monthlyCost: Math.max(left.monthlyCost, right.monthlyCost),
          reason: `Same merchant "${left.normalizedMerchant}" appears twice with different amounts (avg ${Math.round(left.averageAmount)} vs ${Math.round(right.averageAmount)}). Two plans, or one plan that changed?`,
          score: sameFrequency ? 0.85 : 0.75,
        });
        continue;
      }

      const largerAmount = Math.max(left.averageAmount, right.averageAmount);
      const amountsClose = largerAmount > 0
        && Math.abs(left.averageAmount - right.averageAmount) / largerAmount <= 0.02;
      if (amountsClose && left.frequency === right.frequency && left.category === right.category) {
        candidates.push({
          pairKey,
          leftKey: left.identityKey,
          rightKey: right.identityKey,
          leftMerchant: left.merchant,
          rightMerchant: right.merchant,
          monthlyCost: Math.max(left.monthlyCost, right.monthlyCost),
          reason: `Same amount (~${Math.round(largerAmount)}) and ${left.frequency} cadence in ${left.category} under two names — possibly one commitment with two descriptors.`,
          score: 0.6,
        });
      }
    }
  }

  return candidates
    .sort((leftCandidate, rightCandidate) => rightCandidate.score - leftCandidate.score || rightCandidate.monthlyCost - leftCandidate.monthlyCost)
    .slice(0, 6);
}

export function applyMergeDecisionsToAudit(
  audit: AuditResult,
  decisions: Record<string, MergeDecision>,
  options: AnalyzeOptions = {},
): AuditResult {
  const mergePairs = Object.entries(decisions).filter(([, decision]) => decision === "merge");
  if (!mergePairs.length) return audit;

  const today = startOfDay(options.today ?? new Date());
  const byKey = new Map(audit.recurringItems.map((item) => [item.identityKey, item]));

  for (const [pairKey] of mergePairs) {
    const [leftKey, rightKey] = pairKey.split("||");
    const left = byKey.get(leftKey);
    const right = byKey.get(rightKey);
    if (!left || !right || left === right) continue;

    const combined = combineRecurringItems(left, right, today);
    byKey.delete(leftKey);
    byKey.delete(rightKey);
    byKey.set(combined.identityKey, combined);
  }

  const recurringItems = assignIdentityKeys([...byKey.values()])
    .sort((left, right) => right.monthlyCost - left.monthlyCost);

  return {
    ...audit,
    recurringItems,
    summary: summarizeAudit(audit.transactions, recurringItems, today),
  };
}

function combineRecurringItems(left: RecurringItem, right: RecurringItem, today: Date): RecurringItem {
  const primary = left.monthlyCost >= right.monthlyCost ? left : right;
  const other = primary === left ? right : left;

  const evidence = [...primary.evidence, ...other.evidence].sort((a, b) => compareDate(a.date, b.date));
  const sourceNames = [...new Set([...primary.sourceNames, ...other.sourceNames])];
  const amounts = evidence.map((link) => link.amount).filter((amount) => Number.isFinite(amount) && amount > 0);
  const averageAmount = average(amounts);
  const amountMin = amounts.length ? Math.min(...amounts) : primary.amountMin;
  const amountMax = amounts.length ? Math.max(...amounts) : primary.amountMax;
  const amountVariance = averageAmount ? (amountMax - amountMin) / averageAmount : 0;
  const frequency = primary.frequency !== "irregular" ? primary.frequency : other.frequency;
  const monthlyCost = averageAmount * getFrequencyMonthlyMultiplier(frequency);
  const confidenceScore = Math.min(98, Math.max(primary.confidenceScore, other.confidenceScore) + 6);
  const nextExpectedDate = pickNextExpectedDate(primary.nextExpectedDate, other.nextExpectedDate, today);
  const merchant = genericMerchantNames.has(primary.merchant) && !genericMerchantNames.has(other.merchant)
    ? other.merchant
    : primary.merchant;
  const recommendation = recommendItem(primary.category, monthlyCost, confidenceScore, nextExpectedDate, amountVariance, today);

  const singleSourceTags = new Set(["single occurrence", "needs verification", "manual entry"]);
  const riskTags = [...new Set([
    ...primary.riskTags.filter((tag) => !singleSourceTags.has(tag)),
    ...other.riskTags.filter((tag) => !singleSourceTags.has(tag)),
    ...recommendation.riskTags,
    "user-confirmed same commitment",
  ])];

  return {
    ...primary,
    canonicalRecurringItemId: primary.canonicalRecurringItemId ?? other.canonicalRecurringItemId,
    merchant,
    frequency,
    amountMin,
    amountMax,
    averageAmount,
    monthlyCost,
    annualCost: monthlyCost * 12,
    nextExpectedDate,
    confidenceScore,
    recommendationType: recommendation.type,
    recommendationReason: `${recommendation.reason} User confirmed these records describe one commitment.`,
    riskTags,
    evidence,
    sourceNames,
    missedCycles: Math.min(primary.missedCycles, other.missedCycles),
    priceChange: primary.priceChange ?? other.priceChange,
  };
}

function pickNextExpectedDate(left: string, right: string, today: Date): string {
  const leftDate = parseDate(left);
  const rightDate = parseDate(right);
  if (!leftDate) return right;
  if (!rightDate) return left;

  const futures = [leftDate, rightDate].filter((date) => date >= today);
  if (futures.length) {
    return formatDate(new Date(Math.min(...futures.map((date) => date.getTime()))));
  }
  return formatDate(new Date(Math.max(leftDate.getTime(), rightDate.getTime())));
}

function parseCsvStatement(input: string, source: string, warnings: string[]): ParsedTransaction[] {
  const rows = parseCsvRows(input).filter((row) => row.some((cell) => cell.trim().length > 0));
  if (rows.length < 2) {
    warnings.push("The statement needs a header row and at least one transaction row.");
    return [];
  }

  const headers = rows[0].map(normalizeHeader);
  const dateIndex = findHeader(headers, ["date", "transactiondate", "txndate", "posteddate", "valuedate", "trandate", "bookingdate"]);
  const descriptionIndex = findHeader(headers, ["description", "narration", "particulars", "merchant", "details", "remark", "remarks", "transactionremarks", "transactiondetails"]);
  const amountIndex = findHeader(headers, ["amount", "transactionamount", "amt", "value"]);
  const debitIndex = findHeader(headers, ["debit", "withdrawal", "withdrawals", "paidout", "debitamount", "dr", "withdrawalamt", "withdrawalamountinr", "withdrawalamtinr", "withdrawaldr"]);
  const creditIndex = findHeader(headers, ["credit", "deposit", "deposits", "paidin", "creditamount", "cr", "depositamt", "depositamountinr", "depositamtinr", "depositcr"]);

  if (dateIndex === -1) warnings.push("No date column was found. Add a Date or Transaction Date column.");
  if (descriptionIndex === -1) warnings.push("No merchant/description column was found. Add Description, Narration, or Particulars.");
  if (amountIndex === -1 && debitIndex === -1) warnings.push("No amount/debit column was found. Add Amount, Debit, or Withdrawal.");
  if (dateIndex === -1 || descriptionIndex === -1 || (amountIndex === -1 && debitIndex === -1)) return [];

  // Resolve dd/mm vs mm/dd once per source: any row with day>12 in one slot
  // disambiguates the whole file, instead of guessing row by row.
  const preferMonthFirst = detectMonthFirstDates(rows.slice(1).map((cells) => cells[dateIndex] ?? ""));

  const transactions: ParsedTransaction[] = [];

  rows.slice(1).forEach((cells, index) => {
    const rowNumber = index + 2;
    const rawDate = cells[dateIndex] ?? "";
    const rawDescription = cells[descriptionIndex] ?? "";
    const parsedDate = parseDate(rawDate, preferMonthFirst);
    const description = rawDescription.trim();
    const amount = extractOutflowAmount(cells, amountIndex, debitIndex, creditIndex, description);

    if (!parsedDate || !description || !amount || amount.direction !== "debit") return;

    const normalized = normalizeMerchant(description);
    const rawAmountText = [
      amountIndex >= 0 ? cells[amountIndex] : "",
      debitIndex >= 0 ? cells[debitIndex] : "",
    ].join(" ");

    transactions.push({
      id: `${source}-${rowNumber}`,
      rowNumber,
      source,
      date: formatDate(parsedDate),
      description,
      amount: amount.value,
      currency: detectCurrency(`${rawAmountText} ${description}`),
      direction: amount.direction,
      normalizedMerchant: normalized.merchant,
      category: normalized.category,
    });
  });

  if (!transactions.length) {
    warnings.push("No debit transactions were detected. Check whether expenses are positive, negative, or split into Debit/Credit columns.");
  }

  return transactions.sort((left, right) => compareDate(left.date, right.date));
}

function detectMonthFirstDates(rawDates: string[]): boolean {
  let dayFirstEvidence = 0;
  let monthFirstEvidence = 0;

  for (const raw of rawDates) {
    const match = raw.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-]\d{2,4}$/);
    if (!match) continue;
    const first = Number.parseInt(match[1], 10);
    const second = Number.parseInt(match[2], 10);
    if (first > 12 && second <= 12) dayFirstEvidence += 1;
    if (second > 12 && first <= 12) monthFirstEvidence += 1;
  }

  return monthFirstEvidence > dayFirstEvidence;
}

function normalizeCurrency(value: string | undefined): string {
  const trimmed = value?.trim().toUpperCase();
  if (!trimmed) return primaryCurrency;
  return /^[A-Z]{3}$/.test(trimmed) ? trimmed : primaryCurrency;
}

function detectCurrency(text: string): string {
  if (/\bUSD\b|\$/.test(text)) return "USD";
  if (/\bEUR\b|€/.test(text)) return "EUR";
  if (/\bGBP\b|£/.test(text)) return "GBP";
  return primaryCurrency;
}

function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let currentCell = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const nextChar = input[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      currentCell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += char;
  }

  currentRow.push(currentCell);
  rows.push(currentRow);
  return rows;
}

function extractOutflowAmount(
  cells: string[],
  amountIndex: number,
  debitIndex: number,
  creditIndex: number,
  description: string,
): { value: number; direction: Direction } | null {
  const debitValue = debitIndex >= 0 ? parseMoney(cells[debitIndex] ?? "") : null;
  const creditValue = creditIndex >= 0 ? parseMoney(cells[creditIndex] ?? "") : null;

  if (debitValue && Math.abs(debitValue) > 0) return { value: Math.abs(debitValue), direction: "debit" };
  if (creditValue && Math.abs(creditValue) > 0) return { value: Math.abs(creditValue), direction: "credit" };

  if (amountIndex >= 0) {
    const rawAmount = cells[amountIndex] ?? "";
    const amount = parseMoney(rawAmount);
    if (!amount || Math.abs(amount) === 0) return null;

    const creditLike = /salary|refund|cashback|interest|dividend|reversal|deposit|credit/i.test(description) || /\bcr\b/i.test(rawAmount);
    const debitLike = amount < 0 || /\bdr\b|debit|paid|purchase|mandate|autopay|upi/i.test(`${rawAmount} ${description}`);

    if (creditLike && !debitLike) return { value: Math.abs(amount), direction: "credit" };
    return { value: Math.abs(amount), direction: "debit" };
  }

  return null;
}

function detectRecurringItems(transactions: ParsedTransaction[], today: Date): RecurringItem[] {
  const grouped = transactions.reduce<Record<string, ParsedTransaction[]>>((groups, transaction) => {
    // Currency is part of the grouping key: a USD and an INR charge from the
    // same merchant are different commitments.
    const key = `${transaction.normalizedMerchant}||${transaction.currency}`;
    groups[key] = groups[key] ? [...groups[key], transaction] : [transaction];
    return groups;
  }, {});

  const initialItems = Object.values(grouped)
    .map((group) => group.length >= 2
      ? buildRecurringItem(group[0].normalizedMerchant, group, today)
      : buildSingleOccurrenceItem(group[0].normalizedMerchant, group[0], today))
    .filter((item): item is RecurringItem => Boolean(item))
    .sort((left, right) => right.monthlyCost - left.monthlyCost);

  const categoryCounts = initialItems.reduce<Record<string, number>>((counts, item) => {
    counts[item.category] = (counts[item.category] ?? 0) + 1;
    return counts;
  }, {});

  return initialItems.map((item) => {
    const duplicateCategory = categoryCounts[item.category] > 1 && ["AI tools", "Cloud hosting", "Streaming", "Design tools", "Creative tools"].includes(item.category);
    if (!duplicateCategory || item.recommendationType === "investigate") return item;

    const policy = getCommitmentPolicy(item.category);
    const usageBased = policy.class === "usage-based-cloud";
    return {
      ...item,
      recommendationType: item.monthlyCost > 1500 && !usageBased ? "downgrade" : "watch",
      recommendationReason: usageBased
        ? `Multiple recurring ${item.category.toLowerCase()} charges were found. ${policy.highCostGuidance} ${policy.consequenceWarning}`
        : `Multiple recurring ${item.category.toLowerCase()} charges were found. Compare actual usage before the next renewal.`,
      riskTags: [...new Set([...item.riskTags, "possible duplicate stack"])],
    };
  });
}

function buildSingleOccurrenceItem(merchant: string, transaction: ParsedTransaction, today: Date): RecurringItem | null {
  const categoryFrequency = singleOccurrenceCategoryRules[transaction.category];
  const keywordHit = singleOccurrenceKeywordPattern.test(transaction.description);
  if (!categoryFrequency && !keywordHit) return null;
  if (transaction.amount < 50) return null;

  const frequency: Frequency = categoryFrequency
    ?? (/annual|yearly/i.test(transaction.description) ? "yearly" : "monthly");
  const gapDays = getFrequencyGapDays(frequency);
  const chargeDate = parseDate(transaction.date);
  if (!chargeDate) return null;

  const anchorDay = monthAnchoredFrequencies.has(frequency) ? chargeDate.getDate() : undefined;
  const firstNext = advanceDateByFrequency(chargeDate, frequency, gapDays, anchorDay);
  const rolled = rollForwardDate(firstNext, today, frequency, gapDays, anchorDay);
  const monthlyCost = transaction.amount * getFrequencyMonthlyMultiplier(frequency);
  const frequencyLabel = frequencyModels.find((model) => model.frequency === frequency)?.label ?? frequency;
  const policy = getCommitmentPolicy(transaction.category);
  const riskTags = ["single occurrence", "needs verification", policy.riskTag];
  if (transaction.currency !== primaryCurrency) riskTags.push(`foreign currency (${transaction.currency})`);

  return {
    id: slugify(`${merchant}-${transaction.date}`),
    identityKey: `${merchant.trim().toLowerCase()}::${transaction.currency}`,
    merchant,
    normalizedMerchant: merchant,
    category: transaction.category,
    currency: transaction.currency,
    frequency,
    averageGapDays: gapDays,
    amountMin: transaction.amount,
    amountMax: transaction.amount,
    averageAmount: transaction.amount,
    monthlyCost,
    annualCost: monthlyCost * 12,
    lastChargeDate: transaction.date,
    nextExpectedDate: formatDate(rolled.date),
    confidenceScore: 52,
    recommendationType: "investigate",
    recommendationReason: `Charged once in the evidence window. This ${policy.terminology.singular} usually recurs ${frequencyLabel}. Confirm it with one more proof source. ${policy.defaultGuidance} ${policy.consequenceWarning}`,
    riskTags,
    evidence: [
      {
        date: transaction.date,
        amount: transaction.amount,
        description: transaction.description,
        source: transaction.source,
        rowNumber: transaction.rowNumber,
        kind: "observed-charge",
      },
    ],
    sourceNames: [transaction.source],
    missedCycles: rolled.missedCycles,
    priceChange: null,
  };
}

function buildRecurringItem(merchant: string, group: ParsedTransaction[], today: Date): RecurringItem | null {
  const transactions = [...group].sort((left, right) => compareDate(left.date, right.date));
  const gaps = transactions.slice(1).map((transaction, index) => daysBetween(transactions[index].date, transaction.date));
  const averageGapDays = average(gaps);
  const transactionDates = transactions
    .map((transaction) => parseDate(transaction.date))
    .filter((date): date is Date => Boolean(date));
  const frequency = inferFrequency(averageGapDays, gaps, transactionDates);
  const amounts = transactions.map((transaction) => transaction.amount);
  const averageAmount = average(amounts);
  const amountMin = Math.min(...amounts);
  const amountMax = Math.max(...amounts);
  const amountVariance = averageAmount ? (amountMax - amountMin) / averageAmount : 0;

  if (frequency.frequency === "irregular" && transactions.length < 3) return null;

  const currency = transactions[0].currency;
  const lastChargeDate = transactions[transactions.length - 1].date;
  const lastDate = parseDate(lastChargeDate) ?? today;
  const anchorDay = monthAnchoredFrequencies.has(frequency.frequency)
    ? medianDayOfMonth(transactionDates)
    : undefined;
  const cycleGapDays = frequency.expectedGapDays || averageGapDays || 30.44;
  const firstNext = advanceDateByFrequency(lastDate, frequency.frequency, cycleGapDays, anchorDay);
  const rolled = rollForwardDate(firstNext, today, frequency.frequency, cycleGapDays, anchorDay);
  const nextExpectedDate = formatDate(rolled.date);
  const monthlyCost = frequency.expectedGapDays > 0 ? averageAmount * (30.44 / frequency.expectedGapDays) : averageAmount;
  const confidenceScore = calculateConfidence(transactions.length, gaps, frequency.expectedGapDays, amountVariance);
  const category = mostCommon(transactions.map((transaction) => transaction.category));
  const priceChange = detectPriceChange(amounts);
  const recommendation = recommendItem(category, monthlyCost, confidenceScore, nextExpectedDate, amountVariance, today);
  const riskTags = new Set(recommendation.riskTags);
  let recommendationType = recommendation.type;
  let recommendationReason = recommendation.reason;

  if (rolled.missedCycles >= 2) {
    riskTags.add(`stale evidence since ${lastChargeDate}`);
  }

  if (currency !== primaryCurrency) {
    riskTags.add(`foreign currency (${currency})`);
  }

  if (priceChange) {
    const policy = getCommitmentPolicy(category);
    riskTags.add(priceChange.direction === "increase"
      ? `price increased ~${priceChange.changePercent}%`
      : `price decreased ~${priceChange.changePercent}%`);
    if (priceChange.direction === "increase" && (recommendationType === "keep" || policy.class !== "discretionary-subscription")) {
      recommendationType = "watch";
      recommendationReason = buildPriceIncreaseReason(policy, priceChange.changePercent);
    }
  }

  return {
    id: slugify(`${merchant}-${lastChargeDate}`),
    identityKey: `${merchant.trim().toLowerCase()}::${currency}`,
    merchant,
    normalizedMerchant: merchant,
    category,
    currency,
    frequency: frequency.frequency,
    averageGapDays,
    amountMin,
    amountMax,
    averageAmount,
    monthlyCost,
    annualCost: monthlyCost * 12,
    lastChargeDate,
    nextExpectedDate,
    confidenceScore,
    recommendationType,
    recommendationReason,
    riskTags: [...riskTags],
    evidence: transactions.map((transaction) => ({
      date: transaction.date,
      amount: transaction.amount,
      description: transaction.description,
      source: transaction.source,
      rowNumber: transaction.rowNumber,
      kind: "observed-charge" as const,
    })),
    sourceNames: [...new Set(transactions.map((transaction) => transaction.source))],
    missedCycles: rolled.missedCycles,
    priceChange,
  };
}

function detectPriceChange(amountsInDateOrder: number[]): PriceChange | null {
  if (amountsInDateOrder.length < 3) return null;

  const prior = amountsInDateOrder.slice(0, -1);
  const latest = amountsInDateOrder[amountsInDateOrder.length - 1];
  const priorAverage = average(prior);
  if (!priorAverage) return null;

  const priorVariance = (Math.max(...prior) - Math.min(...prior)) / priorAverage;
  if (priorVariance > 0.15) return null;

  const delta = latest - priorAverage;
  if (Math.abs(delta) < 25 || Math.abs(delta) / priorAverage < 0.08) return null;

  return {
    direction: delta > 0 ? "increase" : "decrease",
    previousAmount: Math.round(priorAverage * 100) / 100,
    latestAmount: latest,
    changePercent: Math.round((Math.abs(delta) / priorAverage) * 100),
  };
}

function recommendItem(
  category: string,
  monthlyCost: number,
  confidenceScore: number,
  nextExpectedDate: string,
  amountVariance: number,
  today: Date,
): { type: RecommendationType; reason: string; riskTags: string[] } {
  const riskTags: string[] = [];
  const policy = getCommitmentPolicy(category);
  const nextDate = parseDate(nextExpectedDate);
  const daysUntilRenewal = nextDate ? daysBetween(formatDate(today), formatDate(nextDate)) : 999;

  if (policy.class !== "discretionary-subscription") riskTags.push(policy.riskTag);

  if (confidenceScore < 65) {
    riskTags.push("needs verification");
    return {
      type: "investigate",
      reason: `The ${policy.terminology.singular} pattern looks recurring, but date or amount consistency is not strong enough yet. ${policy.defaultGuidance} ${policy.consequenceWarning}`,
      riskTags,
    };
  }

  if (amountVariance > 0.35) riskTags.push("variable amount");
  if (daysUntilRenewal >= 0 && daysUntilRenewal <= 10) riskTags.push(`${policy.terminology.nextEvent} soon`);

  if (policy.class !== "discretionary-subscription") {
    const highCost = policy.highCostReviewThreshold !== null && monthlyCost >= policy.highCostReviewThreshold;
    return {
      type: highCost ? "watch" : "keep",
      reason: `${highCost ? policy.highCostGuidance : policy.defaultGuidance} ${policy.consequenceWarning}`,
      riskTags,
    };
  }

  if (["AI tools", "Developer tools"].includes(category) && monthlyCost >= 2500) {
    return {
      type: "downgrade",
      reason: "High recurring builder spend. Check actual usage before renewing or downgrade idle seats/projects.",
      riskTags,
    };
  }

  if (["Streaming", "Creative tools", "Design tools"].includes(category) && monthlyCost >= 1200) {
    return {
      type: "watch",
      reason: "Consumer/tool subscription with meaningful monthly burn. Confirm it is actively used.",
      riskTags,
    };
  }

  return {
    type: "keep",
    reason: "Pattern is consistent. Keep it if the service is still actively used.",
    riskTags,
  };
}

function buildPriceIncreaseReason(policy: CommitmentPolicy, changePercent: number) {
  if (policy.class === "discretionary-subscription") {
    return `The latest charge is about ${changePercent}% higher than the earlier stable amount. Confirm the plan change before the next renewal.`;
  }

  return `The latest ${policy.terminology.recurringAmount} is about ${changePercent}% higher than the earlier stable amount. ${policy.highCostGuidance} ${policy.consequenceWarning}`;
}

function calculateConfidence(count: number, gaps: number[], expectedGapDays: number, amountVariance: number): number {
  const countScore = Math.min(24, count * 7);
  const gapVariance = gaps.length > 1 ? standardDeviation(gaps) / (average(gaps) || 1) : 0.08;
  const cadenceScore = Math.max(0, 30 - gapVariance * 70);
  const amountScore = Math.max(0, 26 - amountVariance * 45);
  const frequencyScore = expectedGapDays > 0 ? 15 : 4;
  return Math.round(Math.max(42, Math.min(98, countScore + cadenceScore + amountScore + frequencyScore)));
}

function inferFrequency(averageGapDays: number, gaps: number[], dates: Date[]): { frequency: Frequency; expectedGapDays: number; label: string } {
  if (!averageGapDays || !Number.isFinite(averageGapDays)) {
    return { frequency: "irregular", expectedGapDays: 30.44, label: "irregular" };
  }

  // Semimonthly (1st + 15th style) hides inside the biweekly gap range; only
  // day-of-month bimodality separates them reliably.
  if (isSemimonthlyPattern(averageGapDays, dates)) {
    return { frequency: "semimonthly", expectedGapDays: 15.22, label: "twice a month" };
  }

  const closest = gapMatchedModels.reduce(
    (best, model) => {
      const distance = Math.abs(model.expectedGapDays - averageGapDays);
      return distance < best.distance ? { model, distance } : best;
    },
    { model: gapMatchedModels[0], distance: Number.POSITIVE_INFINITY },
  );

  const tolerance = closest.model.expectedGapDays >= 300 ? 45 : Math.max(4, closest.model.expectedGapDays * 0.28);
  const consistentGaps = gaps.filter((gap) => Math.abs(gap - closest.model.expectedGapDays) <= tolerance).length;
  const consistencyRatio = gaps.length ? consistentGaps / gaps.length : 0;

  if (closest.distance <= tolerance || consistencyRatio >= 0.6) {
    return {
      frequency: closest.model.frequency,
      expectedGapDays: closest.model.expectedGapDays,
      label: closest.model.label,
    };
  }

  return { frequency: "irregular", expectedGapDays: averageGapDays, label: "irregular" };
}

function isSemimonthlyPattern(averageGapDays: number, dates: Date[]): boolean {
  if (dates.length < 4) return false;
  if (averageGapDays < 12 || averageGapDays > 18) return false;

  const dayCounts = new Map<number, number>();
  for (const date of dates) {
    const day = date.getDate();
    // Cluster within ±2 days of an existing anchor.
    let anchored = false;
    for (const [anchor, count] of dayCounts) {
      if (Math.abs(anchor - day) <= 2) {
        dayCounts.set(anchor, count + 1);
        anchored = true;
        break;
      }
    }
    if (!anchored) dayCounts.set(day, 1);
  }

  if (dayCounts.size !== 2) return false;
  const anchors = [...dayCounts.entries()];
  const [firstAnchor, firstCount] = anchors[0];
  const [secondAnchor, secondCount] = anchors[1];
  if (firstCount < 2 || secondCount < 2) return false;

  const anchorGap = Math.abs(firstAnchor - secondAnchor);
  return anchorGap >= 12 && anchorGap <= 18;
}

function normalizeMerchant(description: string): { merchant: string; category: string } {
  const matchedRule = merchantRules.find((rule) => rule.pattern.test(description));
  if (matchedRule) return { merchant: matchedRule.merchant, category: matchedRule.category };

  const cleaned = description
    .toUpperCase()
    .replace(/\b(?:UPI|IMPS|NEFT|ACH|ECS|NACH|MANDATE|AUTOPAY|SI|POS|CARD|DEBIT|CREDIT)\b/g, " ")
    .replace(/[A-Z]{2,}\d{4,}|\d{3,}|[*/:_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const merchant = titleCase(cleaned.split(" ").slice(0, 4).join(" ") || "Unknown merchant");
  return { merchant, category: "Other" };
}

function projectNextExpectedDate(
  value: string,
  today: Date,
  frequency: Frequency,
  fallbackGapDays: number,
): { date: string; missedCycles: number } {
  const parsed = parseDate(value);
  if (!parsed) return { date: value, missedCycles: 0 };
  if (parsed >= today) return { date: formatDate(parsed), missedCycles: 0 };

  const anchorDay = monthAnchoredFrequencies.has(frequency) ? parsed.getDate() : undefined;
  const rolled = rollForwardDate(parsed, today, frequency, fallbackGapDays, anchorDay);
  return { date: formatDate(rolled.date), missedCycles: rolled.missedCycles };
}

function rollForwardDate(
  start: Date,
  today: Date,
  frequency: Frequency,
  fallbackGapDays: number,
  anchorDay?: number,
): { date: Date; missedCycles: number } {
  let date = start;
  let missedCycles = 0;

  while (date < today && missedCycles < 120) {
    date = advanceDateByFrequency(date, frequency, fallbackGapDays, anchorDay);
    missedCycles += 1;
  }

  return { date, missedCycles };
}

function addMonthsAnchored(date: Date, months: number, anchorDay?: number): Date {
  const firstOfTarget = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const day = Math.min(anchorDay ?? date.getDate(), daysInMonth(firstOfTarget));
  return new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth(), day);
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function medianDayOfMonth(dates: Date[]): number | undefined {
  if (!dates.length) return undefined;
  const days = dates.map((date) => date.getDate()).sort((left, right) => left - right);
  return days[Math.floor(days.length / 2)];
}

function parseMoney(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;

  const negative = raw.includes("-") || /^\(.*\)$/.test(raw) || /\bdr\b/i.test(raw);
  const cleaned = raw
    .replace(/,/g, "")
    .replace(/[()]/g, "")
    .replace(/[^0-9.-]/g, "");
  const number = Number.parseFloat(cleaned);
  if (!Number.isFinite(number)) return null;
  return negative ? -Math.abs(number) : number;
}

function parseDate(value: string | Date, preferMonthFirst = false): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : startOfDay(value);

  const trimmed = value.trim();
  if (!trimmed) return null;

  const isoDate = parseIsoDateOnly(trimmed);
  if (isoDate) return isoDate;

  const separated = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (separated) {
    const first = Number.parseInt(separated[1], 10);
    const second = Number.parseInt(separated[2], 10);
    const year = Number.parseInt(separated[3].length === 2 ? `20${separated[3]}` : separated[3], 10);

    let day: number;
    let month: number;
    if (first > 12) {
      day = first;
      month = second;
    } else if (second > 12) {
      day = second;
      month = first;
    } else if (preferMonthFirst) {
      month = first;
      day = second;
    } else {
      day = first;
      month = second;
    }

    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : startOfDay(date);
  }

  const nativeDate = new Date(trimmed);
  if (!Number.isNaN(nativeDate.getTime())) return startOfDay(nativeDate);
  return null;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function compareDate(left: string, right: string): number {
  return (parseDate(left)?.getTime() ?? 0) - (parseDate(right)?.getTime() ?? 0);
}

function daysBetween(left: string, right: string): number {
  const leftDate = parseDate(left);
  const rightDate = parseDate(right);
  if (!leftDate || !rightDate) return 0;
  return Math.round((rightDate.getTime() - leftDate.getTime()) / dayInMs);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + Math.round(days) * dayInMs);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function mostCommon(values: string[]): string {
  const counts = values.reduce<Record<string, number>>((result, value) => {
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});

  return Object.entries(counts).sort((left, right) => right[1] - left[1])[0]?.[0] ?? "Other";
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findHeader(headers: string[], options: string[]): number {
  return headers.findIndex((header) => options.includes(header));
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
