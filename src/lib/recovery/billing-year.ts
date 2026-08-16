const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function addUtcMonths(isoDate: string, months: number): string {
  if (!datePattern.test(isoDate)) return isoDate;
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  const total = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(total / 12);
  const nextMonth = total % 12;
  const lastDay = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
  const clamped = Math.min(day, lastDay);
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth + 1).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}

/** First-year billing is twelve months from the customer's persisted anchor, not 1 January. */
export function billingYearStart(anchorDate: string, asOfDate: string): string {
  if (!datePattern.test(anchorDate) || !datePattern.test(asOfDate)) return anchorDate;
  let start = anchorDate;
  if (asOfDate < start) return start;
  while (addUtcMonths(start, 12) <= asOfDate) {
    start = addUtcMonths(start, 12);
  }
  return start;
}

/** Exclusive end of the billing year that contains periodStart. */
export function billingYearEndExclusive(anchorDate: string, periodStart: string): string {
  return addUtcMonths(billingYearStart(anchorDate, periodStart), 12);
}

/** Invoices must split or fail closed when a period includes the customer anniversary. */
export function feePeriodCrossesBillingAnniversary(
  anchorDate: string,
  periodStart: string,
  periodEnd: string,
): boolean {
  if (!datePattern.test(periodStart) || !datePattern.test(periodEnd) || periodEnd < periodStart) return true;
  return periodEnd >= billingYearEndExclusive(anchorDate, periodStart);
}
