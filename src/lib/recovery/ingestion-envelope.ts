import {
  recoveryLimits,
  type EvidenceProvenanceKind,
  type SourceType,
} from "@/lib/recovery/contracts";

export const activeRecoveryCaptureSourceTypes = ["RECEIPT_PASTE", "CSV_IMPORT", "FORWARDED_EMAIL"] as const;
export type ActiveRecoveryCaptureSourceType = (typeof activeRecoveryCaptureSourceTypes)[number];

export const reservedRecoveryCaptureSourceTypes = ["GMAIL_OAUTH"] as const;
export type ReservedRecoveryCaptureSourceType = (typeof reservedRecoveryCaptureSourceTypes)[number];

export type RecoveryIngestionEnvelope = {
  workspaceId: string;
  sourceType: SourceType;
  provenanceKind: EvidenceProvenanceKind;
  idempotencyKey: string;
  capturedAt: string;
  coverageStart: string | null;
  coverageEnd: string | null;
  consentReference: string | null;
  requestHash: string;
};

export class RecoveryCaptureNotReadyError extends Error {
  readonly sourceType: SourceType;
  readonly code = "CAPTURE_NOT_READY" as const;

  constructor(sourceType: SourceType, message: string) {
    super(message);
    this.name = "RecoveryCaptureNotReadyError";
    this.sourceType = sourceType;
  }
}

export function provenanceForSourceType(sourceType: SourceType): EvidenceProvenanceKind {
  return sourceType === "RECEIPT_PASTE" || sourceType === "CSV_IMPORT"
    ? "USER_SUBMITTED"
    : "PROVIDER_RECEIVED";
}

export function isActiveRecoveryCaptureSource(sourceType: SourceType): sourceType is ActiveRecoveryCaptureSourceType {
  return (activeRecoveryCaptureSourceTypes as readonly string[]).includes(sourceType);
}

export function isReservedRecoveryCaptureSource(sourceType: SourceType): sourceType is ReservedRecoveryCaptureSourceType {
  return (reservedRecoveryCaptureSourceTypes as readonly string[]).includes(sourceType);
}

export function gmailOauthCaptureBlockReason(): string {
  return "Gmail OAuth is reserved as a Recovery source and stays disabled until restricted-scope verification, CASA, and a Recovery-native materializer are proven. The retired living-ledger Gmail adapter must not be revived.";
}

export function buildRecoveryIngestionEnvelope(input: {
  workspaceId: string;
  sourceType: SourceType;
  idempotencyKey: string;
  requestHash: string;
  capturedAt: string;
  coverageStart?: string | null;
  coverageEnd?: string | null;
  consentReference?: string | null;
}): RecoveryIngestionEnvelope {
  assertActiveRecoveryCapture(input.sourceType);
  if (!input.workspaceId.trim()) throw new RecoveryCaptureNotReadyError(input.sourceType, "A workspace is required.");
  if (!input.idempotencyKey.trim()) throw new RecoveryCaptureNotReadyError(input.sourceType, "An idempotency key is required.");
  if (!input.requestHash.trim()) throw new RecoveryCaptureNotReadyError(input.sourceType, "A request hash is required.");
  if (input.idempotencyKey.length > 200) throw new RecoveryCaptureNotReadyError(input.sourceType, "The idempotency key is too long.");
  return {
    workspaceId: input.workspaceId,
    sourceType: input.sourceType,
    provenanceKind: provenanceForSourceType(input.sourceType),
    idempotencyKey: input.idempotencyKey,
    capturedAt: input.capturedAt,
    coverageStart: input.coverageStart ?? null,
    coverageEnd: input.coverageEnd ?? null,
    consentReference: input.consentReference ?? null,
    requestHash: input.requestHash,
  };
}

export function assertActiveRecoveryCapture(sourceType: SourceType): asserts sourceType is ActiveRecoveryCaptureSourceType {
  if (isReservedRecoveryCaptureSource(sourceType)) {
    throw new RecoveryCaptureNotReadyError(sourceType, gmailOauthCaptureBlockReason());
  }
  if (!isActiveRecoveryCaptureSource(sourceType)) {
    throw new RecoveryCaptureNotReadyError(sourceType, "That capture source is not an active Recovery ingestion path.");
  }
}

export function boundedExcerpt(text: string): string {
  return text.length <= recoveryLimits.maxEvidenceExcerptCharacters
    ? text
    : text.slice(0, recoveryLimits.maxEvidenceExcerptCharacters);
}
