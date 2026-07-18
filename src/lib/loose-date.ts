import { formatCalendarDate, parseIsoDateOnly } from "./date-only";

export type NumericDateOrder = "day-first" | "month-first";

export type NumericDateOrderResolution = {
  order: NumericDateOrder | null;
  status: "resolved" | "ambiguous" | "conflicting" | "not-needed";
  ambiguousCount: number;
  invalidCount: number;
};

type NumericDateClassification =
  | { kind: "day-first" | "month-first" | "ambiguous"; dayFirst: string | null; monthFirst: string | null }
  | { kind: "same"; value: string }
  | { kind: "invalid" }
  | { kind: "not-numeric" };

/**
 * Resolve an entire source before parsing any ambiguous DD/MM or MM/DD rows.
 * A single decisive row can establish the source order; conflicting decisive
 * rows deliberately leave ambiguous rows unresolved.
 */
export function resolveNumericDateOrder(values: readonly string[]): NumericDateOrderResolution {
  let dayFirst = false;
  let monthFirst = false;
  let ambiguousCount = 0;
  let invalidCount = 0;

  for (const value of values) {
    const classification = classifyNumericDate(value);
    if (classification.kind === "day-first") dayFirst = true;
    if (classification.kind === "month-first") monthFirst = true;
    if (classification.kind === "ambiguous") ambiguousCount += 1;
    if (classification.kind === "invalid") invalidCount += 1;
  }

  if (dayFirst && monthFirst) return { order: null, status: "conflicting", ambiguousCount, invalidCount };
  if (dayFirst) return { order: "day-first", status: "resolved", ambiguousCount, invalidCount };
  if (monthFirst) return { order: "month-first", status: "resolved", ambiguousCount, invalidCount };
  if (ambiguousCount) return { order: null, status: "ambiguous", ambiguousCount, invalidCount };
  return { order: null, status: "not-needed", ambiguousCount, invalidCount };
}

/**
 * Parse only calendar-date forms whose meaning is deterministic. Native Date
 * parsing is intentionally avoided because it guesses locale and rolls invalid
 * dates into a different month.
 */
export function parseLooseCalendarDate(
  value: string,
  numericOrder: NumericDateOrder | null = null,
): string | null {
  const normalized = value.trim();
  const yearFirst = normalized.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (yearFirst) return buildCalendarDate(yearFirst[1], yearFirst[2], yearFirst[3]);

  const monthName = parseMonthNameDate(normalized);
  if (monthName) return monthName;

  const classification = classifyNumericDate(normalized);
  if (classification.kind === "same") return classification.value;
  if (classification.kind === "day-first") return classification.dayFirst;
  if (classification.kind === "month-first") return classification.monthFirst;
  if (classification.kind !== "ambiguous" || !numericOrder) return null;
  return numericOrder === "day-first" ? classification.dayFirst : classification.monthFirst;
}

const monthNameNumbers: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

/**
 * "17 July 2026", "17th Jul 2026", "July 17, 2026", "Aug 1 2026" — real
 * receipts overwhelmingly write dates with month names. A named month is
 * deterministic, so no day/month ambiguity is possible.
 */
function parseMonthNameDate(value: string): string | null {
  const dayFirst = value.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  const monthFirst = value.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  const parts = dayFirst
    ? { day: dayFirst[1], month: dayFirst[2], year: dayFirst[3] }
    : monthFirst
      ? { day: monthFirst[2], month: monthFirst[1], year: monthFirst[3] }
      : null;
  if (!parts) return null;
  const month = monthNameNumbers[parts.month.toLowerCase()];
  return month ? buildCalendarDate(parts.year, String(month), parts.day) : null;
}

function classifyNumericDate(value: string): NumericDateClassification {
  const match = value.trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/);
  if (!match) return { kind: "not-numeric" };

  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  const dayFirst = buildCalendarDate(year, match[2], match[1]);
  const monthFirst = buildCalendarDate(year, match[1], match[2]);

  if (dayFirst && monthFirst) {
    return dayFirst === monthFirst
      ? { kind: "same", value: dayFirst }
      : { kind: "ambiguous", dayFirst, monthFirst };
  }
  if (dayFirst) return { kind: "day-first", dayFirst, monthFirst: null };
  if (monthFirst) return { kind: "month-first", dayFirst: null, monthFirst };
  return { kind: "invalid" };
}

function buildCalendarDate(year: string, month: string, day: string): string | null {
  const iso = `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = parseIsoDateOnly(iso);
  return parsed ? formatCalendarDate(parsed) : null;
}
