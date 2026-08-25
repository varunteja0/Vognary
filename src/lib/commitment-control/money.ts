const postgresBigintMax = BigInt("9223372036854775807");
const supportedCurrencies = new Set(Intl.supportedValuesOf("currency"));

export function parseMinorUnits(value: unknown, label: string): bigint {
  if (typeof value !== "string" || value.length > 19 || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${label} must be a canonical non-negative decimal string of minor units.`);
  }
  const amount = BigInt(value);
  if (amount > postgresBigintMax) throw new Error(`${label} exceeds PostgreSQL bigint.`);
  return amount;
}

export function parsePositiveMinorUnits(value: unknown, label: string): bigint {
  const amount = parseMinorUnits(value, label);
  if (amount === BigInt(0)) throw new Error(`${label} must be a positive canonical decimal string of minor units.`);
  return amount;
}

export function normalizeCurrency(value: unknown, label = "Currency"): string {
  if (typeof value !== "string") throw new Error(`${label} must be a three-letter code.`);
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`${label} must be a three-letter code.`);
  if (!supportedCurrencies.has(currency)) throw new Error(`${label} must be a supported ISO currency code.`);
  return currency;
}

export function addMinorUnits(left: bigint, right: bigint, label = "Money total"): bigint {
  if (left < BigInt(0) || right < BigInt(0) || right > postgresBigintMax - left) {
    throw new Error(`${label} exceeds PostgreSQL bigint.`);
  }
  return left + right;
}

export function subtractToHeadroom(limit: bigint, used: bigint): string {
  return (used >= limit ? BigInt(0) : limit - used).toString();
}

export function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} must be a UUID.`);
  }
  return value.toLowerCase();
}