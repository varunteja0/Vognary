import {
  advanceDateByFrequency,
  getFrequencyGapDays,
  primaryCurrency,
  type Frequency,
  type RecurringItem,
} from "../recurring-audit";
import { formatCalendarDate, parseCalendarDate, startOfLocalDay } from "../date-only";

// The Financial Twin. `renewal-timeline.ts` answers "what renews in the next 45
// days"; this answers "what does my committed cash flow look like for the next
// year, and what happens if I change it". It reuses the same cadence primitives
// so a projected debit here is the same debit the calendar shows — never a
// second, drifting source of truth. Every projected debit carries the
// commitment's identityKey, so a "you'll be negative in November" claim is
// always traceable back to the evidence that proved the commitment.

const dayInMs = 24 * 60 * 60 * 1000;
const defaultHorizonDays = 365;
const maxHorizonDays = 1096; // ~3 years — the outer bound the Twin will project
const maxOccurrencesPerItem = 160; // bounds a weekly item over the 3-year cap (~156)

export type ProjectedDebit = {
  /** identityKey of the commitment — the citation anchor into the Proof Graph. */
  itemId: string;
  merchant: string;
  category: string;
  /** Positive money leaving the account, in `currency`. */
  amount: number;
  currency: string;
  /** Calendar date, yyyy-mm-dd. */
  date: string;
  daysAway: number;
  frequency: Frequency;
};

export type CashflowProjection = {
  horizonDays: number;
  /** yyyy-mm-dd the projection was anchored to. */
  today: string;
  generatedAt: string;
  debits: ProjectedDebit[];
  /** Steady-state committed monthly burn, primary currency only. */
  monthlyOutflow: number;
  /** Sum of primary-currency debits inside the horizon. Foreign is summed separately. */
  totalProjectedOutflow: number;
  /** Foreign debits are real but cannot be summed into a rupee total without FX. */
  foreignTotals: Record<string, number>;
};

export type ProjectionOptions = {
  horizonDays?: number;
  today?: Date;
};

export function projectCashflow(items: RecurringItem[], options: ProjectionOptions = {}): CashflowProjection {
  const horizonDays = clampHorizon(options.horizonDays ?? defaultHorizonDays);
  const today = startOfLocalDay(options.today ?? new Date());
  const horizonEnd = new Date(today.getTime() + horizonDays * dayInMs);
  const debits: ProjectedDebit[] = [];

  for (const item of items) {
    let occurrence = parseCalendarDate(item.nextExpectedDate);
    if (!occurrence) continue;

    const gapDays = item.averageGapDays || getFrequencyGapDays(item.frequency);
    const anchorDay = occurrence.getDate();

    for (let count = 0; count < maxOccurrencesPerItem && occurrence <= horizonEnd; count += 1) {
      if (occurrence >= today) {
        debits.push({
          itemId: item.identityKey,
          merchant: item.merchant,
          category: item.category,
          amount: item.averageAmount,
          currency: item.currency,
          date: formatCalendarDate(occurrence),
          daysAway: Math.round((occurrence.getTime() - today.getTime()) / dayInMs),
          frequency: item.frequency,
        });
      }
      const next = advanceDateByFrequency(occurrence, item.frequency, gapDays, anchorDay);
      // A cadence that fails to advance would loop forever; stop instead.
      if (next.getTime() <= occurrence.getTime()) break;
      occurrence = next;
    }
  }

  debits.sort((left, right) => left.daysAway - right.daysAway || right.amount - left.amount);

  const foreignTotals: Record<string, number> = {};
  let totalProjectedOutflow = 0;
  for (const debit of debits) {
    if (debit.currency === primaryCurrency) {
      totalProjectedOutflow += debit.amount;
    } else {
      foreignTotals[debit.currency] = (foreignTotals[debit.currency] ?? 0) + debit.amount;
    }
  }
  for (const code of Object.keys(foreignTotals)) foreignTotals[code] = round2(foreignTotals[code]);

  const monthlyOutflow = items
    .filter((item) => item.currency === primaryCurrency)
    .reduce((sum, item) => sum + item.monthlyCost, 0);

  return {
    horizonDays,
    today: formatCalendarDate(today),
    generatedAt: new Date().toISOString(),
    debits,
    monthlyOutflow: round2(monthlyOutflow),
    totalProjectedOutflow: round2(totalProjectedOutflow),
    foreignTotals,
  };
}

function clampHorizon(value: number): number {
  return Math.max(1, Math.min(maxHorizonDays, Math.round(value)));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
