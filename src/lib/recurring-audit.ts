export type Frequency =
  | "weekly"
  | "biweekly"
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
};

export type RecommendationType = "keep" | "watch" | "downgrade" | "cancel" | "investigate";

export type RecurringItem = {
  id: string;
  merchant: string;
  normalizedMerchant: string;
  category: string;
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
};

export type AuditSummary = {
  transactionCount: number;
  recurringCount: number;
  monthlyRecurringSpend: number;
  annualRecurringSpend: number;
  reviewableMonthlySpend: number;
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
  merchant: string;
  amount: number;
  frequency: Frequency;
  nextExpectedDate: string;
  category: string;
  sourceName?: string;
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
  { pattern: /LOAN|EMI|ECS|NACH/i, merchant: "Loan or EMI", category: "Debt" },
  { pattern: /SIP|MUTUAL FUND|ZERODHA|GROWW|KUVERA/i, merchant: "Investment SIP", category: "Investments" },
  { pattern: /INSURANCE|POLICY|LIC|HDFC LIFE|ICICI PRU/i, merchant: "Insurance", category: "Insurance" },
  { pattern: /AIRTEL|JIO|VI |VODAFONE/i, merchant: "Telecom", category: "Utilities" },
];

const frequencyModels: FrequencyModel[] = [
  { frequency: "weekly", expectedGapDays: 7, label: "weekly" },
  { frequency: "biweekly", expectedGapDays: 14, label: "biweekly" },
  { frequency: "monthly", expectedGapDays: 30.44, label: "monthly" },
  { frequency: "bimonthly", expectedGapDays: 60.88, label: "every two months" },
  { frequency: "quarterly", expectedGapDays: 91.31, label: "quarterly" },
  { frequency: "yearly", expectedGapDays: 365.25, label: "yearly" },
];

export function analyzeStatement(input: string, sourceName = "statement.csv"): AuditResult {
  const warnings: string[] = [];
  const transactions = parseCsvStatement(input, sourceName, warnings);
  const recurringItems = detectRecurringItems(transactions);

  return {
    transactions,
    recurringItems,
    summary: summarizeAudit(transactions, recurringItems),
    warnings,
  };
}

export function analyzeStatements(sources: StatementSource[], manualItems: ManualRecurringInput[] = []): AuditResult {
  const warnings: string[] = [];
  const transactions = sources.flatMap((source) => parseCsvStatement(source.text, source.name, warnings));
  const detectedItems = detectRecurringItems(transactions);
  const manualRecurringItems = manualItems.map(buildManualRecurringItem);
  const recurringItems = [...detectedItems, ...manualRecurringItems].sort((left, right) => right.monthlyCost - left.monthlyCost);

  return {
    transactions,
    recurringItems,
    summary: summarizeAudit(transactions, recurringItems),
    warnings,
  };
}

export function createEmptyAudit(): AuditResult {
  return {
    transactions: [],
    recurringItems: [],
    summary: summarizeAudit([], []),
    warnings: [],
  };
}

export function getFrequencyMonthlyMultiplier(frequency: Frequency): number {
  const model = frequencyModels.find((item) => item.frequency === frequency);
  const expectedGapDays = model?.expectedGapDays ?? 30.44;
  return 30.44 / expectedGapDays;
}

function summarizeAudit(transactions: ParsedTransaction[], recurringItems: RecurringItem[]): AuditSummary {
  const today = startOfDay(new Date());
  const tenDaysFromNow = addDays(today, 10);
  const renewalsNextTenDays = recurringItems.filter((item) => {
    const nextDate = parseDate(item.nextExpectedDate);
    return nextDate && nextDate >= today && nextDate <= tenDaysFromNow;
  }).length;
  const monthlyRecurringSpend = recurringItems.reduce((total, item) => total + item.monthlyCost, 0);
  const reviewableMonthlySpend = recurringItems.reduce((total, item) => {
    if (["cancel", "downgrade", "investigate", "watch"].includes(item.recommendationType)) {
      return total + item.monthlyCost;
    }
    return total;
  }, 0);
  const averageConfidence = recurringItems.length
    ? recurringItems.reduce((total, item) => total + item.confidenceScore, 0) / recurringItems.length
    : 0;

  return {
    transactionCount: transactions.length,
    recurringCount: recurringItems.length,
    monthlyRecurringSpend,
    annualRecurringSpend: monthlyRecurringSpend * 12,
    reviewableMonthlySpend,
    renewalsNextTenDays,
    averageConfidence,
  };
}

