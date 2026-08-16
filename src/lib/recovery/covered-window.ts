export const coveredWindowStatuses = ["PENDING", "COVERED_CLEAN", "NOT_ELIMINATED", "MISSING_COVERAGE"] as const;
export type CoveredWindowStatus = (typeof coveredWindowStatuses)[number];

export const debitPostingToleranceBeforeDays = 1 as const;
export const debitPostingToleranceAfterDays = 3 as const;

export type CoveredWindowInput = {
  expectedDebitDate: string;
  baselineDebitMinor: bigint;
  observedDebitMinor: bigint | null;
  coverageStart: string | null;
  coverageEnd: string | null;
};

export type CoveredWindowResult = {
  status: CoveredWindowStatus;
  savingMinor: bigint | null;
};

export type DebitObservationWindow = {
  start: string;
  end: string;
};

function addUtcDays(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days);
  return new Date(utc).toISOString().slice(0, 10);
}

/** Inclusive posting window around the derived debit date. Late merchant posts still count. */
export function debitObservationWindow(expectedDebitDate: string): DebitObservationWindow {
  return {
    start: addUtcDays(expectedDebitDate, -debitPostingToleranceBeforeDays),
    end: addUtcDays(expectedDebitDate, debitPostingToleranceAfterDays),
  };
}

function coversObservationWindow(input: CoveredWindowInput): boolean {
  if (!input.coverageStart || !input.coverageEnd) return false;
  const window = debitObservationWindow(input.expectedDebitDate);
  return input.coverageStart <= window.start && window.end <= input.coverageEnd;
}

export type CoveredWindowProofInput = {
  workspaceId: string;
  candidateWorkspaceId: string;
  commitmentId: string;
  candidateCommitmentId: string;
  currency: string;
  candidateCurrency: string;
  sourceKind: "RECEIPT_PASTE" | "CSV_IMPORT" | "FORWARDED_EMAIL" | "GMAIL_OAUTH" | "REGULATED_STATEMENT" | "UNRELATED";
  sourceWorkspaceId: string;
  sourceRegulated: boolean;
  coverageStart: string | null;
  coverageEnd: string | null;
  coverageGaps?: readonly { start: string; end: string }[];
  expectedDebitDate: string;
  baselineDebitMinor: bigint;
  historicalDebits?: readonly { date: string; amountMinor: bigint; currency: string; corrected?: boolean; evidenceId?: string }[];
  observedDebits: readonly { date: string; amountMinor: bigint; currency: string; corrected?: boolean; evidenceId?: string }[];
};

function isUserSubmittedCoverageSource(kind: CoveredWindowProofInput["sourceKind"]): boolean {
  return kind === "CSV_IMPORT"
    || kind === "RECEIPT_PASTE"
    || kind === "FORWARDED_EMAIL"
    || kind === "GMAIL_OAUTH"
    || kind === "UNRELATED";
}

function isStatementRegulatedSource(input: CoveredWindowProofInput): boolean {
  return input.sourceKind === "REGULATED_STATEMENT" && input.sourceRegulated && !isUserSubmittedCoverageSource(input.sourceKind);
}

function provenHistoricalBaseline(input: CoveredWindowProofInput): bigint | null {
  const history = (input.historicalDebits ?? []).filter((row) =>
    !row.corrected
    && row.currency === input.currency
    && row.date < input.expectedDebitDate,
  );
  if (!history.length) return null;
  const amounts = [...new Set(history.map((row) => row.amountMinor.toString()))];
  if (amounts.length !== 1) return null;
  const baseline = BigInt(amounts[0]!);
  if (baseline !== input.baselineDebitMinor) return null;
  return baseline;
}

function coverageHasGaps(input: CoveredWindowProofInput): boolean {
  const window = debitObservationWindow(input.expectedDebitDate);
  return (input.coverageGaps ?? []).some((gap) =>
    gap.start <= window.end
    && window.start <= gap.end,
  );
}

function dateInWindow(date: string, window: DebitObservationWindow): boolean {
  return window.start <= date && date <= window.end;
}

export function evaluateCoveredWindowProof(input: CoveredWindowProofInput): CoveredWindowResult {
  if (
    input.workspaceId !== input.candidateWorkspaceId
    || input.sourceWorkspaceId !== input.workspaceId
    || input.commitmentId !== input.candidateCommitmentId
    || !isStatementRegulatedSource(input)
  ) {
    return { status: "PENDING", savingMinor: null };
  }
  const baseline = provenHistoricalBaseline(input);
  if (baseline === null) {
    return { status: "PENDING", savingMinor: null };
  }
  if (input.currency !== input.candidateCurrency || coverageHasGaps(input)) {
    return { status: "MISSING_COVERAGE", savingMinor: null };
  }
  return evaluateCoveredWindow({
    expectedDebitDate: input.expectedDebitDate,
    baselineDebitMinor: baseline,
    observedDebitMinor: observedDebitTotal(input),
    coverageStart: input.coverageStart,
    coverageEnd: input.coverageEnd,
  });
}

function observedDebitTotal(input: CoveredWindowProofInput): bigint | null {
  if (!input.coverageStart || !input.coverageEnd) return null;
  const window = debitObservationWindow(input.expectedDebitDate);
  const live = input.observedDebits.filter((row) =>
    !row.corrected
    && row.currency === input.currency
    && dateInWindow(row.date, window),
  );
  const seenEvidence = new Set<string>();
  let total = BigInt(0);
  for (const row of live) {
    if (row.evidenceId) {
      if (seenEvidence.has(row.evidenceId)) continue;
      seenEvidence.add(row.evidenceId);
    }
    total += row.amountMinor;
  }
  return total;
}

/** Merchant confirmation is execution proof, not a rupee saving. Gmail silence is not financial proof. */
export function evaluateCoveredWindow(input: CoveredWindowInput): CoveredWindowResult {
  if (!coversObservationWindow(input)) {
    return { status: input.coverageStart || input.coverageEnd ? "MISSING_COVERAGE" : "PENDING", savingMinor: null };
  }
  const observed = input.observedDebitMinor ?? BigInt(0);
  const saving = input.baselineDebitMinor > observed ? input.baselineDebitMinor - observed : BigInt(0);
  if (observed > BigInt(0)) return { status: "NOT_ELIMINATED", savingMinor: saving };
  return { status: "COVERED_CLEAN", savingMinor: saving };
}
