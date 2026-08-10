import type {
  ChangeItemDto,
  Decision,
  DecisionDto,
  HomeChangedDto,
  HomeProjectionDto,
  MoneyDto,
  ProjectionTotalDto,
  WorkspaceDto,
  Cadence,
  CommitmentStatus,
} from "./contracts";

const dayMs = 24 * 60 * 60 * 1_000;

export type CanonicalCommitmentRecord = {
  id: string;
  version: number;
  status: CommitmentStatus;
  merchant: string;
  category: string;
  cadence: Cadence;
  currency: string;
  amountMinor: bigint;
  monthlyEquivalentMinor: bigint;
  nextExpectedDate: string | null;
  confidenceScore: number;
  confidenceReasons: readonly string[];
  recommendedDecision: Decision;
  recommendationReason: string;
  riskTags: readonly string[];
  decision: DecisionDto | null;
  evidenceIds: readonly [string, ...string[]];
  updatedAt: string;
};

export type RecoveryCoverageSource = {
  id: string;
  ingestedAt: string;
  coverageStart: string | null;
  coverageEnd: string | null;
  evidenceCount: number;
};

export type HomeProjectionInput = {
  workspace: WorkspaceDto;
  generatedAt?: Date;
  commitments: readonly CanonicalCommitmentRecord[];
  sources: readonly RecoveryCoverageSource[];
  changed: HomeChangedDto;
};

export function buildHomeProjection(input: HomeProjectionInput): HomeProjectionDto {
  assertReconstructibleChanges(input.changed.items);
  const generatedAt = input.generatedAt ?? new Date();
  const today = dateOnly(generatedAt);
  const active = input.commitments.filter((commitment) => commitment.status === "ACTIVE");
  const monthlyTotals = buildTotals(active, (commitment) => commitment.monthlyEquivalentMinor);
  const next30DayCommitments = active.filter((commitment) => {
    const days = commitment.nextExpectedDate ? daysBetween(today, commitment.nextExpectedDate) : null;
    return days !== null && days >= 0 && days <= 30;
  });
  const next30DayTotals = buildTotals(next30DayCommitments, (commitment) => commitment.amountMinor);

  const next = active
    .filter((commitment) => commitment.nextExpectedDate && daysBetween(today, commitment.nextExpectedDate) !== null)
    .map((commitment) => ({ commitment, daysAway: daysBetween(today, commitment.nextExpectedDate!)! }))
    .filter(({ daysAway }) => daysAway >= 0)
    .sort((left, right) => left.daysAway - right.daysAway || left.commitment.merchant.localeCompare(right.commitment.merchant))
    .slice(0, 12)
    .map(({ commitment, daysAway }) => ({
      commitmentId: commitment.id,
      merchant: commitment.merchant,
      date: commitment.nextExpectedDate!,
      daysAway,
      amount: toMoneyDto(commitment.amountMinor, commitment.currency),
      decision: commitment.decision,
      confidence: toConfidence(commitment),
      evidenceIds: commitment.evidenceIds,
    }));

  return {
    workspace: input.workspace,
    generatedAt: generatedAt.toISOString(),
    monthlyTotals,
    next30DayTotals,
    needsMe: active.flatMap((commitment) => buildAttention(commitment, today)),
    changed: input.changed,
    next,
    coverage: buildCoverage(input.sources, input.changed.state, generatedAt),
  };
}

export function assertReconstructibleChanges(items: readonly ChangeItemDto[]) {
  for (const item of items) {
    if (item.provenance.kind === "EVIDENCE") {
      if (!item.provenance.submissionId || !item.provenance.evidenceIds.length || item.provenance.evidenceIds.some((id) => !id)) {
        throw new Error("Every evidence-caused Changed item must cite its submission and persisted evidence ids.");
      }
      continue;
    }
    if (!item.provenance.correctionId || item.provenance.evidenceIds.length !== 0) {
      throw new Error("Every correction-caused Changed item must cite only its correction record.");
    }
  }
}

const postgresBigintMax = BigInt("9223372036854775807");

