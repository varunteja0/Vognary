import { evaluateExpectedCharge, type ChargeObservation, type ChargeWindow, type ExpectedChargeEvaluation } from "@/lib/recovery/absence";
import type { CancellationOutcomeState } from "@/lib/recovery/cancellation-outcome";
import type { Cadence } from "@/lib/recovery/contracts";
import type { CommitmentCoverage, SourceLivenessState } from "@/lib/recovery/source-liveness";

/**
 * The living commitment state.
 *
 * A commitment must be able to answer five questions at any moment: what do we
 * believe, why, when was it last verified, what do we expect next, and what
 * would prove it wrong. This module composes coverage, absence and the
 * cancellation lifecycle into that answer. It does not detect commitments, and
 * it does not re-derive cadence: recorded cadence assertions are read back, not
 * recomputed.
 */
export const commitmentLifecycleStates = [
  "OBSERVED",
  "ESTABLISHED",
  "CHANGED",
  "AT_RISK",
  "ENDING",
  "LIKELY_ENDED",
  "ENDED",
  "UNVERIFIABLE",
] as const;
export type CommitmentLifecycleState = (typeof commitmentLifecycleStates)[number];

export const commitmentConflictStates = [
  "NONE",
  "IDENTITY_CONFLICT",
  "CANCELLATION_NOT_EFFECTIVE",
] as const;
export type CommitmentConflictState = (typeof commitmentConflictStates)[number];

export const commitmentPredictionStates = [
  "PREDICTED",
  "WITHHELD_UNKNOWN_RHYTHM",
  "WITHHELD_INSUFFICIENT_EVIDENCE",
  "WITHHELD_COVERAGE_NOT_TRUSTWORTHY",
  "WITHHELD_ENDED",
] as const;
export type CommitmentPredictionState = (typeof commitmentPredictionStates)[number];

export type PricePoint = {
  fromDate: string;
  amountMinor: bigint;
  currency: string;
  evidenceIds: readonly string[];
};

export type CadenceAssertion = {
  at: string;
  cadence: Cadence;
  evidenceIds: readonly string[];
};

export type CommitmentBeliefInput = {
  commitmentId: string;
  merchant: string;
  currency: string;
  amountMinor: bigint;
  cadence: Cadence;
  nextExpectedDate: string | null;
  evaluatedOn: string;
  coverage: CommitmentCoverage;
  observations: readonly ChargeObservation[];
  /** Cadence as it was recorded over time. Never recomputed here. */
  cadenceAssertions: readonly CadenceAssertion[];
  cancellationState: CancellationOutcomeState;
  identityConflict?: boolean;
};

export type CommitmentBelief = {
  commitmentId: string;
  lifecycleState: CommitmentLifecycleState;
  belief: string;
  because: readonly string[];
  citedEvidenceIds: readonly string[];
  lastVerifiedAt: string | null;
  nextVerificationDueAt: string | null;
  expectedChargeWindow: ChargeWindow | null;
  coverageState: SourceLivenessState;
  /** The sources whose coverage this belief rests on. A covered absence cites these. */
  coverageSourceIds: readonly string[];
  priceHistory: readonly PricePoint[];
  cadenceHistory: readonly CadenceAssertion[];
  conflictState: CommitmentConflictState;
  cancellationState: CancellationOutcomeState;
  predictionState: CommitmentPredictionState;
  falsifiability: readonly string[];
  chargeEvaluation: ExpectedChargeEvaluation;
};

const endingStates = new Set<CancellationOutcomeState>([
  "CANCELLATION_INTENT_RECORDED",
  "CANCELLATION_CLAIMED",
  "WAITING_FOR_EXPECTED_WINDOW",
  "CHARGED_AGAIN",
]);

function buildPriceHistory(observations: readonly ChargeObservation[], currency: string): PricePoint[] {
  const ordered = observations
    .filter((observation) => observation.currency.trim().toUpperCase() === currency)
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date) || left.evidenceId.localeCompare(right.evidenceId));
  const history: PricePoint[] = [];
  for (const observation of ordered) {
    const last = history.at(-1);
    if (last && last.amountMinor === observation.amountMinor) {
      history[history.length - 1] = { ...last, evidenceIds: [...last.evidenceIds, observation.evidenceId] };
      continue;
    }
    history.push({
      fromDate: observation.date,
      amountMinor: observation.amountMinor,
      currency,
      evidenceIds: [observation.evidenceId],
    });
  }
  return history;
}

function buildCadenceHistory(assertions: readonly CadenceAssertion[]): CadenceAssertion[] {
  const byKey = new Map<string, CadenceAssertion>();
  for (const assertion of assertions) {
    const key = `${assertion.at}:${assertion.cadence}`;
    const existing = byKey.get(key);
    byKey.set(key, {
      at: assertion.at,
      cadence: assertion.cadence,
      evidenceIds: [...new Set([...(existing?.evidenceIds ?? []), ...assertion.evidenceIds])].sort(),
    });
  }
  return [...byKey.values()].sort((left, right) => left.at.localeCompare(right.at) || left.cadence.localeCompare(right.cadence));
}

