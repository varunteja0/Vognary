import { createHash, randomUUID } from "node:crypto";
import {
  cadences,
  decisions,
  recoveryErrorStatusByCode,
  recoveryLimits,
  type ApiFailure,
  type CreateCorrectionRequest,
  type EvidenceIngestRequest,
  type ForwardedEmailMaterializationRequest,
  type PutDecisionRequest,
  type RecoveryErrorCode,
} from "@/lib/recovery/contracts";
import { normalizeMinorUnits } from "@/lib/recovery/domain";

const safeMessages: Record<RecoveryErrorCode, string> = {
  AUTH_REQUIRED: "Sign in to continue.",
  FORBIDDEN: "This workspace role cannot perform that action.",
  NOT_FOUND: "The requested Recovery record was not found.",
  INVALID_EVIDENCE: "The submitted evidence is invalid.",
  PARSE_FAILED: "No recurring evidence could be established from that submission.",
  DUPLICATE_EVIDENCE: "That evidence is already saved in this workspace.",
  DATABASE_UNAVAILABLE: "Recovery storage is temporarily unavailable.",
  CONFLICT: "The request conflicts with the current Recovery state.",
  STALE_STATE: "Workspace state changed. Reload before retrying.",
  SAVE_FAILED: "Recovery could not save the request.",
  REQUEST_TOO_LARGE: "The Recovery request is too large.",
  UNSUPPORTED_MEDIA_TYPE: "Content-Type must be application/json.",
  FEATURE_UNAVAILABLE: "This Recovery feature is not available for this deployment.",
  RATE_LIMITED: "Too many requests. Retry later.",
  UNKNOWN: "Recovery could not complete the request.",
};

export class RecoveryServiceError extends Error {
  readonly code: RecoveryErrorCode;
  readonly retryable: boolean;
  readonly currentVersion?: number;
  readonly retryAfterSeconds?: number;

  constructor(code: RecoveryErrorCode, internalMessage?: string, details: {
    retryable?: boolean;
    currentVersion?: number;
    retryAfterSeconds?: number;
  } = {}) {
    super(internalMessage || safeMessages[code]);
    this.name = "RecoveryServiceError";
    this.code = code;
    this.retryable = details.retryable ?? ["DATABASE_UNAVAILABLE", "STALE_STATE", "SAVE_FAILED", "RATE_LIMITED", "UNKNOWN"].includes(code);
    this.currentVersion = details.currentVersion;
    this.retryAfterSeconds = details.retryAfterSeconds;
  }
}

export const recoveryMaterializationStages = [
  "EVENT_VALIDATION",
  "SUBMISSION",
  "SOURCE_PERSISTENCE",
  "REANALYSIS",
  "COMMITMENT_UPSERT",
  "EVIDENCE_LINKING",
  "CHANGE_PERSISTENCE",
  "VERSION_ADVANCE",
  "ALERT_SCHEDULING",
  "IDEMPOTENCY",
  "EVENT_COMPLETION",
  "AUDIT",
  "COMMIT",
] as const;

export type RecoveryMaterializationStage = (typeof recoveryMaterializationStages)[number];

export class RecoveryMaterializationError extends RecoveryServiceError {
  constructor(readonly stage: RecoveryMaterializationStage, cause: RecoveryServiceError) {
    super(cause.code, undefined, {
      retryable: cause.retryable,
      currentVersion: cause.currentVersion,
      retryAfterSeconds: cause.retryAfterSeconds,
    });
    this.name = "RecoveryMaterializationError";
  }
}

export function createRecoveryRequestId() {
  return randomUUID();
}

export function getRecoveryMutationPreconditions(request: Request) {
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(idempotencyKey)) {
    throw new RecoveryServiceError("INVALID_EVIDENCE", "A valid Idempotency-Key header is required.");
  }
  const ifMatch = request.headers.get("if-match")?.trim() ?? "";
  const match = /^"workspace:(0|[1-9]\d*)"$/.exec(ifMatch);
  if (!match) {
    throw new RecoveryServiceError("STALE_STATE", "An exactly quoted If-Match workspace version is required.", { currentVersion: 0 });
  }
  const expectedVersion = Number(match[1]);
  if (!Number.isSafeInteger(expectedVersion)) {
    throw new RecoveryServiceError("STALE_STATE", "The quoted If-Match workspace version is invalid.", { currentVersion: 0 });
  }
  return { idempotencyKey, expectedVersion };
}

