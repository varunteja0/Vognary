import {
  boundedControlText,
  isCanonicalControlDateOnly,
  normalizeControlDateOnly,
  rejectUnknownControlFields,
  requireControlRecord,
} from "./validation";

const controlOutcomeDirections = ["AT_LEAST", "AT_MOST"] as const;
export type ControlOutcomeDirection = typeof controlOutcomeDirections[number];

export type IntendedControlOutcome = {
  metric: string;
  targetDirection: ControlOutcomeDirection;
  targetValue: string;
  unit: string;
  reviewOn: string;
};

export type ControlOutcomeObservation = {
  value: string;
  observedOn: string;
};

export type ControlOutcomeReconciliation = IntendedControlOutcome & {
  observedValue: string | null;
  observedOn: string | null;
  observationBasis: "USER_ENTERED_OBSERVATION" | "USER_ENTERED_WITH_EVIDENCE_CITATION" | "NOT_OBSERVED";
  verdict: "MET" | "MISSED" | "NOT_OBSERVED";
};

export function normalizeIntendedControlOutcome(value: unknown): IntendedControlOutcome {
  const record = requireControlRecord(value, "Intended outcome");
  rejectUnknownControlFields(record, ["metric", "targetDirection", "targetValue", "unit", "reviewOn"], "intended outcome");
  if (typeof record.targetDirection !== "string" || !controlOutcomeDirections.includes(record.targetDirection as ControlOutcomeDirection)) {
    throw new Error("Intended outcome target direction is not supported.");
  }
  return {
    metric: boundedControlText(record.metric, "Intended outcome metric", 1, 120),
    targetDirection: record.targetDirection as ControlOutcomeDirection,
    targetValue: normalizeControlOutcomeValue(record.targetValue, "Intended outcome target value"),
    unit: boundedControlText(record.unit, "Intended outcome unit", 1, 40),
    reviewOn: normalizeControlDateOnly(record.reviewOn, "Intended outcome review date"),
  };
}

export function normalizeControlOutcomeObservation(value: unknown): ControlOutcomeObservation {
  const record = requireControlRecord(value, "Observed outcome");
  rejectUnknownControlFields(record, ["value", "observedOn"], "observed outcome");
  return {
    value: normalizeControlOutcomeValue(record.value, "Observed outcome value"),
    observedOn: normalizeControlDateOnly(record.observedOn, "Observed outcome date"),
  };
}

export function normalizeControlOutcomeValue(value: unknown, label = "Outcome value"): string {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > 25 || !/^\d+(?:\.\d{1,6})?$/.test(normalized)) {
    throw new Error(`${label} must be a non-negative decimal with at most six fractional digits.`);
  }
  const [integerPart, fractionalPart = ""] = normalized.split(".");
  const integer = integerPart.replace(/^0+(?=\d)/, "");
  if (integer.length > 18) throw new Error(`${label} exceeds the supported range.`);
  const fractional = fractionalPart.replace(/0+$/, "");
  return fractional ? `${integer}.${fractional}` : integer;
}

export function reconcileControlOutcome(
  intendedValue: IntendedControlOutcome,
  observedValue?: ControlOutcomeObservation,
  observedThrough?: string,
): ControlOutcomeReconciliation {
  const intended = normalizeIntendedControlOutcome(intendedValue);
  if (observedValue === undefined) {
    return {
      ...intended,
      observedValue: null,
      observedOn: null,
      observationBasis: "NOT_OBSERVED",
      verdict: "NOT_OBSERVED",
    };
  }
  const observed = normalizeControlOutcomeObservation(observedValue);
  const cutoff = normalizeControlDateOnly(observedThrough, "Outcome observation cutoff");
  if (observed.observedOn > cutoff) throw new Error("Observed outcome date cannot be in the future.");
  if (observed.observedOn < intended.reviewOn) {
    throw new Error("Observed outcome date cannot be before the intended review date.");
  }
  const comparison = compareControlOutcomeValues(observed.value, intended.targetValue);
  const met = intended.targetDirection === "AT_LEAST" ? comparison >= 0 : comparison <= 0;
  return {
    ...intended,
    observedValue: observed.value,
    observedOn: observed.observedOn,
    observationBasis: "USER_ENTERED_OBSERVATION",
    verdict: met ? "MET" : "MISSED",
  };
}

export { normalizeControlDateOnly };

export function isIntendedControlOutcome(value: unknown): value is IntendedControlOutcome {
  if (!isRecord(value)
    || !isBoundedCanonicalText(value.metric, 1, 120)
    || typeof value.targetDirection !== "string"
    || !controlOutcomeDirections.includes(value.targetDirection as ControlOutcomeDirection)
    || !isCanonicalOutcomeValue(value.targetValue)
    || !isBoundedCanonicalText(value.unit, 1, 40)
    || typeof value.reviewOn !== "string"
    || !isCanonicalControlDateOnly(value.reviewOn)) return false;
  return true;
}

export function isControlOutcomeReconciliation(value: unknown): value is ControlOutcomeReconciliation {
  if (!isRecord(value)) return false;
  const record = value;
  const verdict = record.verdict;
  const observedValue = record.observedValue;
  const observedOn = record.observedOn;
  const observationBasis = record.observationBasis;
  if (!isIntendedControlOutcome(record)) return false;
  if (verdict === "NOT_OBSERVED") {
    return observedValue === null
      && observedOn === null
      && observationBasis === "NOT_OBSERVED";
  }
  if ((verdict !== "MET" && verdict !== "MISSED")
    || !isCanonicalOutcomeValue(observedValue)
    || typeof observedOn !== "string"
    || !isCanonicalControlDateOnly(observedOn)
    || observedOn < record.reviewOn
    || (observationBasis !== "USER_ENTERED_OBSERVATION"
      && observationBasis !== "USER_ENTERED_WITH_EVIDENCE_CITATION")) return false;
  const expected = reconcileControlOutcome({
    metric: record.metric,
    targetDirection: record.targetDirection,
    targetValue: record.targetValue,
    unit: record.unit,
    reviewOn: record.reviewOn,
  }, { value: observedValue, observedOn }, observedOn);
  return expected.verdict === verdict;
}

function compareControlOutcomeValues(leftValue: string, rightValue: string) {
  const left = fixedSix(leftValue);
  const right = fixedSix(rightValue);
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isBoundedCanonicalText(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string"
    && value.trim() === value
    && value.length >= minimum
    && value.length <= maximum;
}

function isCanonicalOutcomeValue(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return normalizeControlOutcomeValue(value) === value;
  } catch {
    return false;
  }
}

function fixedSix(value: string) {
  const normalized = normalizeControlOutcomeValue(value);
  const [integer, fractional = ""] = normalized.split(".");
  return BigInt(`${integer}${fractional.padEnd(6, "0")}`);
}