export function buildCommitmentBelief(input: CommitmentBeliefInput): CommitmentBelief {
  const currency = input.currency.trim().toUpperCase();
  const evaluation = evaluateExpectedCharge({
    evaluatedOn: input.evaluatedOn,
    expectedDate: input.nextExpectedDate,
    cadence: input.cadence,
    currency,
    expectedAmountMinor: input.amountMinor,
    coverage: input.coverage,
    observations: input.observations,
    cancellationClaimed: input.cancellationState !== "NONE",
  });

  const priceHistory = buildPriceHistory(input.observations, currency);
  const cadenceHistory = buildCadenceHistory(input.cadenceAssertions);
  const lastVerifiedAt = priceHistory.length
    ? input.observations
      .filter((observation) => observation.currency.trim().toUpperCase() === currency)
      .map((observation) => observation.date)
      .sort()
      .at(-1) ?? null
    : null;
  const lastObservation = input.observations
    .filter((observation) => observation.currency.trim().toUpperCase() === currency)
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date) || left.evidenceId.localeCompare(right.evidenceId))
    .at(-1) ?? null;

  const conflictState: CommitmentConflictState = input.identityConflict
    ? "IDENTITY_CONFLICT"
    : input.cancellationState === "CHARGED_AGAIN"
      ? "CANCELLATION_NOT_EFFECTIVE"
      : "NONE";

  const priceChanged = priceHistory.length > 1;
  const evaluated = evaluation.status === "EVALUATED" ? evaluation.outcome : null;

  const lifecycleState: CommitmentLifecycleState =
    input.cancellationState === "CONFIRMED_BY_SETTLEMENT" ? "ENDED"
      : input.cancellationState === "LIKELY_STOPPED_BY_COVERED_ABSENCE" ? "LIKELY_ENDED"
        : input.cancellationState === "CANNOT_VERIFY" ? "UNVERIFIABLE"
          : endingStates.has(input.cancellationState) ? "ENDING"
            : evaluated === "CANNOT_EVALUATE_COVERAGE_BROKEN" ? "UNVERIFIABLE"
              : evaluated === "NOT_OBSERVED" ? "AT_RISK"
                : evaluated === "AMOUNT_CHANGED" || priceChanged ? "CHANGED"
                  : input.observations.length >= 2 && input.cadence !== "IRREGULAR" ? "ESTABLISHED"
                    : "OBSERVED";

  const predictionState: CommitmentPredictionState =
    lifecycleState === "ENDED" || lifecycleState === "LIKELY_ENDED" ? "WITHHELD_ENDED"
      : input.cadence === "IRREGULAR" || !input.nextExpectedDate ? "WITHHELD_UNKNOWN_RHYTHM"
        : lifecycleState === "UNVERIFIABLE" ? "WITHHELD_COVERAGE_NOT_TRUSTWORTHY"
          : input.observations.length < 2 ? "WITHHELD_INSUFFICIENT_EVIDENCE"
            : "PREDICTED";

  const window = evaluation.window;
  const nextVerificationDueAt = window?.end ?? null;

  const belief = beliefSentence(lifecycleState, input.merchant);
  const because = [...evaluation.reasons];
  if (priceChanged) {
    because.unshift("The amount charged for this subscription has changed since we started watching.");
  }
  if (conflictState === "CANCELLATION_NOT_EFFECTIVE") {
    because.unshift("You were charged again after telling us this was cancelled.");
  }
  if (conflictState === "IDENTITY_CONFLICT") {
    because.unshift("Two receipts point at businesses we cannot safely treat as the same, so we kept them apart.");
  }
  if (!input.coverage.trustworthy) because.push(...input.coverage.limitations);

  return {
    commitmentId: input.commitmentId,
    lifecycleState,
    belief,
    because,
    citedEvidenceIds: evaluation.citedEvidenceIds.length
      ? [...evaluation.citedEvidenceIds]
      : lastObservation ? [lastObservation.evidenceId] : [],
    lastVerifiedAt,
    nextVerificationDueAt,
    expectedChargeWindow: window,
    coverageState: input.coverage.state,
    coverageSourceIds: [...input.coverage.citedSourceIds],
    priceHistory,
    cadenceHistory,
    conflictState,
    cancellationState: input.cancellationState,
    predictionState,
    falsifiability: falsifiabilityFor(lifecycleState, window, input),
    chargeEvaluation: evaluation,
  };
}

function beliefSentence(state: CommitmentLifecycleState, merchant: string) {
  switch (state) {
    case "OBSERVED": return `We have seen ${merchant} bill you, but not often enough to know its rhythm.`;
    case "ESTABLISHED": return `${merchant} is billing you on a steady rhythm.`;
    case "CHANGED": return `${merchant} is still billing you, but something about it changed.`;
    case "AT_RISK": return `${merchant} did not bill you when we expected it to.`;
    case "ENDING": return `You are in the middle of ending ${merchant}.`;
    case "LIKELY_ENDED": return `${merchant} looks like it has stopped billing you.`;
    case "ENDED": return `${merchant} has stopped billing you.`;
    case "UNVERIFIABLE": return `We cannot tell you where ${merchant} stands right now.`;
  }
}

function falsifiabilityFor(
  state: CommitmentLifecycleState,
  window: ChargeWindow | null,
  input: CommitmentBeliefInput,
): string[] {
  const claims: string[] = [];
  if (window) {
    claims.push(`A charge from ${input.merchant} after ${window.end} for a different amount would change this.`);
    claims.push(`No charge from ${input.merchant} by ${window.end} would mean this may have stopped.`);
  } else {
    claims.push(`A second charge from ${input.merchant} would let us work out its rhythm.`);
  }
  if (state === "LIKELY_ENDED" || state === "ENDED") {
    claims.push(`Any new charge from ${input.merchant} would show this did not actually stop.`);
  }
  if (state === "UNVERIFIABLE") {
    claims.push("Reconnecting the source that stopped working would let us answer this again.");
  }
  if (input.observations.length) {
    claims.push("Telling us any of these receipts is wrong would change what we believe.");
  }
  return claims;
}