export function normalizeEvidenceRequest(value: unknown): EvidenceIngestRequest {
  const record = requireRecord(value, "Evidence request");
  rejectUnknown(record, new Set(["kind", "receipts", "sources"]), "evidence request");
  if (record.kind === "RECEIPT_PASTE") {
    if ("sources" in record) throw invalid("sources is not valid for RECEIPT_PASTE.");
    if (!Array.isArray(record.receipts) || !record.receipts.length || record.receipts.length > recoveryLimits.maxReceiptSnippets) {
      throw invalid(`receipts must contain 1 to ${recoveryLimits.maxReceiptSnippets} snippets.`);
    }
    const receipts = record.receipts.map((entry, index) => normalizeReceipt(entry, index));
    const characters = receipts.reduce((total, receipt) => total + receipt.text.length, 0);
    if (characters > recoveryLimits.maxReceiptCharacters) throw tooLarge("Receipt evidence exceeds the character limit.");
    return { kind: "RECEIPT_PASTE", receipts };
  }
  if (record.kind === "CSV_IMPORT") {
    if ("receipts" in record) throw invalid("receipts is not valid for CSV_IMPORT.");
    if (!Array.isArray(record.sources) || !record.sources.length || record.sources.length > recoveryLimits.maxCsvSources) {
      throw invalid(`sources must contain 1 to ${recoveryLimits.maxCsvSources} CSV files.`);
    }
    return {
      kind: "CSV_IMPORT",
      sources: record.sources.map((entry, index) => normalizeCsvSource(entry, index)),
    };
  }
  throw invalid("kind must be RECEIPT_PASTE or CSV_IMPORT.");
}

export function normalizeForwardedEmailMaterializationRequest(value: unknown): ForwardedEmailMaterializationRequest {
  const record = requireRecord(value, "Forwarded email materialization request");
  rejectUnknown(record, new Set(["kind", "receipts"]), "forwarded email materialization request");
  if (record.kind !== "FORWARDED_EMAIL") throw invalid("kind must be FORWARDED_EMAIL.");
  if (!Array.isArray(record.receipts) || !record.receipts.length || record.receipts.length > recoveryLimits.maxReceiptSnippets) {
    throw invalid(`receipts must contain 1 to ${recoveryLimits.maxReceiptSnippets} snippets.`);
  }
  const receipts = record.receipts.map((entry, index) => normalizeReceipt(entry, index));
  const characters = receipts.reduce((total, receipt) => total + receipt.text.length, 0);
  if (characters > recoveryLimits.maxReceiptCharacters) throw tooLarge("Forwarded receipt evidence exceeds the character limit.");
  return { kind: "FORWARDED_EMAIL", receipts };
}

export function normalizeCorrectionRequest(value: unknown): CreateCorrectionRequest {
  const record = requireRecord(value, "Correction request");
  rejectUnknown(record, new Set(["patch", "reason"]), "correction request");
  const patch = requireRecord(record.patch, "Correction patch");
  rejectUnknown(patch, new Set(["field", "value"]), "correction patch");
  const patchValue = requireRecord(patch.value, "Correction value");
  let normalized: CreateCorrectionRequest["patch"];
  switch (patch.field) {
    case "MERCHANT": {
      rejectUnknown(patchValue, new Set(["merchant"]), "MERCHANT correction");
      const merchant = boundedText(patchValue.merchant, "merchant", 1, 240);
      normalized = { field: "MERCHANT", value: { merchant } };
      break;
    }
    case "AMOUNT": {
      rejectUnknown(patchValue, new Set(["amountMinor"]), "AMOUNT correction");
      try {
        normalized = { field: "AMOUNT", value: { amountMinor: normalizeMinorUnits(patchValue.amountMinor) } };
      } catch (error) {
        throw invalid(`amountMinor: ${error instanceof Error ? error.message : "invalid money value"}`);
      }
      break;
    }
    case "NEXT_EXPECTED_DATE": {
      rejectUnknown(patchValue, new Set(["date"]), "NEXT_EXPECTED_DATE correction");
      const date = boundedText(patchValue.date, "date", 10, 10);
      if (!isDateOnly(date)) throw invalid("date must be a real YYYY-MM-DD calendar date.");
      normalized = { field: "NEXT_EXPECTED_DATE", value: { date } };
      break;
    }
    case "CADENCE": {
      rejectUnknown(patchValue, new Set(["cadence"]), "CADENCE correction");
      if (typeof patchValue.cadence !== "string" || !cadences.includes(patchValue.cadence as (typeof cadences)[number])) throw invalid("cadence is not supported.");
      normalized = { field: "CADENCE", value: { cadence: patchValue.cadence as (typeof cadences)[number] } };
      break;
    }
    case "IS_RECURRING": {
      rejectUnknown(patchValue, new Set(["isRecurring"]), "IS_RECURRING correction");
      if (typeof patchValue.isRecurring !== "boolean") throw invalid("isRecurring must be a boolean.");
      normalized = { field: "IS_RECURRING", value: { isRecurring: patchValue.isRecurring } };
      break;
    }
    default:
      throw invalid("Correction field is not supported.");
  }
  const reason = record.reason === undefined ? undefined : boundedText(record.reason, "reason", 1, 1000);
  return reason === undefined ? { patch: normalized } : { patch: normalized, reason };
}

