import { primaryCurrency } from "../recurring-audit";
import { formatCalendarDate, parseCalendarDate, startOfLocalDay } from "../date-only";
import type { CashflowProjection } from "./project";

// Runway: walk a running balance forward over the projected debits plus the
// user's stated income, and report when (if ever) it goes negative. The
// opening balance and income are *user-entered*, never "proven" — the UI must
// label them as such. Only primary-currency debits move the balance; foreign
// debits are real but can't be folded into a rupee balance without FX, so they
// are excluded here and surfaced separately by the projection.

const dayInMs = 24 * 60 * 60 * 1000;
const daysPerMonth = 30.44;

export type RunwayInputs = {
  /** User-entered available balance today. */
  openingBalance: number;
  /** User-entered recurring monthly credit (salary). Default 0. */
  monthlyIncome?: number;
  /** Day of month income lands, clamped to 1..28 to avoid short-month drift. Default 1. */
  incomeDayOfMonth?: number;
  today?: Date;
};

export type RunwayResult = {
  openingBalance: number;
  monthlyIncome: number;
  /** Days until the balance first goes negative. null = it never does within the horizon. */
  runwayDays: number | null;
  /** runwayDays expressed in months (30.44-day). null when runwayDays is null. */
  runwayMonths: number | null;
  /** yyyy-mm-dd the balance first goes negative, or null. */
  firstNegativeDate: string | null;
  /** Lowest balance reached inside the horizon, and the date it occurs. */
  lowestBalance: number;
  lowestBalanceDate: string;
  /** Balance at the end of the horizon. */
  endingBalance: number;
};

type CashEvent = { time: number; date: string; delta: number };

export function computeRunway(projection: CashflowProjection, inputs: RunwayInputs): RunwayResult {
  const openingBalance = inputs.openingBalance;
  const monthlyIncome = Math.max(0, inputs.monthlyIncome ?? 0);
  const incomeDayOfMonth = clampDayOfMonth(inputs.incomeDayOfMonth ?? 1);
  const today = startOfLocalDay(inputs.today ?? parseCalendarDate(projection.today) ?? new Date());
  const todayTime = today.getTime();
  const horizonEnd = new Date(todayTime + projection.horizonDays * dayInMs);

  // An already-negative opening balance means zero runway today; nothing to walk.
  if (openingBalance < 0) {
    const todayIso = formatCalendarDate(today);
    return {
      openingBalance,
      monthlyIncome,
      runwayDays: 0,
      runwayMonths: 0,
      firstNegativeDate: todayIso,
      lowestBalance: round2(openingBalance),
      lowestBalanceDate: todayIso,
      endingBalance: round2(openingBalance),
    };
  }

  const events: CashEvent[] = [];
  for (const debit of projection.debits) {
    if (debit.currency !== primaryCurrency) continue; // rupee balance only
    const date = parseCalendarDate(debit.date);
    if (!date) continue;
    events.push({ time: date.getTime(), date: debit.date, delta: -debit.amount });
  }
  for (const income of enumerateIncome(today, horizonEnd, incomeDayOfMonth, monthlyIncome)) {
    events.push(income);
  }

  // Same-day ordering is conservative: debits are applied before income, so a
  // charge that lands the morning before payday still counts against runway.
  events.sort((left, right) => left.time - right.time || left.delta - right.delta);

  let balance = openingBalance;
  let lowestBalance = openingBalance;
  let lowestBalanceDate = formatCalendarDate(today);
  let firstNegativeDate: string | null = null;
  let firstNegativeTime: number | null = null;

  for (const event of events) {
    balance += event.delta;
    if (balance < lowestBalance) {
      lowestBalance = balance;
      lowestBalanceDate = event.date;
    }
    if (balance < 0 && firstNegativeDate === null) {
      firstNegativeDate = event.date;
      firstNegativeTime = event.time;
    }
  }

  const runwayDays = firstNegativeTime === null ? null : Math.max(0, Math.round((firstNegativeTime - todayTime) / dayInMs));

  return {
    openingBalance: round2(openingBalance),
    monthlyIncome: round2(monthlyIncome),
    runwayDays,
    runwayMonths: runwayDays === null ? null : round1(runwayDays / daysPerMonth),
    firstNegativeDate,
    lowestBalance: round2(lowestBalance),
    lowestBalanceDate,
    endingBalance: round2(balance),
  };
}

// Income lands on `dayOfMonth` each month strictly after today (today's income
// is assumed already inside the opening balance), through the horizon end.
function enumerateIncome(today: Date, horizonEnd: Date, dayOfMonth: number, monthlyIncome: number): CashEvent[] {
  if (monthlyIncome <= 0) return [];
  const events: CashEvent[] = [];
  const todayTime = today.getTime();
  const horizonTime = horizonEnd.getTime();
  let year = today.getFullYear();
  let month = today.getMonth();
  for (let guard = 0; guard < maxIncomeMonths; guard += 1) {
    const date = new Date(year, month, dayOfMonth);
    const time = date.getTime();
    if (time > horizonTime) break;
    if (time > todayTime) events.push({ time, date: formatCalendarDate(date), delta: monthlyIncome });
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return events;
}

const maxIncomeMonths = Math.ceil(1096 / 28) + 2; // covers the 3-year horizon cap

function clampDayOfMonth(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(28, Math.round(value)));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
