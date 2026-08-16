export const monitoringFeeMinor = BigInt(99_900);
export const outcomeFeeBasisPoints = BigInt(1_500);
export const firstYearCapBasisPoints = BigInt(3_300);
const zeroMinor = BigInt(0);
const basisPointScale = BigInt(10_000);

export type FirstYearCharge = {
  monitoringMinor: bigint;
  verifiedSavingMinor: bigint;
  outcomeFeeMinor: bigint;
  retainedMinor: bigint;
  refundCreditMinor: bigint;
  additionalChargeMinor: bigint;
};

function basisPoints(amount: bigint, points: bigint): bigint {
  return (amount * points) / basisPointScale;
}

export type FeePeriodRange = { start: string; end: string };

export type CumulativeChargePeriod = {
  monitoringMinor: bigint;
  verifiedSavingMinor: bigint;
};

export type CumulativeFirstYearCharge = FirstYearCharge & {
  thisPeriodRetainedMinor: bigint;
};

export type InvoiceReplayDecision = "REPLAY" | "CONFLICT";

export function feePeriodsOverlap(left: FeePeriodRange, right: FeePeriodRange): boolean {
  if (left.end < left.start || right.end < right.start) {
    throw new Error("Fee periods must start on or before they end.");
  }
  return left.start <= right.end && right.start <= left.end;
}

export function invoiceReplayDecision(input: {
  existing: { inputsHash: string; retainedMinor: bigint };
  incomingInputsHash: string;
}): InvoiceReplayDecision {
  return input.existing.inputsHash === input.incomingInputsHash ? "REPLAY" : "CONFLICT";
}

export function computeCumulativeFirstYearCharge(input: {
  periods: readonly CumulativeChargePeriod[];
}): CumulativeFirstYearCharge {
  if (!input.periods.length) {
    return { ...computeFirstYearCharge(zeroMinor), thisPeriodRetainedMinor: zeroMinor };
  }
  let verifiedSavingMinor = zeroMinor;
  let monitoringMinor = zeroMinor;
  let priorRetained = zeroMinor;
  let thisPeriodRetainedMinor = zeroMinor;
  let latest: FirstYearCharge = computeFirstYearCharge(zeroMinor);
  for (const [index, period] of input.periods.entries()) {
    verifiedSavingMinor += period.verifiedSavingMinor;
    monitoringMinor += period.monitoringMinor;
    latest = computeFirstYearCharge(verifiedSavingMinor, monitoringMinor);
    thisPeriodRetainedMinor = latest.retainedMinor > priorRetained ? latest.retainedMinor - priorRetained : zeroMinor;
    if (index === input.periods.length - 1) break;
    priorRetained = latest.retainedMinor;
  }
  return { ...latest, thisPeriodRetainedMinor };
}

export function computeFirstYearCharge(verifiedSavingMinor: bigint, monitoringMinor: bigint = monitoringFeeMinor): FirstYearCharge {
  if (verifiedSavingMinor < zeroMinor) throw new Error("Verified saving cannot be negative.");
  if (monitoringMinor < zeroMinor) throw new Error("Monitoring fee cannot be negative.");
  if (verifiedSavingMinor === zeroMinor) {
    return {
      monitoringMinor,
      verifiedSavingMinor,
      outcomeFeeMinor: zeroMinor,
      retainedMinor: zeroMinor,
      refundCreditMinor: monitoringMinor,
      additionalChargeMinor: zeroMinor,
    };
  }
  const outcomeFeeMinor = basisPoints(verifiedSavingMinor, outcomeFeeBasisPoints);
  const capMinor = basisPoints(verifiedSavingMinor, firstYearCapBasisPoints);
  const uncapped = outcomeFeeMinor > monitoringMinor ? outcomeFeeMinor : monitoringMinor;
  const retainedMinor = uncapped < capMinor ? uncapped : capMinor;
  return {
    monitoringMinor,
    verifiedSavingMinor,
    outcomeFeeMinor,
    retainedMinor,
    refundCreditMinor: monitoringMinor > retainedMinor ? monitoringMinor - retainedMinor : zeroMinor,
    additionalChargeMinor: retainedMinor > monitoringMinor ? retainedMinor - monitoringMinor : zeroMinor,
  };
}
