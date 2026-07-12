import type { AuditResult, RecommendationType } from "./recurring-audit";

export type ReviewSnapshotItem = {
  key: string;
  merchant: string;
  category: string;
  /** Added after v1 launch; old browser snapshots default to the primary currency. */
  currency?: string;
  frequency: string;
  monthlyCost: number;
  averageAmount: number;
  nextExpectedDate: string;
  action: RecommendationType;
};

export type ReviewSnapshot = {
  version: 1;
  takenAt: string;
  coverageScore: number;
  monthlyRecurringSpend: number;
  itemCount: number;
  items: ReviewSnapshotItem[];
};

export type ReviewPriceChange = {
  merchant: string;
  category: string;
  currency: string;
  fromAmount: number;
  toAmount: number;
  changePercent: number;
  direction: "increase" | "decrease";
};

export type ReviewDiff = {
  daysSincePrevious: number;
  previousTakenAt: string;
  added: ReviewSnapshotItem[];
  removed: ReviewSnapshotItem[];
  priceChanges: ReviewPriceChange[];
  monthlyDelta: number;
  coverageDelta: number;
  hasChanges: boolean;
};

// Snapshot the ledger at review completion so the next review can open with
// "what changed since last time" instead of a cold table. This is the seed of
// the month-over-month diff engine: pure data in, pure diff out.
export function buildReviewSnapshot(
  audit: AuditResult,
  userActions: Record<string, RecommendationType>,
  coverageScore: number,
  takenAt = new Date().toISOString(),
): ReviewSnapshot {
  return {
    version: 1,
    takenAt,
    coverageScore,
    monthlyRecurringSpend: audit.summary.monthlyRecurringSpend,
    itemCount: audit.summary.recurringCount,
    items: audit.recurringItems.map((item) => ({
      key: item.identityKey,
      merchant: item.merchant,
      category: item.category,
      currency: item.currency,
      frequency: item.frequency,
      monthlyCost: item.monthlyCost,
      averageAmount: item.averageAmount,
      nextExpectedDate: item.nextExpectedDate,
      action: userActions[item.identityKey] ?? item.recommendationType,
    })),
  };
}

export function diffReviews(previous: ReviewSnapshot, current: ReviewSnapshot): ReviewDiff {
  const previousByKey = new Map(previous.items.map((item) => [item.key, item]));
  const currentByKey = new Map(current.items.map((item) => [item.key, item]));

  const added = current.items.filter((item) => !previousByKey.has(item.key));
  const removed = previous.items.filter((item) => !currentByKey.has(item.key));

  const priceChanges: ReviewPriceChange[] = [];
  for (const item of current.items) {
    const before = previousByKey.get(item.key);
    if (!before) continue;
    const delta = item.averageAmount - before.averageAmount;
    const currency = item.currency ?? before.currency ?? "INR";
    const absoluteNoiseFloor = currency === "INR" ? 25 : 1;
    if (Math.abs(delta) < absoluteNoiseFloor || Math.abs(delta) / Math.max(before.averageAmount, 1) < 0.05) continue;
    priceChanges.push({
      merchant: item.merchant,
      category: item.category,
      currency,
      fromAmount: round2(before.averageAmount),
      toAmount: round2(item.averageAmount),
      changePercent: Math.round((Math.abs(delta) / Math.max(before.averageAmount, 1)) * 100),
      direction: delta > 0 ? "increase" : "decrease",
    });
  }
  priceChanges.sort((left, right) => right.changePercent - left.changePercent);

  const monthlyDelta = current.monthlyRecurringSpend - previous.monthlyRecurringSpend;
  const coverageDelta = current.coverageScore - previous.coverageScore;

  return {
    daysSincePrevious: daysBetween(previous.takenAt, current.takenAt),
    previousTakenAt: previous.takenAt,
    added: sortByCost(added),
    removed: sortByCost(removed),
    priceChanges,
    monthlyDelta,
    coverageDelta,
    hasChanges: added.length > 0 || removed.length > 0 || priceChanges.length > 0 || Math.abs(monthlyDelta) >= 1,
  };
}

export function isReviewSnapshot(value: unknown): value is ReviewSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<ReviewSnapshot>;
  return snapshot.version === 1
    && typeof snapshot.takenAt === "string"
    && typeof snapshot.monthlyRecurringSpend === "number"
    && Array.isArray(snapshot.items);
}

function sortByCost(items: ReviewSnapshotItem[]): ReviewSnapshotItem[] {
  return [...items].sort((left, right) => right.monthlyCost - left.monthlyCost);
}

function daysBetween(left: string, right: string): number {
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) return 0;
  return Math.max(0, Math.round((rightDate.getTime() - leftDate.getTime()) / (24 * 60 * 60 * 1000)));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
