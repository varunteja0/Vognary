// Renewal dates are calendar dates, not instants. Native `YYYY-MM-DD` parsing
// treats the value as UTC and can display the previous day in western zones.
export function parseIsoDateOnly(value: string): Date | null {
  const match = value.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return parsed;
}

export function parseCalendarDate(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : startOfLocalDay(value);
  const exact = parseIsoDateOnly(value);
  if (exact) return exact;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : startOfLocalDay(parsed);
}

export function formatCalendarDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export const INDIA_CALENDAR_TIME_ZONE = "Asia/Kolkata";

export function calendarDateInTimeZone(date: Date, timeZone: string): string {
  if (Number.isNaN(date.getTime())) throw new Error("Calendar date formatting requires a valid instant.");
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  if (!year || !month || !day) throw new Error("Calendar date formatting did not return a complete date.");
  return `${year}-${month}-${day}`;
}

export function indiaCalendarDate(date: Date = new Date()): string {
  return calendarDateInTimeZone(date, INDIA_CALENDAR_TIME_ZONE);
}

export function formatCalendarDayShort(value: string): string {
  const parsed = parseIsoDateOnly(value);
  if (!parsed) return value;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(parsed);
}
