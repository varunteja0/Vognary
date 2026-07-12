import {
  advanceDateByFrequency,
  getFrequencyGapDays,
  getFrequencyMonthlyMultiplier,
  primaryCurrency,
  type RecommendationType,
  type RecurringItem,
} from "./recurring-audit";
import { parseCalendarDate } from "./date-only";

export type ActionMeta = {
  action: RecommendationType;
  decidedAt: string;
};

export type SavingStatus =
  /** Evidence does not yet cover the first expected debit after the decision. */
  | "watching"
  /** One clean cycle proven; one more confirms it. */
  | "verifying"
  /** Two or more expected debits passed inside covered evidence with no charge. */
  | "verified"
  /** The charge kept appearing after the decision. */
  | "not-eliminated";

export type VerifiedSaving = {
  itemId: string;
  merchant: string;
  category: string;
  currency: string;
  action: "cancel" | "downgrade";
  decidedAt: string;
  monthlySaving: number;
  annualSaving: number;
  cleanCycles: number;
  requiredCleanCycles: number;
  status: SavingStatus;
  detail: string;
};

export type VerifiedSavingsSummary = {
  entries: VerifiedSaving[];
  verifiedMonthly: number;
  verifiedAnnual: number;
  pendingMonthly: number;
};

/**
 * A continuous interval covered by one account-specific evidence source.
 * `source` must exactly match the EvidenceLink source for the commitment; a
 * provider-wide label is not sufficient when it can represent many accounts.
 */
export type EvidenceCoverageWindow = {
  source: string;
  startDate: string;
  endDate: string;
};

export type VerifiedSavingsOptions = {
  today?: Date;
  /** Days after an expected debit before its window counts as passed. */
  graceDays?: number;
  /** Explicit same-source coverage; unrelated or inferred evidence is unsafe. */
  coverageWindows?: EvidenceCoverageWindow[];
};

type NormalizedCoverageWindow = {
  source: string;
  startDate: Date;
  endDate: Date;
};

// A yearly cancel must not take two years to verify: one clean yearly cycle is
// already twelve months of proven silence.
function requiredCleanCyclesFor(frequency: RecurringItem["frequency"]): number {
  return frequency === "yearly" ? 1 : 2;
}

// Vognary does not claim savings — it proves them. After a cancel/downgrade
// decision the engine watches the item's own predicted debit dates. A debit
// that fails to appear inside evidence that actually covers that date is a
// proven clean cycle; anything less stays honestly pending.
export function buildVerifiedSavings(
  items: RecurringItem[],
  actionsMeta: Record<string, ActionMeta>,
  options: VerifiedSavingsOptions = {},
): VerifiedSavingsSummary {
  const today = startOfDay(options.today ?? new Date());
  const graceDays = options.graceDays ?? 5;
  const coverageWindows = normalizeCoverageWindows(options.coverageWindows ?? [], today);
  const entries: VerifiedSaving[] = [];

  for (const item of items) {
    const meta = actionsMeta[item.identityKey];
    if (!meta || (meta.action !== "cancel" && meta.action !== "downgrade")) continue;
    const decidedAt = parseDate(meta.decidedAt);
    if (!decidedAt) continue;

    const entry = meta.action === "cancel"
      ? evaluateCancel(item, decidedAt, meta.decidedAt, today, graceDays, coverageWindows)
      : evaluateDowngrade(item, decidedAt, meta.decidedAt, today, graceDays, coverageWindows);
    if (entry) entries.push(entry);
  }

  entries.sort((left, right) => right.annualSaving - left.annualSaving);

  // Headline totals stay in the primary currency; foreign savings show on
  // their own entries with their own currency, never silently converted.
  const primaryVerified = entries.filter((entry) => entry.status === "verified" && entry.currency === primaryCurrency);
  const primaryPending = entries.filter((entry) => (entry.status === "verifying" || entry.status === "watching") && entry.currency === primaryCurrency);

  return {
    entries,
    verifiedMonthly: sum(primaryVerified.map((entry) => entry.monthlySaving)),
    verifiedAnnual: sum(primaryVerified.map((entry) => entry.annualSaving)),
    pendingMonthly: sum(primaryPending.map((entry) => entry.monthlySaving)),
  };
}