export function normalizeDecisionRequest(value: unknown): PutDecisionRequest {
  const record = requireRecord(value, "Decision request");
  rejectUnknown(record, new Set(["commitmentId", "decision"]), "decision request");
  const commitmentId = boundedText(record.commitmentId, "commitmentId", 36, 36);
  if (!isUuid(commitmentId)) throw invalid("commitmentId must be a UUID.");
  if (typeof record.decision !== "string" || !decisions.includes(record.decision as (typeof decisions)[number])) throw invalid("decision is not supported.");
  return { commitmentId, decision: record.decision as (typeof decisions)[number] };
}

export function hashRecoveryRequest(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function recoveryFailureResponse(error: unknown, requestId: string) {
  const serviceError = error instanceof RecoveryServiceError ? error : new RecoveryServiceError("UNKNOWN");
  const base = {
    code: serviceError.code,
    message: safeMessages[serviceError.code],
    retryable: serviceError.retryable,
    requestId,
  };
  const payload: ApiFailure = serviceError.code === "STALE_STATE"
    ? { error: { ...base, code: "STALE_STATE", currentVersion: serviceError.currentVersion ?? 0 } }
    : serviceError.code === "RATE_LIMITED"
      ? { error: { ...base, code: "RATE_LIMITED", retryAfterSeconds: serviceError.retryAfterSeconds ?? 60 } }
      : { error: { ...base, code: serviceError.code } } as ApiFailure;
  const headers: HeadersInit = { "cache-control": "private, no-store" };
  if (serviceError.code === "RATE_LIMITED") headers["retry-after"] = String(serviceError.retryAfterSeconds ?? 60);
  return Response.json(payload, { status: recoveryErrorStatusByCode[serviceError.code], headers });
}

export function recoverySuccessResponse<T>(data: T, requestId: string, workspaceVersion: number, status = 200) {
  return Response.json({ data, meta: { requestId, workspaceVersion } }, {
    status,
    headers: {
      "cache-control": "private, no-store",
      etag: `"workspace:${workspaceVersion}"`,
    },
  });
}

function normalizeReceipt(value: unknown, index: number) {
  const record = requireRecord(value, `Receipt ${index + 1}`);
  rejectUnknown(record, new Set(["clientRef", "text"]), `receipt ${index + 1}`);
  return {
    clientRef: boundedText(record.clientRef, "clientRef", 1, 240),
    text: boundedText(record.text, "text", 1, recoveryLimits.maxReceiptCharacters, false),
  };
}

function normalizeCsvSource(value: unknown, index: number) {
  const record = requireRecord(value, `CSV source ${index + 1}`);
  rejectUnknown(record, new Set(["clientRef", "name", "text"]), `CSV source ${index + 1}`);
  return {
    clientRef: boundedText(record.clientRef, "clientRef", 1, 240),
    name: boundedText(record.name, "name", 1, 240),
    text: boundedText(record.text, "text", 1, recoveryLimits.maxCsvCharactersPerSource, false),
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(`${label} must be a JSON object.`);
  return value as Record<string, unknown>;
}

function rejectUnknown(record: Record<string, unknown>, allowed: Set<string>, label: string) {
  const key = Object.keys(record).find((candidate) => !allowed.has(candidate));
  if (key) throw invalid(`${label} field ${key} is not supported.`);
}

function boundedText(value: unknown, label: string, min: number, max: number, trim = true) {
  if (typeof value !== "string") throw invalid(`${label} must be text.`);
  const normalized = trim ? value.trim() : value;
  if (normalized.length < min || normalized.length > max || (!trim && !normalized.trim())) {
    throw invalid(`${label} must contain ${min} to ${max} characters.`);
  }
  return normalized;
}

function isDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).toISOString().slice(0, 10) === value;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function invalid(message: string) {
  return new RecoveryServiceError("INVALID_EVIDENCE", message);
}

function tooLarge(message: string) {
  return new RecoveryServiceError("REQUEST_TOO_LARGE", message);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
