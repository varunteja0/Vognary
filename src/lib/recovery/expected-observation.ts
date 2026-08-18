import type { ExpectedChargeEvaluation } from "@/lib/recovery/absence";
import type {
  Cadence,
  CommitmentMemoryPointDto,
  ExpectedVsObservedDto,
  SourceType,
} from "@/lib/recovery/contracts";
import { toMoneyDto } from "@/lib/recovery/domain";

/**
 * Customer-facing expected-vs-observed presentation.
 *
 * Absence is never cancellation. A missing charge with weak coverage cannot
 * become a settled financial claim. This module only translates an already
 * evaluated window into honest copy and DTO fields.
 */

export { expectedVsObservedStatuses, type ExpectedVsObservedStatus, type ExpectedVsObservedDto, type CommitmentMemoryPointDto } from "@/lib/recovery/contracts";

export function presentExpectedVsObserved(input: {
  evaluation: ExpectedChargeEvaluation;
  expectedDate: string | null;
  expectedAmountMinor: bigint;
  currency: string;
  cadence: Cadence;
}): ExpectedVsObservedDto {
  const expectedAmount = input.expectedDate && input.cadence !== "IRREGULAR"
    ? toMoneyDto(input.expectedAmountMinor, input.currency)
    : null;
  const reasons = [...input.evaluation.reasons];

  if (input.evaluation.status === "NOT_APPLICABLE") {
    return {
      status: "INSUFFICIENT_HISTORY",
      expectedDate: input.expectedDate,
      expectedAmount,
      observedDate: null,
      observedAmount: null,
      windowStart: null,
      windowEnd: null,
      summary: "There is not enough settled rhythm yet to compare an expected charge with what arrived.",
      reasons,
    };
  }

  if (input.evaluation.status === "PENDING_WINDOW") {
    return {
      status: "NOT_YET_OBSERVED",
      expectedDate: input.expectedDate,
      expectedAmount,
      observedDate: null,
      observedAmount: null,
      windowStart: input.evaluation.window.start,
      windowEnd: input.evaluation.window.end,
      summary: "The expected window is still open. Missing evidence here is not a cancellation.",
      reasons,
    };
  }

  const window = input.evaluation.window;
  const observedAmount = input.evaluation.observedAmountMinor !== null
    ? toMoneyDto(input.evaluation.observedAmountMinor, input.currency)
    : null;

  if (input.evaluation.outcome === "ARRIVED_AS_EXPECTED") {
    return {
      status: "MATCHED",
      expectedDate: input.expectedDate,
      expectedAmount,
      observedDate: input.evaluation.observedDate,
      observedAmount,
      windowStart: window.start,
      windowEnd: window.end,
      summary: "The observed charge matched the expected amount in the expected window.",
      reasons,
    };
  }

  if (input.evaluation.outcome === "ARRIVED_LATE") {
    return {
      status: "ARRIVED_LATE",
      expectedDate: input.expectedDate,
      expectedAmount,
      observedDate: input.evaluation.observedDate,
      observedAmount,
      windowStart: window.start,
      windowEnd: window.end,
      summary: "A matching amount arrived, later than the expected date, still inside the allowed window.",
      reasons,
    };
  }

  if (input.evaluation.outcome === "AMOUNT_CHANGED") {
    return {
      status: "AMOUNT_CHANGED",
      expectedDate: input.expectedDate,
      expectedAmount,
      observedDate: input.evaluation.observedDate,
      observedAmount,
      windowStart: window.start,
      windowEnd: window.end,
      summary: "A charge arrived in the expected window, but not for the expected amount.",
      reasons,
    };
  }

  if (input.evaluation.outcome === "NOT_OBSERVED") {
    return {
      status: "NOT_YET_OBSERVED",
      expectedDate: input.expectedDate,
      expectedAmount,
      observedDate: null,
      observedAmount: null,
      windowStart: window.start,
      windowEnd: window.end,
      summary: "No supporting evidence has been seen in the expected window yet. That is not proof of cancellation.",
      reasons,
    };
  }

  return {
    status: "CANNOT_EVALUATE",
    expectedDate: input.expectedDate,
    expectedAmount,
    observedDate: null,
    observedAmount: null,
    windowStart: window.start,
    windowEnd: window.end,
    summary: "The sources that would have shown this charge were not watching reliably, so Vognary will not guess.",
    reasons,
  };
}

export function presentCommitmentMemory(
  observations: readonly {
    date: string;
    amountMinor: bigint;
    currency: string;
    sourceType: SourceType;
    evidenceId: string;
  }[],
): readonly CommitmentMemoryPointDto[] {
  return observations
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date) || left.evidenceId.localeCompare(right.evidenceId))
    .slice(0, 24)
    .map((observation) => ({
      date: observation.date,
      amount: toMoneyDto(observation.amountMinor, observation.currency),
      sourceType: observation.sourceType,
      evidenceId: observation.evidenceId,
    }));
}

export const emptyExpectation: ExpectedVsObservedDto = {
  status: "INSUFFICIENT_HISTORY",
  expectedDate: null,
  expectedAmount: null,
  observedDate: null,
  observedAmount: null,
  windowStart: null,
  windowEnd: null,
  summary: "There is not enough settled rhythm yet to compare an expected charge with what arrived.",
  reasons: [],
};