function buildManualRecurringItem(input: ManualRecurringInput): RecurringItem {
  const normalized = normalizeMerchant(input.merchant);
  const multiplier = getFrequencyMonthlyMultiplier(input.frequency);
  const model = frequencyModels.find((item) => item.frequency === input.frequency);
  const averageGapDays = model?.expectedGapDays ?? 30.44;
  const monthlyCost = input.amount * multiplier;
  const recommendation = recommendItem(input.category || normalized.category, monthlyCost, 72, input.nextExpectedDate, 0);

  return {
    id: input.id,
    merchant: input.merchant.trim() || normalized.merchant,
    normalizedMerchant: normalized.merchant,
    category: input.category || normalized.category,
    frequency: input.frequency,
    averageGapDays,
    amountMin: input.amount,
    amountMax: input.amount,
    averageAmount: input.amount,
    monthlyCost,
    annualCost: monthlyCost * 12,
    lastChargeDate: input.nextExpectedDate,
    nextExpectedDate: input.nextExpectedDate,
    confidenceScore: 72,
    recommendationType: recommendation.type === "keep" ? "watch" : recommendation.type,
    recommendationReason: `Manually added ${input.frequency} commitment. Verify the source before the next debit.`,
    riskTags: [...new Set(["manual entry", ...recommendation.riskTags])],
    evidence: [
      {
        date: input.nextExpectedDate,
        amount: input.amount,
        description: input.merchant,
        source: input.sourceName || "manual entry",
        rowNumber: 1,
      },
    ],
    sourceNames: [input.sourceName || "manual entry"],
  };
}

