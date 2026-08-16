import { createHash } from "node:crypto";
import type { Cadence } from "@/lib/recovery/contracts";

export type RecurrenceOccurrence = {
  evidenceDate: string;
  amountMinor: bigint;
  currency: string;
  merchant: string;
  cadence: Cadence | null;
  citedNextExpectedDate: string | null;
  explicitProviderRenewal: boolean;
};

export const nextDebitReasons = [
  "STABLE_CADENCE",
  "CITED_RENEWAL",
  "MISSING_NEXT",
  "CONFLICTING_DATES",
  "IRREGULAR",
  "CORRECTED",
  "INSUFFICIENT_OCCURRENCES",
] as const;
export type NextDebitReason = (typeof nextDebitReasons)[number];

export type NextDebitDerivation = {
  nextDebitDate: string | null;
  stable: boolean;
  cadence: Cadence | null;
  inputsHash: string;
  reason: NextDebitReason;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function deriveNextDebit(input: {
  occurrences: readonly RecurrenceOccurrence[];
  correctionInvalidates?: boolean;
  callerSuppliedDate?: string | null;
  persistedDerivation?: NextDebitDerivation | null;
}): NextDebitDerivation {
  if (input.persistedDerivation) {
    if (input.callerSuppliedDate && input.callerSuppliedDate !== input.persistedDerivation.nextDebitDate) {
      return input.persistedDerivation;
    }
    if (!input.correctionInvalidates) return input.persistedDerivation;
  }

  const inputsHash = hashDerivationInputs(input.occurrences, Boolean(input.correctionInvalidates));
  if (input.correctionInvalidates) {
    return { nextDebitDate: null, stable: false, cadence: null, inputsHash, reason: "CORRECTED" };
  }

  const dated = input.occurrences
    .filter((row) => datePattern.test(row.evidenceDate))
    .slice()
    .sort((left, right) => left.evidenceDate.localeCompare(right.evidenceDate));
  if (!dated.length) {
    return { nextDebitDate: null, stable: false, cadence: null, inputsHash, reason: "INSUFFICIENT_OCCURRENCES" };
  }

  const cadences = unique(dated.map((row) => row.cadence).filter((value): value is Cadence => Boolean(value)));
  const amounts = unique(dated.map((row) => row.amountMinor.toString()));
  const currencies = unique(dated.map((row) => row.currency));
  const merchants = unique(dated.map((row) => normalizeMerchant(row.merchant)));
  if (cadences.length !== 1 || cadences[0] === "IRREGULAR") {
    return { nextDebitDate: null, stable: false, cadence: cadences[0] ?? null, inputsHash, reason: "IRREGULAR" };
  }
  if (amounts.length !== 1 || currencies.length !== 1 || merchants.length !== 1) {
    return { nextDebitDate: null, stable: false, cadence: cadences[0], inputsHash, reason: "CONFLICTING_DATES" };
  }

  const cadence = cadences[0]!;
  const dates = unique(dated.map((row) => row.evidenceDate));
  const anchorDay = Number(dates[0]!.slice(8, 10));
  if (dates.length >= 2) {
    for (let index = 1; index < dates.length; index += 1) {
      const expected = addCadence(dates[index - 1]!, cadence, anchorDay);
      if (expected !== dates[index]) {
        return { nextDebitDate: null, stable: false, cadence, inputsHash, reason: "CONFLICTING_DATES" };
      }
    }
  }

  const lastOccurrence = dates.at(-1)!;
  const citedNext = unique(
    dated
      .filter((row) => row.evidenceDate === lastOccurrence)
      .map((row) => row.citedNextExpectedDate)
      .filter((value): value is string => Boolean(value)),
  );
  const explicitRenewal = dated.some((row) => row.explicitProviderRenewal);
  if (!citedNext.length) {
    return {
      nextDebitDate: null,
      stable: false,
      cadence,
      inputsHash,
      reason: dates.length < 2 ? "INSUFFICIENT_OCCURRENCES" : "MISSING_NEXT",
    };
  }
  if (citedNext.length !== 1) {
    return { nextDebitDate: null, stable: false, cadence, inputsHash, reason: "CONFLICTING_DATES" };
  }

  const expectedNext = addCadence(lastOccurrence, cadence, anchorDay);
  const cited = citedNext[0]!;
  if (cited !== expectedNext) {
    return { nextDebitDate: null, stable: false, cadence, inputsHash, reason: "CONFLICTING_DATES" };
  }
  if (dates.length < 2 && !explicitRenewal) {
    return { nextDebitDate: null, stable: false, cadence, inputsHash, reason: "INSUFFICIENT_OCCURRENCES" };
  }
  return {
    nextDebitDate: cited,
    stable: true,
    cadence,
    inputsHash,
    reason: dates.length < 2 ? "CITED_RENEWAL" : "STABLE_CADENCE",
  };
}

export function addCadence(isoDate: string, cadence: Cadence, anchorDay = Number(isoDate.slice(8, 10))): string {
  switch (cadence) {
    case "WEEKLY":
      return addDays(isoDate, 7);
    case "BIWEEKLY":
      return addDays(isoDate, 14);
    case "SEMIMONTHLY":
      return addDays(isoDate, 15);
    case "MONTHLY":
      return addMonthsClamped(isoDate, 1, anchorDay);
    case "BIMONTHLY":
      return addMonthsClamped(isoDate, 2, anchorDay);
    case "QUARTERLY":
      return addMonthsClamped(isoDate, 3, anchorDay);
    case "YEARLY":
      return addMonthsClamped(isoDate, 12, anchorDay);
    case "IRREGULAR":
      return isoDate;
  }
}

function hashDerivationInputs(occurrences: readonly RecurrenceOccurrence[], correctionInvalidates: boolean) {
  const canonical = occurrences.map((row) => [
    row.evidenceDate,
    row.amountMinor.toString(),
    row.currency,
    normalizeMerchant(row.merchant),
    row.cadence ?? "",
    row.citedNextExpectedDate ?? "",
    row.explicitProviderRenewal ? "1" : "0",
  ].join(":")).sort().join("|");
  return createHash("sha256").update(`${correctionInvalidates ? "1" : "0"}|${canonical}`).digest("hex");
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function normalizeMerchant(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function addDays(isoDate: string, days: number) {
  const utc = Date.parse(`${isoDate}T00:00:00.000Z`);
  return new Date(utc + days * 86_400_000).toISOString().slice(0, 10);
}

function addMonthsClamped(isoDate: string, months: number, anchorDay: number) {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const total = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(total / 12);
  const nextMonth = total % 12;
  const lastDay = daysInMonth(nextYear, nextMonth + 1);
  const day = Math.min(anchorDay, lastDay);
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