export function currencyExponent(currency: string) {
  const normalizedCurrency = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) throw new Error("Money currency must be a three-letter code.");
  const exponent = new Intl.NumberFormat("en", { style: "currency", currency: normalizedCurrency })
    .resolvedOptions().maximumFractionDigits;
  if (typeof exponent !== "number" || !Number.isInteger(exponent) || exponent < 0 || exponent > 6) {
    throw new Error("Money currency exponent is not supported.");
  }
  return exponent;
}

export function normalizeMinorUnits(value: unknown) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error("Money minor units must be a canonical non-negative decimal string.");
  }
  const minor = BigInt(value);
  if (minor > postgresBigintMax) throw new Error("Money minor units exceed PostgreSQL bigint.");
  return minor.toString();
}

export function decimalToMinorUnits(value: string, currency: string) {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) throw new Error("Money value must be a non-negative decimal string.");
  const exponent = currencyExponent(currency);
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > exponent) throw new Error(`Money fraction exceeds the currency exponent ${exponent}.`);
  const factor = BigInt(10) ** BigInt(exponent);
  const minor = BigInt(whole) * factor + BigInt((fraction || "").padEnd(exponent, "0") || "0");
  return normalizeMinorUnits(minor.toString());
}

export function minorUnitsToDecimal(value: string | bigint, exponent: number) {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 6) throw new Error("Money currency exponent is not supported.");
  const minor = BigInt(normalizeMinorUnits(typeof value === "bigint" ? value.toString() : value));
  if (exponent === 0) return minor.toString();
  const factor = BigInt(10) ** BigInt(exponent);
  return `${minor / factor}.${(minor % factor).toString().padStart(exponent, "0")}`;
}

export function toMoneyDto(value: string | bigint, currency: string): MoneyDto {
  const normalizedCurrency = currency.trim().toUpperCase();
  const exponent = currencyExponent(normalizedCurrency);
  const minor = normalizeMinorUnits(typeof value === "bigint" ? value.toString() : value);
  const amount = BigInt(minor);
  const factor = BigInt(10) ** BigInt(exponent);
  const fraction = exponent ? (amount % factor).toString().padStart(exponent, "0") : "";
  const formatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: normalizedCurrency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  });
  return {
    currency: normalizedCurrency,
    minor,
    exponent,
    display: formatter.formatToParts(amount / factor)
      .map((part) => part.type === "fraction" ? fraction : part.value)
      .join(""),
  };
}

function buildTotals(
  commitments: readonly CanonicalCommitmentRecord[],
  amountOf: (commitment: CanonicalCommitmentRecord) => bigint,
): ProjectionTotalDto[] {
  const totals = new Map<string, { minor: bigint; commitmentIds: string[]; evidenceIds: string[] }>();
  for (const commitment of commitments) {
    const current = totals.get(commitment.currency) ?? { minor: BigInt(0), commitmentIds: [], evidenceIds: [] };
    current.minor += amountOf(commitment);
    current.commitmentIds.push(commitment.id);
    current.evidenceIds.push(...commitment.evidenceIds);
    totals.set(commitment.currency, current);
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left === "INR" ? -1 : right === "INR" ? 1 : left.localeCompare(right))
    .map(([currency, total]) => ({
      amount: toMoneyDto(total.minor, currency),
      commitmentIds: asNonEmpty(unique(total.commitmentIds)),
      evidenceIds: asNonEmpty(unique(total.evidenceIds)),
    }));
}