function evaluateCancel(
  item: RecurringItem,
  decidedAt: Date,
  decidedAtRaw: string,
  today: Date,
  graceDays: number,
  coverageWindows: NormalizedCoverageWindow[],
): VerifiedSaving {
  const expectedDates = expectedDebitsAfter(item, decidedAt, today);
  const chargesAfter = item.evidence.filter((link) => {
    const date = parseDate(link.date);
    return isObservedCharge(link.kind) && date ? date > decidedAt && date <= today : false;
  });

  const cyclesRequired = requiredCleanCyclesFor(item.frequency);
  const base = {
    itemId: item.identityKey,
    merchant: item.merchant,
    category: item.category,
    currency: item.currency,
    action: "cancel" as const,
    decidedAt: decidedAtRaw,
    monthlySaving: item.monthlyCost,
    annualSaving: item.monthlyCost * 12,
    requiredCleanCycles: cyclesRequired,
  };

  if (chargesAfter.length > 0) {
    return {
      ...base,
      cleanCycles: 0,
      status: "not-eliminated",
      detail: `Charged ${chargesAfter.length} time(s) after the cancel decision — the commitment is still active. Re-check the cancellation.`,
    };
  }

  // A clean cycle only counts when evidence coverage extends past the expected
  // debit's grace window. Silence outside covered evidence proves nothing.
  const cleanCycles = expectedDates.filter((date) => {
    const windowStart = addDays(date, -graceDays);
    const windowEnd = addDays(date, graceDays);
    return windowEnd <= today && isCoveredByItemSource(item, windowStart, windowEnd, coverageWindows);
  }).length;

  if (cleanCycles >= cyclesRequired) {
    return {
      ...base,
      cleanCycles,
      status: "verified",
      detail: `${cleanCycles} expected debit(s) passed inside covered evidence with no charge. ${formatCurrency(item.monthlyCost * 12, item.currency)}/yr verifiably stopped leaving.`,
    };
  }

  if (cleanCycles >= 1) {
    return {
      ...base,
      cleanCycles,
      status: "verifying",
      detail: "One clean cycle proven. One more evidence-covered cycle confirms the saving.",
    };
  }

  const firstExpected = expectedDates[0] ?? advanceDateByFrequency(decidedAt, item.frequency, cycleGap(item));
  return {
    ...base,
    cleanCycles: 0,
    status: "watching",
    detail: `Waiting for continuous evidence from the same account source through ${formatDate(addDays(firstExpected, graceDays))}.`,
  };
}

function evaluateDowngrade(
  item: RecurringItem,
  decidedAt: Date,
  decidedAtRaw: string,
  today: Date,
  graceDays: number,
  coverageWindows: NormalizedCoverageWindow[],
): VerifiedSaving | null {
  const before = item.evidence.filter((link) => {
    const date = parseDate(link.date);
    return isObservedCharge(link.kind) && date ? date <= decidedAt : false;
  });
  const after = item.evidence.filter((link) => {
    const date = parseDate(link.date);
    return isObservedCharge(link.kind) && date ? date > decidedAt && date <= today : false;
  });
  const previousAverage = before.length ? sum(before.map((link) => link.amount)) / before.length : item.averageAmount;

  const base = {
    itemId: item.identityKey,
    merchant: item.merchant,
    category: item.category,
    currency: item.currency,
    action: "downgrade" as const,
    decidedAt: decidedAtRaw,
    requiredCleanCycles: 1,
  };

  if (after.length) {
    const latest = after[after.length - 1];
    const delta = previousAverage - latest.amount;
    if (delta >= Math.max(10, previousAverage * 0.08)) {
      const monthlySaving = delta * getFrequencyMonthlyMultiplier(item.frequency);
      return {
        ...base,
        monthlySaving,
        annualSaving: monthlySaving * 12,
        cleanCycles: 1,
        status: "verified",
        detail: `The charge dropped from ${formatCurrency(previousAverage, item.currency)} to ${formatCurrency(latest.amount, item.currency)} after the downgrade decision — proven by the newer evidence row.`,
      };
    }
    return {
      ...base,
      monthlySaving: 0,
      annualSaving: 0,
      cleanCycles: 0,
      status: "not-eliminated",
      detail: `The latest charge (${formatCurrency(latest.amount, item.currency)}) is not lower than the earlier average (${formatCurrency(previousAverage, item.currency)}). The downgrade has not taken effect yet.`,
    };
  }

  const firstExpected = expectedDebitsAfter(item, decidedAt, today)[0]
    ?? advanceDateByFrequency(decidedAt, item.frequency, cycleGap(item));
  const coverageReached = isCoveredByItemSource(
    item,
    addDays(firstExpected, -graceDays),
    addDays(firstExpected, graceDays),
    coverageWindows,
  );
  return {
    ...base,
    monthlySaving: 0,
    annualSaving: 0,
    cleanCycles: 0,
    status: "watching",
    detail: coverageReached
      ? "No charge has appeared at all since the downgrade decision — if it was meant to continue at a lower price, confirm the plan state at the provider."
      : `Waiting for a post-decision charge (or evidence covering ${formatDate(addDays(firstExpected, graceDays))}) to prove the lower price.`,
  };
}

