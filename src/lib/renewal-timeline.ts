import {
  advanceDateByFrequency,
  getFrequencyGapDays,
  primaryCurrency,
  type Frequency,
  type RecommendationType,
  type RecurringItem,
} from "./recurring-audit";
import { parseCalendarDate } from "./date-only";

export type RenewalEvent = {
  /** Stable identity key of the commitment (survives re-imports). */
  itemId: string;
  merchant: string;
  category: string;
  amount: number;
  currency: string;
  date: string;
  daysAway: number;
  frequency: Frequency;
  action: RecommendationType;
  confidenceScore: number;
};

export type RenewalBucket = {
  label: string;
  fromDay: number;
  toDay: number;
  events: RenewalEvent[];
  total: number;
};

export type RenewalTimeline = {
  horizonDays: number;
  generatedAt: string;
  events: RenewalEvent[];
  buckets: RenewalBucket[];
  /** Totals are primary-currency only; foreign renewals are listed but summed separately. */
  totalDue: number;
  dueNext7Days: number;
  dueNext30Days: number;
  foreignTotals: Record<string, number>;
};

export type RenewalTimelineOptions = {
  horizonDays?: number;
  today?: Date;
  /** User-chosen actions override the engine recommendation per item id. */
  actions?: Record<string, RecommendationType>;
};

const dayInMs = 24 * 60 * 60 * 1000;
const maxEventsPerItem = 8;

const bucketDefinitions = [
  { label: "Next 7 days", fromDay: 0, toDay: 7 },
  { label: "8–14 days", fromDay: 8, toDay: 14 },
  { label: "15–30 days", fromDay: 15, toDay: 30 },
  { label: "Beyond 30 days", fromDay: 31, toDay: Number.POSITIVE_INFINITY },
];

// Project every recurring item's expected debits inside the horizon, so the
// product can answer "what renews next and what will it cost" as one schedule.
export function buildRenewalTimeline(items: RecurringItem[], options: RenewalTimelineOptions = {}): RenewalTimeline {
  const horizonDays = Math.max(1, Math.min(365, options.horizonDays ?? 45));
  const today = startOfDay(options.today ?? new Date());
  const horizonEnd = new Date(today.getTime() + horizonDays * dayInMs);
  const events: RenewalEvent[] = [];

  for (const item of items) {
    let occurrence = parseIsoDate(item.nextExpectedDate);
    if (!occurrence) continue;

    const gapDays = item.averageGapDays || getFrequencyGapDays(item.frequency);
    const anchorDay = occurrence.getDate();

    for (let count = 0; count < maxEventsPerItem && occurrence <= horizonEnd; count += 1) {
      if (occurrence >= today) {
        events.push({
          itemId: item.identityKey,
          merchant: item.merchant,
          category: item.category,
          amount: item.averageAmount,
          currency: item.currency,
          date: formatIsoDate(occurrence),
          daysAway: Math.round((occurrence.getTime() - today.getTime()) / dayInMs),
          frequency: item.frequency,
          action: options.actions?.[item.identityKey] ?? item.recommendationType,
          confidenceScore: item.confidenceScore,
        });
      }
      occurrence = advanceDateByFrequency(occurrence, item.frequency, gapDays, anchorDay);
    }
  }

  events.sort((left, right) => left.daysAway - right.daysAway || right.amount - left.amount);

  const buckets = bucketDefinitions
    .filter((bucket) => bucket.fromDay <= horizonDays)
    .map((bucket) => {
      const bucketEvents = events.filter((event) => event.daysAway >= bucket.fromDay && event.daysAway <= Math.min(bucket.toDay, horizonDays));
      return {
        label: bucket.label,
        fromDay: bucket.fromDay,
        toDay: Math.min(bucket.toDay, horizonDays),
        events: bucketEvents,
        total: sumAmounts(bucketEvents),
      };
    })
    .filter((bucket) => bucket.events.length > 0);

  const foreignTotals: Record<string, number> = {};
  for (const event of events) {
    if (event.currency === primaryCurrency) continue;
    foreignTotals[event.currency] = (foreignTotals[event.currency] ?? 0) + event.amount;
  }

  return {
    horizonDays,
    generatedAt: new Date().toISOString(),
    events,
    buckets,
    totalDue: sumAmounts(events),
    dueNext7Days: sumAmounts(events.filter((event) => event.daysAway <= 7)),
    dueNext30Days: sumAmounts(events.filter((event) => event.daysAway <= 30)),
    foreignTotals,
  };
}

// Sums cover primary-currency events only; a USD amount must never silently
// add into a rupee total.
function sumAmounts(events: RenewalEvent[]): number {
  return events
    .filter((event) => event.currency === primaryCurrency)
    .reduce((total, event) => total + event.amount, 0);
}

function parseIsoDate(value: string): Date | null {
  return parseCalendarDate(value);
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
