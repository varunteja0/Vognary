import { formatCalendarDate, parseIsoDateOnly } from "../date-only";
import { advanceDateByFrequency, type Frequency } from "../recurring-audit";
import { addMinorUnits, normalizeCurrency, parsePositiveMinorUnits } from "./money";

const thirteenWeekDays = 13 * 7;
const annualDays = 365;
const maxAnnualOccurrences = 60;

export const proposalCadences = [
  "ONE_TIME",
  "WEEKLY",
  "BIWEEKLY",
  "SEMIMONTHLY",
  "MONTHLY",
  "BIMONTHLY",
  "QUARTERLY",
  "YEARLY",
] as const;

export type ProposalCadence = typeof proposalCadences[number];

export type ProposedCommitment = {
  proposalId: string;
  amountMinor: string;
  currency: string;
  firstChargeDate: string;
  cadence: ProposalCadence;
};

export type ProposalExposureProjection = {
  asOfDate: string;
  thirteenWeekEndExclusive: string;
  annualEndExclusive: string;
  proposals: Array<{
    proposalId: string;
    basis: "USER_ENTERED_ASSUMPTION";
    amountMinor: string;
    currency: string;
    firstChargeDate: string;
    cadence: ProposalCadence;
    thirteenWeekMinor: string;
    annualMinor: string;
    occurrences: Array<{ date: string; amountMinor: string }>;
  }>;
  totalsByCurrency: Array<{
    currency: string;
    thirteenWeekMinor: string;
    annualMinor: string;
  }>;
};

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

const frequencyByCadence: Record<Exclude<ProposalCadence, "ONE_TIME">, Frequency> = {
  WEEKLY: "weekly",
  BIWEEKLY: "biweekly",
  SEMIMONTHLY: "semimonthly",
  MONTHLY: "monthly",
  BIMONTHLY: "bimonthly",
  QUARTERLY: "quarterly",
  YEARLY: "yearly",
};

export function projectProposalExposure(
  proposals: readonly ProposedCommitment[],
  options: { asOfDate: string },
): ProposalExposureProjection {
  const asOf = requireCalendarDate(options.asOfDate, "Projection date");
  const thirteenWeekEnd = addCalendarDays(asOf, thirteenWeekDays);
  const annualEnd = addCalendarDays(asOf, annualDays);
  const seenProposalIds = new Set<string>();
  const totals = new Map<string, { thirteenWeekMinor: bigint; annualMinor: bigint }>();

  const projected = proposals.map((proposal) => {
    const proposalId = proposal.proposalId.trim();
    if (!proposalId) throw new Error("Proposal id is required.");
    if (seenProposalIds.has(proposalId)) throw new Error("Proposal ids must be unique within one projection.");
    seenProposalIds.add(proposalId);

    const amountMinor = requirePositiveMinorUnits(proposal.amountMinor);
    const currency = normalizeCurrency(proposal.currency);
    const cadence = normalizeCadence(proposal.cadence);
    const firstCharge = requireCalendarDate(proposal.firstChargeDate, "First charge date");
    if (firstCharge < asOf) throw new Error("First charge date cannot be before the projection date.");

    const occurrences: Array<{ date: string; amountMinor: string }> = [];
    let thirteenWeekMinor = BigInt(0);
    let annualMinor = BigInt(0);
    let occurrence = firstCharge;
    const anchorDay = firstCharge.getDate();

    for (let count = 0; occurrence < annualEnd && count < maxAnnualOccurrences; count += 1) {
      const date = formatCalendarDate(occurrence);
      occurrences.push({ date, amountMinor: amountMinor.toString() });
      annualMinor = addMinorUnits(annualMinor, amountMinor, "Projected money");
      if (occurrence < thirteenWeekEnd) thirteenWeekMinor = addMinorUnits(thirteenWeekMinor, amountMinor, "Projected money");

      if (cadence === "ONE_TIME") break;
      const next = advanceDateByFrequency(occurrence, frequencyByCadence[cadence], 30.44, anchorDay);
      if (next <= occurrence) throw new Error("Proposal cadence did not advance to a later calendar date.");
      occurrence = next;
    }

    if (occurrence < annualEnd && cadence !== "ONE_TIME") {
      throw new Error("Proposal cadence exceeds the bounded annual occurrence limit.");
    }

    const currencyTotals = totals.get(currency) ?? { thirteenWeekMinor: BigInt(0), annualMinor: BigInt(0) };
    totals.set(currency, {
      thirteenWeekMinor: addMinorUnits(currencyTotals.thirteenWeekMinor, thirteenWeekMinor, "Projected money"),
      annualMinor: addMinorUnits(currencyTotals.annualMinor, annualMinor, "Projected money"),
    });

    return {
      proposalId,
      basis: "USER_ENTERED_ASSUMPTION" as const,
      amountMinor: amountMinor.toString(),
      currency,
      firstChargeDate: formatCalendarDate(firstCharge),
      cadence,
      thirteenWeekMinor: thirteenWeekMinor.toString(),
      annualMinor: annualMinor.toString(),
      occurrences,
    };
  });

  return {
    asOfDate: formatCalendarDate(asOf),
    thirteenWeekEndExclusive: formatCalendarDate(thirteenWeekEnd),
    annualEndExclusive: formatCalendarDate(annualEnd),
    proposals: projected,
    totalsByCurrency: [...totals.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, amounts]) => ({
        currency,
        thirteenWeekMinor: amounts.thirteenWeekMinor.toString(),
        annualMinor: amounts.annualMinor.toString(),
      })),
  };
}

function requirePositiveMinorUnits(value: unknown): bigint {
  return parsePositiveMinorUnits(value, "Proposal money");
}

function normalizeCadence(value: unknown): ProposalCadence {
  if (typeof value !== "string" || !proposalCadences.includes(value as ProposalCadence)) {
    throw new Error("Proposal cadence is not supported.");
  }
  return value as ProposalCadence;
}

function requireCalendarDate(value: unknown, label: string): Date {
  if (typeof value !== "string") throw new Error(`${label} must be an ISO calendar date.`);
  const date = parseIsoDateOnly(value);
  if (!date) throw new Error(`${label} must be a valid ISO calendar date.`);
  return date;
}

function addCalendarDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}
