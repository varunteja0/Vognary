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
