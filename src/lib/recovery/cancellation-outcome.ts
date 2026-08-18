import type { ChargeWindow, ExpectedChargeEvaluation } from "@/lib/recovery/absence";

/**
 * Cancellation outcome lifecycle.
 *
 * The only thing this system can honestly observe today is email evidence, so
 * the strongest conclusion it may reach is that a charge we were reliably
 * watching for did not arrive. `CONFIRMED_BY_SETTLEMENT` is reserved for a
 * future regulated money feed and is deliberately unreachable: no event defined
 * here can produce it.
 */
export const cancellationOutcomeStates = [
  "NONE",
  "CANCELLATION_INTENT_RECORDED",
  "CANCELLATION_CLAIMED",
  "WAITING_FOR_EXPECTED_WINDOW",
  "LIKELY_STOPPED_BY_COVERED_ABSENCE",
  "CHARGED_AGAIN",
  "CANNOT_VERIFY",
  "CONFIRMED_BY_SETTLEMENT",
] as const;
export type CancellationOutcomeState = (typeof cancellationOutcomeStates)[number];

export const cancellationProofStrengths = ["NONE", "COVERED_ABSENCE", "SETTLEMENT"] as const;
export type CancellationProofStrength = (typeof cancellationProofStrengths)[number];

export type CancellationEvent =
  | { kind: "INTENT_RECORDED"; at: string }
  | {
      kind: "CANCELLATION_CLAIMED";
      at: string;
      claimSource: "USER_REPORTED" | "MERCHANT_CONFIRMATION_RECEIPT";
      evidenceIds: readonly string[];
    }
  | { kind: "WINDOW_OPENED"; at: string; window: ChargeWindow }
  | { kind: "CHARGE_EVALUATED"; at: string; evaluation: ExpectedChargeEvaluation }
  /** Reserved for a regulated money feed that does not exist yet. Always refused. */
  | { kind: "SETTLEMENT_CONFIRMED"; at: string; sourceKind: string; evidenceIds: readonly string[] };

export type CancellationTransition = {
  accepted: boolean;
  previousState: CancellationOutcomeState;
  state: CancellationOutcomeState;
  proof: CancellationProofStrength;
  reasons: readonly string[];
  citedEvidenceIds: readonly string[];
};

/** Only a real settlement feed counts as settled. A quiet month never does. */
export function isCancellationSettled(state: CancellationOutcomeState) {
  return state === "CONFIRMED_BY_SETTLEMENT";
}

const awaitingOutcome = new Set<CancellationOutcomeState>([
  "CANCELLATION_CLAIMED",
  "WAITING_FOR_EXPECTED_WINDOW",
  "LIKELY_STOPPED_BY_COVERED_ABSENCE",
  "CHARGED_AGAIN",
  "CANNOT_VERIFY",
]);

function refuse(current: CancellationOutcomeState, reason: string): CancellationTransition {
  return {
    accepted: false,
    previousState: current,
    state: current,
    proof: proofFor(current),
    reasons: [reason],
    citedEvidenceIds: [],
  };
}

function proofFor(state: CancellationOutcomeState): CancellationProofStrength {
  if (state === "CONFIRMED_BY_SETTLEMENT") return "SETTLEMENT";
  if (state === "LIKELY_STOPPED_BY_COVERED_ABSENCE") return "COVERED_ABSENCE";
  return "NONE";
}

export function advanceCancellationOutcome(input: {
  current: CancellationOutcomeState;
  event: CancellationEvent;
}): CancellationTransition {
  const { current, event } = input;

  if (event.kind === "SETTLEMENT_CONFIRMED") {
    return refuse(current, "Settlement confirmation needs a regulated money feed, which this account does not have.");
  }

  if (current === "CONFIRMED_BY_SETTLEMENT") {
    return refuse(current, "This cancellation is already settled and cannot be reopened by email evidence.");
  }

  switch (event.kind) {
    case "INTENT_RECORDED":
      return {
        accepted: true,
        previousState: current,
        state: "CANCELLATION_INTENT_RECORDED",
        proof: "NONE",
        reasons: ["You told us you want to end this commitment."],
        citedEvidenceIds: [],
      };

    case "CANCELLATION_CLAIMED": {
      if (current !== "CANCELLATION_INTENT_RECORDED" && current !== "CANCELLATION_CLAIMED") {
        return refuse(current, "Record that you want to cancel before recording that it was done.");
      }
      return {
        accepted: true,
        previousState: current,
        state: "CANCELLATION_CLAIMED",
        proof: "NONE",
        reasons: [
          event.claimSource === "MERCHANT_CONFIRMATION_RECEIPT"
            ? "We have the cancellation message, which is a claim we still need to watch."
            : "You told us the cancellation went through. We will watch the next billing date.",
        ],
        citedEvidenceIds: [...new Set(event.evidenceIds)].sort(),
      };
    }

    case "WINDOW_OPENED": {
      if (current !== "CANCELLATION_CLAIMED") {
        return refuse(current, "There is no cancellation claim to watch yet.");
      }
      return {
        accepted: true,
        previousState: current,
        state: "WAITING_FOR_EXPECTED_WINDOW",
        proof: "NONE",
        reasons: [`We are watching ${event.window.start} to ${event.window.end}, when the next charge would normally appear.`],
        citedEvidenceIds: [],
      };
    }

    case "CHARGE_EVALUATED": {
      if (!awaitingOutcome.has(current)) {
        return refuse(current, "There is no cancellation claim to check against this billing period.");
      }
      const { evaluation } = event;
      if (evaluation.status !== "EVALUATED") {
        return refuse(current, "That billing period has not finished, so it cannot decide anything yet.");
      }
      switch (evaluation.outcome) {
        case "ARRIVED_AS_EXPECTED":
        case "ARRIVED_LATE":
        case "AMOUNT_CHANGED":
          return {
            accepted: true,
            previousState: current,
            state: "CHARGED_AGAIN",
            proof: "NONE",
            reasons: ["You were charged again after the cancellation, so it did not take effect."],
            citedEvidenceIds: [...evaluation.citedEvidenceIds],
          };
        case "NOT_OBSERVED":
          return {
            accepted: true,
            previousState: current,
            state: "LIKELY_STOPPED_BY_COVERED_ABSENCE",
            proof: "COVERED_ABSENCE",
            reasons: [
              "No charge arrived in the period we were watching, which is the strongest sign we can give you from receipts alone.",
              "Please still check your bank statement, because we do not see your account directly.",
            ],
            citedEvidenceIds: [],
          };
        case "CANNOT_EVALUATE_COVERAGE_BROKEN":
          return {
            accepted: true,
            previousState: current,
            state: "CANNOT_VERIFY",
            proof: "NONE",
            reasons: [
              "We cannot tell whether this stopped, because the sources that would have shown a charge were not watching reliably.",
              ...evaluation.reasons.slice(1),
            ],
            citedEvidenceIds: [],
          };
      }
    }
  }
}
