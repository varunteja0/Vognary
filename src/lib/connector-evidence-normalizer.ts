import type {
  ConnectorCoverageWindow,
  ConnectorEvidence,
  ConnectorSyncResult,
} from "@/lib/connector-runtime";
import type { ConnectorDataType, ConnectorSyncMode } from "@/lib/connectors";

export type CanonicalFrequency =
  | "weekly"
  | "biweekly"
  | "semimonthly"
  | "monthly"
  | "bimonthly"
  | "quarterly"
  | "yearly"
  | "irregular";

export type CanonicalConnectorObservation = {
  evidence: ConnectorEvidence;
  externalId: string;
  observedAt: string;
  transactionDate: string;
  merchant: string;
  normalizedMerchant: string;
  amount: number | null;
  currency: string;
  category: string;
  frequency: CanonicalFrequency;
  nextExpectedDate: string | null;
  confidence: number;
  monthlyCost: number;
  annualCost: number;
  materializeTransaction: boolean;
  materializeCommitment: boolean;
  materializeUsage: boolean;
};

export type NormalizedConnectorSyncResult = {
  evidence: ConnectorEvidence[];
  observations: CanonicalConnectorObservation[];
  nextCursorState: Record<string, unknown>;
  nextSyncAt: string | null;
  coverage: ConnectorCoverageWindow;
  continuation: boolean;
};

type NormalizeSyncOptions = {
  connectorId: string;
  syncMode: ConnectorSyncMode;
  startedAt: string;
  cursorState?: Record<string, unknown>;
};

const transactionTypes = new Set<ConnectorDataType>([
  "transaction",
  "receipt",
  "invoice",
  "subscription",
  "mandate",
  "cost",
]);

const recurringTypes = new Set<ConnectorDataType>([
  "transaction",
  "receipt",
  "invoice",
  "subscription",
  "mandate",
]);

export function normalizeConnectorSyncResult(
  result: ConnectorEvidence[] | ConnectorSyncResult,
  options: NormalizeSyncOptions,
): NormalizedConnectorSyncResult {
  const batch = Array.isArray(result) ? { evidence: result } : result;
  const startedAt = normalizeTimestamp(options.startedAt, "sync start");
  const evidenceByExternalId = new Map<string, ConnectorEvidence>();

  for (const item of batch.evidence) {
    const externalId = normalizeExternalId(item.externalId);
    if (item.connectorId !== options.connectorId) {
      throw new Error(`Connector evidence ${externalId} belongs to ${item.connectorId}, not ${options.connectorId}.`);
    }

    evidenceByExternalId.set(externalId, {
      ...item,
      externalId,
      observedAt: normalizeTimestamp(item.observedAt, `evidence ${externalId}`),
    });
  }

  const evidence = [...evidenceByExternalId.values()];
  const coverage = normalizeCoverage(batch.coverage, evidence, startedAt);

  return {
    evidence,
    observations: evidence.map(canonicalizeConnectorEvidence),
    nextCursorState: isPlainRecord(batch.nextCursorState)
      ? batch.nextCursorState
      : options.cursorState ?? {},
    nextSyncAt: normalizeNextSyncAt(batch.nextSyncAt, options.syncMode, startedAt),
    coverage,
    continuation: Boolean(batch.continuation),
  };
}

export function canonicalizeConnectorEvidence(evidence: ConnectorEvidence): CanonicalConnectorObservation {
  const observedAt = normalizeTimestamp(evidence.observedAt, `evidence ${evidence.externalId}`);
  const merchant = normalizeMerchantLabel(evidence.merchantRaw, evidence.provider);
  const amount = normalizeAmount(evidence.amount);
  const currency = normalizeCurrency(evidence.currency);
  const frequency = normalizeFrequency(evidence.cadenceHint);
  const materializeTransaction = amount !== null && transactionTypes.has(evidence.evidenceType);
  const materializeCommitment = amount !== null
    && recurringTypes.has(evidence.evidenceType)
    && frequency !== "irregular";
  const annualCost = amount === null ? 0 : toAnnualCost(amount, frequency);

  return {
    evidence: { ...evidence, observedAt },
    externalId: normalizeExternalId(evidence.externalId),
    observedAt,
    transactionDate: observedAt.slice(0, 10),
    merchant,
    normalizedMerchant: normalizeMerchantKey(merchant),
    amount,
    currency,
    category: normalizeCategory(evidence.category),
    frequency,
    nextExpectedDate: normalizeOrInferNextDate(evidence.nextDebitHint, observedAt, frequency),
    confidence: clampConfidence(evidence.confidence),
    monthlyCost: roundCurrency(annualCost / 12),
    annualCost,
    materializeTransaction,
    materializeCommitment,
    materializeUsage: amount !== null && (evidence.evidenceType === "usage" || evidence.evidenceType === "cost"),
  };
}