function normalizeCoverageWindows(
  windows: EvidenceCoverageWindow[],
  today: Date,
): NormalizedCoverageWindow[] {
  const normalized: NormalizedCoverageWindow[] = [];
  for (const window of windows) {
    const source = window.source.trim();
    const startDate = parseDate(window.startDate);
    const rawEndDate = parseDate(window.endDate);
    if (!source || !startDate || !rawEndDate || startDate > rawEndDate) continue;
    const endDate = rawEndDate > today ? today : rawEndDate;
    if (startDate > endDate) continue;
    normalized.push({ source, startDate, endDate });
  }
  return normalized;
}

function isCoveredByItemSource(
  item: RecurringItem,
  windowStart: Date,
  windowEnd: Date,
  coverageWindows: NormalizedCoverageWindow[],
): boolean {
  const observedSources = new Set(
    item.evidence
      .filter((link) => isObservedCharge(link.kind))
      .map((link) => link.source),
  );
  return coverageWindows.some((window) =>
    observedSources.has(window.source)
    && window.startDate <= windowStart
    && window.endDate >= windowEnd);
}

function isObservedCharge(kind: RecurringItem["evidence"][number]["kind"]): boolean {
  // Older persisted evidence predates the discriminator and came from parsed
  // statement rows, so absent values remain backward-compatible as observed.
  return kind !== "scheduled";
}

function expectedDebitsAfter(item: RecurringItem, decidedAt: Date, today: Date): Date[] {
  const gapDays = cycleGap(item);
  const anchor = parseDate(item.nextExpectedDate) ?? advanceDateByFrequency(decidedAt, item.frequency, gapDays);

  // Walk the schedule from the earliest known anchor back-projected around the
  // decision, then forward while cycles fall between the decision and today.
  let cursor = anchor;
  let guard = 0;
  while (cursor > decidedAt && guard < 240) {
    const previous = retreatDateByFrequency(cursor, item.frequency, gapDays);
    if (previous <= decidedAt) break;
    cursor = previous;
    guard += 1;
  }
  if (cursor <= decidedAt) cursor = advanceDateByFrequency(cursor, item.frequency, gapDays);

  const dates: Date[] = [];
  guard = 0;
  while (cursor <= today && guard < 240) {
    if (cursor > decidedAt) dates.push(cursor);
    cursor = advanceDateByFrequency(cursor, item.frequency, gapDays);
    guard += 1;
  }
  return dates;
}

function retreatDateByFrequency(date: Date, frequency: RecurringItem["frequency"], gapDays: number): Date {
  switch (frequency) {
    case "weekly": return addDays(date, -7);
    case "biweekly": return addDays(date, -14);
    case "semimonthly": return addDays(date, -15);
    case "monthly": return addMonths(date, -1);
    case "bimonthly": return addMonths(date, -2);
    case "quarterly": return addMonths(date, -3);
    case "yearly": return addMonths(date, -12);
    default: return addDays(date, -Math.max(7, Math.round(gapDays || 30.44)));
  }
}

function cycleGap(item: RecurringItem): number {
  return item.averageGapDays || getFrequencyGapDays(item.frequency);
}

function addMonths(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const day = Math.min(date.getDate(), new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate());
  return new Date(target.getFullYear(), target.getMonth(), day);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function parseDate(value: string): Date | null {
  return parseCalendarDate(value);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "INR" ? 0 : 2,
  }).format(value);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