function buildAttention(commitment: CanonicalCommitmentRecord, today: string): HomeProjectionDto["needsMe"] {
  const confidence = toConfidence(commitment);
  const daysAway = commitment.nextExpectedDate ? daysBetween(today, commitment.nextExpectedDate) : null;
  if (!commitment.decision) {
    return [{
      id: `decision:${commitment.id}:${commitment.version}`,
      commitmentId: commitment.id,
      priority: daysAway !== null && daysAway <= 7 ? "HIGH" : "MEDIUM",
      reason: "DECISION_REQUIRED",
      title: `Decide on ${commitment.merchant}`,
      detail: commitment.recommendationReason,
      amount: toMoneyDto(commitment.amountMinor, commitment.currency),
      dueDate: commitment.nextExpectedDate,
      evidenceIds: commitment.evidenceIds,
    }];
  }
  if (confidence.state === "LOW" || confidence.state === "UNKNOWN") {
    return [{
      id: `confidence:${commitment.id}:${commitment.version}`,
      commitmentId: commitment.id,
      priority: "MEDIUM",
      reason: "LOW_CONFIDENCE",
      title: `Confirm ${commitment.merchant}`,
      detail: confidence.reasons[0] ?? "The persisted evidence is not yet sufficient for high confidence.",
      amount: toMoneyDto(commitment.amountMinor, commitment.currency),
      dueDate: commitment.nextExpectedDate,
      evidenceIds: commitment.evidenceIds,
    }];
  }
  if (daysAway !== null && daysAway >= 0 && daysAway <= 7) {
    return [{
      id: `renewal:${commitment.id}:${commitment.version}`,
      commitmentId: commitment.id,
      priority: daysAway <= 2 ? "HIGH" : "LOW",
      reason: "RENEWS_SOON",
      title: `${commitment.merchant} is due soon`,
      detail: `Expected in ${daysAway} day${daysAway === 1 ? "" : "s"}.`,
      amount: toMoneyDto(commitment.amountMinor, commitment.currency),
      dueDate: commitment.nextExpectedDate,
      evidenceIds: commitment.evidenceIds,
    }];
  }
  return [];
}

function toConfidence(commitment: CanonicalCommitmentRecord) {
  const score = Math.max(0, Math.min(100, Math.round(commitment.confidenceScore)));
  return {
    state: score >= 85 ? "HIGH" as const : score >= 65 ? "MEDIUM" as const : score > 0 ? "LOW" as const : "UNKNOWN" as const,
    score: score > 0 ? score : null,
    scale: "PERCENT_0_100" as const,
    reasons: commitment.confidenceReasons,
  };
}

function buildCoverage(
  sources: readonly RecoveryCoverageSource[],
  changedState: HomeChangedDto["state"],
  generatedAt: Date,
): HomeProjectionDto["coverage"] {
  if (!sources.length) {
    return {
      state: "NO_EVIDENCE",
      sourceCount: 0,
      evidenceCount: 0,
      lastEvidenceAt: null,
      coverageStart: null,
      coverageEnd: null,
      limitations: ["No persisted Recovery evidence exists for this workspace."],
    };
  }
  const coverageStarts = sources.map((source) => source.coverageStart).filter((value): value is string => Boolean(value)).sort();
  const coverageEnds = sources.map((source) => source.coverageEnd).filter((value): value is string => Boolean(value)).sort();
  const ingested = sources.map((source) => source.ingestedAt).sort();
  const coverageStart = coverageStarts[0] ?? null;
  const coverageEnd = coverageEnds.at(-1) ?? null;
  const lastEvidenceAt = ingested.at(-1) ?? null;
  const ageDays = lastEvidenceAt ? Math.floor((generatedAt.getTime() - new Date(lastEvidenceAt).getTime()) / dayMs) : Number.POSITIVE_INFINITY;
  const spanDays = coverageStart && coverageEnd ? daysBetween(coverageStart, coverageEnd) ?? 0 : 0;
  const state = changedState === "NO_PRIOR_BASELINE"
    ? "BASELINE_ONLY" as const
    : ageDays > 45
      ? "STALE" as const
      : ageDays <= 14 && spanDays >= 60
        ? "CURRENT" as const
        : "PARTIAL" as const;
  const limitations = state === "BASELINE_ONLY"
    ? ["No prior persisted baseline exists."]
    : state === "STALE"
      ? ["The newest persisted evidence is more than 45 days old."]
      : state === "PARTIAL"
        ? ["Coverage is incomplete; totals are an evidence-backed floor, not a ceiling."]
        : [];
  return {
    state,
    sourceCount: sources.length,
    evidenceCount: sources.reduce((sum, source) => sum + source.evidenceCount, 0),
    lastEvidenceAt,
    coverageStart,
    coverageEnd,
    limitations,
  };
}

function daysBetween(left: string, right: string) {
  const leftDate = parseDateOnly(left);
  const rightDate = parseDateOnly(right);
  if (!leftDate || !rightDate) return null;
  return Math.round((rightDate.getTime() - leftDate.getTime()) / dayMs);
}

function parseDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function asNonEmpty(values: string[]): readonly [string, ...string[]] {
  const [first, ...rest] = values;
  if (!first) throw new Error("Projection totals must cite commitments and persisted evidence.");
  return [first, ...rest];
}
