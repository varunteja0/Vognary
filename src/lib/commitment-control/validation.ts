export function requireControlRecord(value: unknown, label: string): Record<string, unknown> {
  if (Object.prototype.toString.call(value) !== "[object Object]") throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

export function rejectUnknownControlFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
) {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(record).find((key) => !allowedSet.has(key));
  if (unknown) throw new Error(`${label} has unknown field ${unknown}.`);
}

export function boundedControlText(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
) {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) throw new Error(`${label} length is invalid.`);
  return normalized;
}

export function normalizeControlDateOnly(value: unknown, label: string): string {
  if (typeof value !== "string" || !isCanonicalControlDateOnly(value)) {
    throw new Error(`${label} must be a real ISO calendar date.`);
  }
  return value;
}

export function isCanonicalControlDateOnly(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1])
    && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3]);
}
