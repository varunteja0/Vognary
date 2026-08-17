import type { Cadence } from "@/lib/recovery/contracts";
import type { CommitmentCoverage } from "@/lib/recovery/source-liveness";

/**
 * The absence engine.
 *
 * "We did not see a charge" is only information when something was definitely
 * watching. This module turns an expectation plus real observations plus honest
 * coverage into one of five results, and refuses to conclude anything when the
 * window is still open, when there was never an expectation, or when the sources
 * that would have carried the charge are not trustworthy.
 *
 * Absence is never cancellation. That inference belongs to the cancellation
 * lifecycle, and even there it never claims settlement proof.
 */
export const absenceOutcomes = [
  "ARRIVED_AS_EXPECTED",
  "ARRIVED_LATE",
  "AMOUNT_CHANGED",
  "NOT_OBSERVED",
  "CANNOT_EVALUATE_COVERAGE_BROKEN",
] as const;
export type AbsenceOutcome = (typeof absenceOutcomes)[number];

/** How long after the expected day a charge may still be considered this cycle's. */
export const absenceGraceDays: Record<Cadence, number | null> = {
  WEEKLY: 3,
  BIWEEKLY: 4,
  SEMIMONTHLY: 4,
  MONTHLY: 5,
  BIMONTHLY: 7,
  QUARTERLY: 10,
  YEARLY: 14,
  IRREGULAR: null,
};

/** Card networks routinely post a subscription a day before the billing date. */
export const absenceEarlyDays = 1;

const dayMs = 24 * 60 * 60 * 1_000;

export type ChargeObservation = {
  evidenceId: string;
  date: string;
  amountMinor: bigint;
  currency: string;
};

export type ChargeWindow = { start: string; end: string };

export type ExpectedChargeInput = {
  evaluatedOn: string;
  expectedDate: string | null;
  cadence: Cadence;
  currency: string;
  expectedAmountMinor: bigint;
  coverage: CommitmentCoverage;
  observations: readonly ChargeObservation[];
  cancellationClaimed: boolean;
};

type EvaluationBase = {
  reasons: readonly string[];
  citedEvidenceIds: readonly string[];
};

export type ExpectedChargeEvaluation =
  | (EvaluationBase & { status: "NOT_APPLICABLE"; window: null })
  | (EvaluationBase & { status: "PENDING_WINDOW"; window: ChargeWindow })
  | (EvaluationBase & {
      status: "EVALUATED";
      outcome: AbsenceOutcome;
      window: ChargeWindow;
      observedDate: string | null;
      observedAmountMinor: bigint | null;
      deltaMinor: bigint | null;
      deltaBasisPoints: number | null;
      lateByDays: number | null;
    });

function parseDate(value: string) {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function shiftDate(value: string, days: number) {
  const parsed = parseDate(value);
  if (parsed === null) return null;
  return new Date(parsed + days * dayMs).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  const start = parseDate(from);
  const end = parseDate(to);
  if (start === null || end === null) return null;
  return Math.round((end - start) / dayMs);
}

function basisPoints(delta: bigint, expected: bigint) {
  if (expected === BigInt(0)) return null;
  const scaled = (delta < BigInt(0) ? -delta : delta) * BigInt(100_000) / expected;
  const rounded = (scaled + BigInt(5)) / BigInt(10);
  return Number(rounded);
}

export function evaluateExpectedCharge(input: ExpectedChargeInput): ExpectedChargeEvaluation {
  const grace = absenceGraceDays[input.cadence];
  if (!input.expectedDate || grace === null) {
    return {
      status: "NOT_APPLICABLE",
      window: null,
      citedEvidenceIds: [],
      reasons: ["We do not have a settled billing rhythm for this subscription yet, so there is nothing to expect."],
    };
  }
  const start = shiftDate(input.expectedDate, -absenceEarlyDays);
  const end = shiftDate(input.expectedDate, grace);
  if (!start || !end) {
    return {
      status: "NOT_APPLICABLE",
      window: null,
      citedEvidenceIds: [],
      reasons: ["The expected billing date could not be read."],
    };
  }
  const window: ChargeWindow = { start, end };
  const currency = input.currency.trim().toUpperCase();

  const matched = input.observations
    .filter((observation) => observation.currency.trim().toUpperCase() === currency)
    .filter((observation) => observation.date >= window.start && observation.date <= window.end)
    .map((observation) => ({
      observation,
      distance: Math.abs(daysBetween(input.expectedDate!, observation.date) ?? Number.MAX_SAFE_INTEGER),
    }))
    .sort((left, right) => left.distance - right.distance || left.observation.evidenceId.localeCompare(right.observation.evidenceId))
    .at(0)?.observation ?? null;

  if (matched) {
    const lateBy = Math.max(0, daysBetween(input.expectedDate, matched.date) ?? 0);
    const delta = matched.amountMinor - input.expectedAmountMinor;
    const changed = delta !== BigInt(0);
    const outcome: AbsenceOutcome = changed ? "AMOUNT_CHANGED" : lateBy > 0 ? "ARRIVED_LATE" : "ARRIVED_AS_EXPECTED";
    const reasons = [
      changed
        ? "The charge arrived, but not for the amount we were expecting."
        : lateBy > 0
          ? "The charge arrived, a little later than expected."
          : "The charge arrived when and for what we expected.",
    ];
    if (changed && lateBy > 0) reasons.push(`It also arrived ${lateBy} day${lateBy === 1 ? "" : "s"} later than expected.`);
    return {
      status: "EVALUATED",
      outcome,
      window,
      observedDate: matched.date,
      observedAmountMinor: matched.amountMinor,
      deltaMinor: changed ? delta : null,
      deltaBasisPoints: changed ? basisPoints(delta, input.expectedAmountMinor) : null,
      lateByDays: lateBy,
      citedEvidenceIds: [matched.evidenceId],
      reasons,
    };
  }

  if (input.evaluatedOn <= window.end) {
    return {
      status: "PENDING_WINDOW",
      window,
      citedEvidenceIds: [],
      reasons: ["We are still inside the period when this charge would normally appear."],
    };
  }

  if (!input.coverage.trustworthy) {
    return {
      status: "EVALUATED",
      outcome: "CANNOT_EVALUATE_COVERAGE_BROKEN",
      window,
      observedDate: null,
      observedAmountMinor: null,
      deltaMinor: null,
      deltaBasisPoints: null,
      lateByDays: null,
      citedEvidenceIds: [],
      reasons: [
        "We cannot say whether this charge happened, because the sources that would have shown it were not watching reliably.",
        ...input.coverage.limitations,
      ],
    };
  }

  const reasons = ["Nothing arrived for this subscription in the period we were watching."];
  if (input.cancellationClaimed) {
    reasons.push("A cancellation was reported for this subscription, but a quiet month is not proof that it stopped.");
  } else {
    reasons.push("This is not proof the subscription ended; a delayed charge looks the same at this point.");
  }
  return {
    status: "EVALUATED",
    outcome: "NOT_OBSERVED",
    window,
    observedDate: null,
    observedAmountMinor: null,
    deltaMinor: null,
    deltaBasisPoints: null,
    lateByDays: null,
    citedEvidenceIds: [],
    reasons,
  };
}