export function defaultNextSyncAt(syncMode: ConnectorSyncMode, from: string): string | null {
  const base = new Date(normalizeTimestamp(from, "sync schedule"));
  const delayMs = syncMode === "polling"
    ? 60 * 60 * 1_000
    : syncMode === "scheduled"
      ? 24 * 60 * 60 * 1_000
      : syncMode === "webhook"
        ? 6 * 60 * 60 * 1_000
        : null;

  return delayMs === null ? null : new Date(base.getTime() + delayMs).toISOString();
}

export function normalizeMerchantKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim()
    .slice(0, 180) || "unknown merchant";
}

function normalizeCoverage(
  provided: ConnectorCoverageWindow | undefined,
  evidence: ConnectorEvidence[],
  startedAt: string,
): ConnectorCoverageWindow {
  if (provided) {
    const endAt = normalizeTimestamp(provided.endAt, "coverage end");
    const startAt = provided.startAt ? normalizeTimestamp(provided.startAt, "coverage start") : undefined;
    if (startAt && new Date(startAt).getTime() > new Date(endAt).getTime()) {
      throw new Error("Connector coverage start cannot be after its end.");
    }
    return { startAt, endAt, completeness: provided.completeness };
  }

  const timestamps = evidence.map((item) => new Date(item.observedAt).getTime()).filter(Number.isFinite);
  return {
    startAt: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : undefined,
    endAt: startedAt,
    completeness: "partial",
  };
}

function normalizeNextSyncAt(value: string | undefined, syncMode: ConnectorSyncMode, startedAt: string) {
  if (!value) return defaultNextSyncAt(syncMode, startedAt);
  return normalizeTimestamp(value, "next sync");
}

function normalizeTimestamp(value: string, label: string) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${label} timestamp.`);
  return parsed.toISOString();
}

function normalizeExternalId(value: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error("Connector evidence requires a stable external id.");
  if (normalized.length > 512) throw new Error("Connector evidence external id exceeds 512 characters.");
  return normalized;
}

function normalizeMerchantLabel(value: string | undefined, provider: string) {
  return (value?.trim() || provider.trim() || "Unknown merchant").replace(/\s+/g, " ").slice(0, 180);
}

function normalizeAmount(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return roundCurrency(value);
}

function normalizeCurrency(value: string | undefined) {
  const currency = (value ?? "INR").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "INR";
}

function normalizeCategory(value: string | undefined) {
  return value?.trim().slice(0, 100) || "Other";
}

function normalizeFrequency(value: string | undefined): CanonicalFrequency {
  const cadence = value?.trim().toLowerCase().replace(/[ _-]+/g, "");
  if (cadence === "weekly" || cadence === "week") return "weekly";
  if (cadence === "biweekly" || cadence === "fortnightly") return "biweekly";
  if (cadence === "semimonthly" || cadence === "twicemonthly") return "semimonthly";
  if (cadence === "monthly" || cadence === "month") return "monthly";
  if (cadence === "bimonthly" || cadence === "every2months") return "bimonthly";
  if (cadence === "quarterly" || cadence === "every3months") return "quarterly";
  if (cadence === "yearly" || cadence === "annual" || cadence === "annually") return "yearly";
  return "irregular";
}

function normalizeOrInferNextDate(value: string | undefined, observedAt: string, frequency: CanonicalFrequency) {
  if (value && isIsoDate(value)) return value;
  if (frequency === "irregular") return null;

  const date = new Date(`${observedAt.slice(0, 10)}T00:00:00.000Z`);
  if (frequency === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  if (frequency === "biweekly") date.setUTCDate(date.getUTCDate() + 14);
  if (frequency === "semimonthly") date.setUTCDate(date.getUTCDate() + 15);
  if (frequency === "monthly") return addUtcMonthsClamped(date, 1);
  if (frequency === "bimonthly") return addUtcMonthsClamped(date, 2);
  if (frequency === "quarterly") return addUtcMonthsClamped(date, 3);
  if (frequency === "yearly") return addUtcMonthsClamped(date, 12);
  return date.toISOString().slice(0, 10);
}

function addUtcMonthsClamped(date: Date, months: number) {
  const targetMonthIndex = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(date.getUTCDate(), lastDay)))
    .toISOString()
    .slice(0, 10);
}

function toAnnualCost(amount: number, frequency: CanonicalFrequency) {
  const multiplier: Record<CanonicalFrequency, number> = {
    weekly: 52,
    biweekly: 26,
    semimonthly: 24,
    monthly: 12,
    bimonthly: 6,
    quarterly: 4,
    yearly: 1,
    irregular: 1,
  };
  return roundCurrency(amount * multiplier[frequency]);
}

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