function parseCsvStatement(input: string, source: string, warnings: string[]): ParsedTransaction[] {
  const rows = parseCsvRows(input).filter((row) => row.some((cell) => cell.trim().length > 0));
  if (rows.length < 2) {
    warnings.push("The statement needs a header row and at least one transaction row.");
    return [];
  }

  const headers = rows[0].map(normalizeHeader);
  const dateIndex = findHeader(headers, ["date", "transactiondate", "txndate", "posteddate", "valuedate"]);
  const descriptionIndex = findHeader(headers, ["description", "narration", "particulars", "merchant", "details", "remark", "remarks"]);
  const amountIndex = findHeader(headers, ["amount", "transactionamount", "amt", "value"]);
  const debitIndex = findHeader(headers, ["debit", "withdrawal", "withdrawals", "paidout", "debitamount", "dr"]);
  const creditIndex = findHeader(headers, ["credit", "deposit", "deposits", "paidin", "creditamount", "cr"]);

  if (dateIndex === -1) warnings.push("No date column was found. Add a Date or Transaction Date column.");
  if (descriptionIndex === -1) warnings.push("No merchant/description column was found. Add Description, Narration, or Particulars.");
  if (amountIndex === -1 && debitIndex === -1) warnings.push("No amount/debit column was found. Add Amount, Debit, or Withdrawal.");
  if (dateIndex === -1 || descriptionIndex === -1 || (amountIndex === -1 && debitIndex === -1)) return [];

  const transactions: ParsedTransaction[] = [];

  rows.slice(1).forEach((cells, index) => {
    const rowNumber = index + 2;
    const rawDate = cells[dateIndex] ?? "";
    const rawDescription = cells[descriptionIndex] ?? "";
    const parsedDate = parseDate(rawDate);
    const description = rawDescription.trim();
    const amount = extractOutflowAmount(cells, amountIndex, debitIndex, creditIndex, description);

    if (!parsedDate || !description || !amount || amount.direction !== "debit") return;

    const normalized = normalizeMerchant(description);

    transactions.push({
      id: `${source}-${rowNumber}`,
      rowNumber,
      source,
      date: formatDate(parsedDate),
      description,
      amount: amount.value,
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

function detectRecurringItems(transactions: ParsedTransaction[]): RecurringItem[] {
  const grouped = transactions.reduce<Record<string, ParsedTransaction[]>>((groups, transaction) => {
    const key = transaction.normalizedMerchant;
    groups[key] = groups[key] ? [...groups[key], transaction] : [transaction];
    return groups;
  }, {});

  const initialItems = Object.entries(grouped)
    .filter(([, group]) => group.length >= 2)
    .map(([merchant, group]) => buildRecurringItem(merchant, group))
    .filter((item): item is RecurringItem => Boolean(item))
    .sort((left, right) => right.monthlyCost - left.monthlyCost);

  const categoryCounts = initialItems.reduce<Record<string, number>>((counts, item) => {
    counts[item.category] = (counts[item.category] ?? 0) + 1;
    return counts;
  }, {});

  return initialItems.map((item) => {
    const duplicateCategory = categoryCounts[item.category] > 1 && ["AI tools", "Cloud hosting", "Streaming", "Design tools", "Creative tools"].includes(item.category);
    if (!duplicateCategory || item.recommendationType === "investigate") return item;

    return {
      ...item,
      recommendationType: item.monthlyCost > 1500 ? "downgrade" : "watch",
      recommendationReason: `Multiple recurring ${item.category.toLowerCase()} charges were found. Compare actual usage before the next renewal.`,
      riskTags: [...new Set([...item.riskTags, "possible duplicate stack"])],
    };
  });
}

function buildRecurringItem(merchant: string, group: ParsedTransaction[]): RecurringItem | null {
  const transactions = [...group].sort((left, right) => compareDate(left.date, right.date));
  const gaps = transactions.slice(1).map((transaction, index) => daysBetween(transactions[index].date, transaction.date));
  const averageGapDays = average(gaps);
  const frequency = inferFrequency(averageGapDays, gaps);
  const amounts = transactions.map((transaction) => transaction.amount);
  const averageAmount = average(amounts);
  const amountMin = Math.min(...amounts);
  const amountMax = Math.max(...amounts);
  const amountVariance = averageAmount ? (amountMax - amountMin) / averageAmount : 0;

  if (frequency.frequency === "irregular" && transactions.length < 3) return null;

  const lastChargeDate = transactions[transactions.length - 1].date;
  const nextExpectedDate = formatDate(addDays(parseDate(lastChargeDate) ?? new Date(), frequency.expectedGapDays || averageGapDays || 30.44));
  const monthlyCost = frequency.expectedGapDays > 0 ? averageAmount * (30.44 / frequency.expectedGapDays) : averageAmount;
  const confidenceScore = calculateConfidence(transactions.length, gaps, frequency.expectedGapDays, amountVariance);
  const category = mostCommon(transactions.map((transaction) => transaction.category));
  const recommendation = recommendItem(category, monthlyCost, confidenceScore, nextExpectedDate, amountVariance);

  return {
    id: slugify(`${merchant}-${lastChargeDate}`),
    merchant,
    normalizedMerchant: merchant,
    category,
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
    recommendationType: recommendation.type,
    recommendationReason: recommendation.reason,
    riskTags: recommendation.riskTags,
    evidence: transactions.map((transaction) => ({
      date: transaction.date,
      amount: transaction.amount,
      description: transaction.description,
      source: transaction.source,
      rowNumber: transaction.rowNumber,
    })),
    sourceNames: [...new Set(transactions.map((transaction) => transaction.source))],
  };
}

function recommendItem(
  category: string,
  monthlyCost: number,
  confidenceScore: number,
  nextExpectedDate: string,
  amountVariance: number,
): { type: RecommendationType; reason: string; riskTags: string[] } {
  const riskTags: string[] = [];
  const nextDate = parseDate(nextExpectedDate);
  const daysUntilRenewal = nextDate ? daysBetween(formatDate(new Date()), formatDate(nextDate)) : 999;

  if (confidenceScore < 65) {
    riskTags.push("needs verification");
    return {
      type: "investigate",
      reason: "The pattern looks recurring, but date or amount consistency is not strong enough yet.",
      riskTags,
    };
  }

  if (amountVariance > 0.35) riskTags.push("variable amount");
  if (daysUntilRenewal >= 0 && daysUntilRenewal <= 10) riskTags.push("renews soon");

  if (["AI tools", "Cloud hosting", "Developer tools"].includes(category) && monthlyCost >= 2500) {
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

function calculateConfidence(count: number, gaps: number[], expectedGapDays: number, amountVariance: number): number {
  const countScore = Math.min(24, count * 7);
  const gapVariance = gaps.length > 1 ? standardDeviation(gaps) / (average(gaps) || 1) : 0.08;
  const cadenceScore = Math.max(0, 30 - gapVariance * 70);
  const amountScore = Math.max(0, 26 - amountVariance * 45);
  const frequencyScore = expectedGapDays > 0 ? 15 : 4;
  return Math.round(Math.max(42, Math.min(98, countScore + cadenceScore + amountScore + frequencyScore)));
}

function inferFrequency(averageGapDays: number, gaps: number[]): { frequency: Frequency; expectedGapDays: number; label: string } {
  if (!averageGapDays || !Number.isFinite(averageGapDays)) {
    return { frequency: "irregular", expectedGapDays: 30.44, label: "irregular" };
  }

  const closest = frequencyModels.reduce(
    (best, model) => {
      const distance = Math.abs(model.expectedGapDays - averageGapDays);
      return distance < best.distance ? { model, distance } : best;
    },
    { model: frequencyModels[0], distance: Number.POSITIVE_INFINITY },
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

function normalizeMerchant(description: string): { merchant: string; category: string } {
  const matchedRule = merchantRules.find((rule) => rule.pattern.test(description));
  if (matchedRule) return { merchant: matchedRule.merchant, category: matchedRule.category };

  const cleaned = description
    .toUpperCase()
    .replace(/UPI|IMPS|NEFT|ACH|ECS|NACH|MANDATE|AUTOPAY|SI|POS|CARD|DEBIT|CREDIT/g, " ")
    .replace(/[A-Z]{2,}\d{4,}|\d{3,}|[*/:_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const merchant = titleCase(cleaned.split(" ").slice(0, 4).join(" ") || "Unknown merchant");
  return { merchant, category: "Other" };
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

function parseDate(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : startOfDay(value);

  const trimmed = value.trim();
  if (!trimmed) return null;

  const nativeDate = new Date(trimmed);
  if (!Number.isNaN(nativeDate.getTime())) return startOfDay(nativeDate);

  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) return null;

  const first = Number.parseInt(match[1], 10);
  const second = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3].length === 2 ? `20${match[3]}` : match[3], 10);
  const day = first > 12 ? first : second > 12 ? second : first;
  const month = first > 12 ? second : second > 12 ? first : second;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : startOfDay(date);
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