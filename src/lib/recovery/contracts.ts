export const decisions = ["KEEP", "MONITOR", "DOWNGRADE", "CANCEL", "INVESTIGATE"] as const;
export type Decision = (typeof decisions)[number];

export const cadences = [
  "WEEKLY",
  "BIWEEKLY",
  "SEMIMONTHLY",
  "MONTHLY",
  "BIMONTHLY",
  "QUARTERLY",
  "YEARLY",
  "IRREGULAR",
] as const;
export type Cadence = (typeof cadences)[number];

export const sourceTypes = ["RECEIPT_PASTE", "CSV_IMPORT", "FORWARDED_EMAIL"] as const;
export type SourceType = (typeof sourceTypes)[number];

export const receiptInboxAliasStates = ["ACTIVE", "ROTATED", "REVOKED"] as const;
export type ReceiptInboxAliasState = (typeof receiptInboxAliasStates)[number];

export const receiptInboxUpdateStates = ["UNAVAILABLE", "NOT_PROVISIONED", "WAITING", "RECEIVED", "PROCESSING", "READY", "FAILED", "REVOKED"] as const;
export type ReceiptInboxUpdateState = (typeof receiptInboxUpdateStates)[number];

export const commitmentStatuses = ["ACTIVE", "NOT_RECURRING"] as const;
export type CommitmentStatus = (typeof commitmentStatuses)[number];

export const confidenceStates = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
export type ConfidenceState = (typeof confidenceStates)[number];

export const correctionFields = ["MERCHANT", "AMOUNT", "NEXT_EXPECTED_DATE", "CADENCE", "IS_RECURRING"] as const;
export type CorrectionField = (typeof correctionFields)[number];

export const correctionStatuses = ["ACTIVE", "REVERSED", "SUPERSEDED"] as const;
export type CorrectionStatus = (typeof correctionStatuses)[number];

export const changeKinds = ["ADDED", "MERCHANT", "AMOUNT", "DATE", "CADENCE", "RECURRING_CLASSIFICATION"] as const;
export type ChangeKind = (typeof changeKinds)[number];

export const attentionReasons = ["DECISION_REQUIRED", "RENEWS_SOON", "LOW_CONFIDENCE", "PRICE_INCREASE", "EVIDENCE_CONFLICT"] as const;
export type AttentionReason = (typeof attentionReasons)[number];

export const coverageStates = ["NO_EVIDENCE", "BASELINE_ONLY", "PARTIAL", "CURRENT", "STALE"] as const;
export type CoverageState = (typeof coverageStates)[number];

export const evidenceProvenanceKinds = ["USER_SUBMITTED", "PROVIDER_RECEIVED"] as const;
export type EvidenceProvenanceKind = (typeof evidenceProvenanceKinds)[number];

export const recoveryErrorCodes = [
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_EVIDENCE",
  "PARSE_FAILED",
  "DUPLICATE_EVIDENCE",
  "DATABASE_UNAVAILABLE",
  "CONFLICT",
  "STALE_STATE",
  "SAVE_FAILED",
  "REQUEST_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "FEATURE_UNAVAILABLE",
  "RATE_LIMITED",
  "UNKNOWN",
] as const;
export type RecoveryErrorCode = (typeof recoveryErrorCodes)[number];

export const recoveryLimits = {
  maxReceiptSnippets: 25,
  maxReceiptCharacters: 20_000,
  maxCsvSources: 6,
  maxCsvCharactersPerSource: 2_000_000,
  maxRequestBytes: 12 * 1024 * 1024,
  maxEvidenceExcerptCharacters: 500,
  maxCommitmentEvidencePageSize: 50,
  maxWorkspaceEvidenceRecords: 20_000,
} as const;

export const recoveryErrorStatusByCode = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_EVIDENCE: 400,
  PARSE_FAILED: 422,
  DUPLICATE_EVIDENCE: 409,
  DATABASE_UNAVAILABLE: 503,
  CONFLICT: 409,
  STALE_STATE: 412,
  SAVE_FAILED: 502,
  REQUEST_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  FEATURE_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
  UNKNOWN: 500,
} as const satisfies Record<RecoveryErrorCode, number>;

export type MoneyDto = {
  currency: string;
  minor: string;
  exponent: number;
  display: string;
};

export type NonEmptyIds = readonly [string, ...string[]];

export type ProjectionTotalDto = {
  amount: MoneyDto;
  commitmentIds: NonEmptyIds;
  evidenceIds: NonEmptyIds;
};

export type ConfidenceDto = {
  state: ConfidenceState;
  score: number | null;
  scale: "PERCENT_0_100";
  reasons: readonly string[];
};

export type WorkspaceDto = {
  id: string;
  name: string;
  role: "owner" | "admin" | "member" | "viewer";
  version: number;
};

export type SourceDto = {
  id: string;
  type: SourceType;
  label: string;
  ingestedAt: string;
  coverageStart: string | null;
  coverageEnd: string | null;
};

export type EvidenceDto = {
  id: string;
  source: SourceDto;
  immutable: true;
  observedAt: string | null;
  excerpt: string;
  excerptTruncated: boolean;
  amount: MoneyDto | null;
  date: string | null;
  provenance: {
    kind: EvidenceProvenanceKind;
    reference: string;
  };
  confidence: ConfidenceDto;
};

export type DecisionDto = {
  value: Decision;
  decidedAt: string;
  updatedAt: string;
};

type CorrectionBaseDto = {
  id: string;
  commitmentId: string;
  patch: CorrectionPatch;
  authoritativeAmount: MoneyDto | null;
  reason: string | null;
  createdAt: string;
};

export type CorrectionPatch =
  | { field: "MERCHANT"; value: { merchant: string } }
  | { field: "AMOUNT"; value: { amountMinor: string } }
  | { field: "NEXT_EXPECTED_DATE"; value: { date: string } }
  | { field: "CADENCE"; value: { cadence: Cadence } }
  | { field: "IS_RECURRING"; value: { isRecurring: boolean } };

export type CorrectionDto =
  | CorrectionBaseDto & { status: "ACTIVE"; reversedAt: null; supersededAt: null }
  | CorrectionBaseDto & { status: "REVERSED"; reversedAt: string; supersededAt: null }
  | CorrectionBaseDto & { status: "SUPERSEDED"; reversedAt: null; supersededAt: string };

export type CommitmentSummaryDto = {
  id: string;
  version: number;
  status: CommitmentStatus;
  merchant: string;
  category: string;
  cadence: Cadence;
  amount: MoneyDto;
  monthlyEquivalent: MoneyDto;
  nextExpectedDate: string | null;
  confidence: ConfidenceDto;
  recommendedDecision: Decision;
  decision: DecisionDto | null;
  evidenceCount: number;
  updatedAt: string;
};

export type CommitmentDetailDto = CommitmentSummaryDto & {
  recommendationReason: string;
  riskTags: readonly string[];
  evidence: {
    items: readonly EvidenceDto[];
    total: number;
    nextCursor: string | null;
  };
  corrections: readonly CorrectionDto[];
};

export type AttentionItemDto = {
  id: string;
  commitmentId: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  reason: AttentionReason;
  title: string;
  detail: string;
  amount: MoneyDto | null;
  dueDate: string | null;
  evidenceIds: NonEmptyIds;
};

type ChangeItemBaseDto = {
  id: string;
  commitmentId: string;
  merchant: string;
  detectedAt: string;
  provenance:
    | { kind: "EVIDENCE"; submissionId: string; evidenceIds: NonEmptyIds }
    | { kind: "CORRECTION"; correctionId: string; evidenceIds: readonly [] }
    | { kind: "CORRECTION_REVERSAL"; correctionId: string; evidenceIds: readonly [] };
};

export type ChangeItemDto =
  | ChangeItemBaseDto & {
      kind: "ADDED";
      before: null;
      after: { merchant: string; amount: MoneyDto; date: string | null; cadence: Cadence };
    }
  | ChangeItemBaseDto & { kind: "MERCHANT"; before: string; after: string }
  | ChangeItemBaseDto & { kind: "AMOUNT"; before: MoneyDto; after: MoneyDto }
  | ChangeItemBaseDto & { kind: "DATE"; before: string | null; after: string | null }
  | ChangeItemBaseDto & { kind: "CADENCE"; before: Cadence; after: Cadence }
  | ChangeItemBaseDto & { kind: "RECURRING_CLASSIFICATION"; before: CommitmentStatus; after: CommitmentStatus };

export type UpcomingItemDto = {
  commitmentId: string;
  merchant: string;
  date: string;
  daysAway: number;
  amount: MoneyDto;
  decision: DecisionDto | null;
  confidence: ConfidenceDto;
  reminderEligible: boolean;
  evidenceIds: NonEmptyIds;
};

export type CoverageDto = {
  state: CoverageState;
  sourceCount: number;
  evidenceCount: number;
  lastEvidenceAt: string | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  limitations: readonly string[];
};

export type HomeChangedDto =
  | {
      state: "NO_PRIOR_BASELINE";
      fromVersion: null;
      toVersion: number;
      items: readonly [];
    }
  | {
      state: "COMPARED";
      fromVersion: number;
      toVersion: number;
      items: readonly ChangeItemDto[];
    };

export type HomeProjectionDto = {
  workspace: WorkspaceDto;
  generatedAt: string;
  monthlyTotals: readonly ProjectionTotalDto[];
  next30DayTotals: readonly ProjectionTotalDto[];
  needsMe: readonly AttentionItemDto[];
  changed: HomeChangedDto;
  next: readonly UpcomingItemDto[];
  coverage: CoverageDto;
};

export type RecoverySessionResponse =
  | {
      authenticated: false;
      configuration: { status: "ready" | "not-configured"; cookieName: string };
      session: null;
    }
  | {
      authenticated: true;
      configuration: { status: "ready"; cookieName: string };
      session: {
        userId: string;
        email: string;
        workspaceId: string;
        expiresAt: string;
      };
    };

export type RecoveryCutoverStatus = {
  status: "CLEAR" | "LEGACY_DATA_REQUIRES_MIGRATION";
  counts: {
    workspaceSnapshots: number;
    recurringItems: number;
    evidenceLinks: number;
    decisions: number;
    transactions: number;
    dataSources: number;
    connectorEvidence: number;
    connectedAccounts: number;
  };
};

export type ReceiptInboxAliasDto = {
  id: string;
  status: ReceiptInboxAliasState;
  address: string;
  createdAt: string;
  rotatedAt: string | null;
  revokedAt: string | null;
};

export type ReceiptInboxStatusDto = {
  state: ReceiptInboxUpdateState;
  alias: ReceiptInboxAliasDto | null;
  lastReceivedAt: string | null;
  lastProcessedAt: string | null;
  lastFailureCode: string | null;
};

export type EvidenceIngestRequest =
  | {
      kind: "RECEIPT_PASTE";
      receipts: readonly { clientRef: string; text: string }[];
    }
  | {
      kind: "CSV_IMPORT";
      sources: readonly { clientRef: string; name: string; text: string }[];
    };

export type ForwardedEmailMaterializationRequest = {
  kind: "FORWARDED_EMAIL";
  receipts: readonly { clientRef: string; text: string }[];
};

export type PreparedImportSourceDto = {
  name: string;
  text: string;
  kind: "csv" | "pdf" | "spreadsheet";
  rowCount: number;
  warnings: readonly string[];
  extractedTextPreview?: string;
};

export type PrepareImportResponse = {
  mode: "stateless-ingestion-api";
  storage: "none";
  sources: readonly PreparedImportSourceDto[];
};

export type GoogleStartResponse =
  | { status: "ready"; provider: "google-auth"; authUrl: string }
  | {
      status: "not-available";
      provider: "google-auth";
      availability: "company-activation-pending";
      message: string;
    };

export type LogoutResponse =
  | { status: "signed-out"; revoked: boolean }
  | { status: "revocation-pending"; revoked: false };

export type EvidenceSubmissionDto = {
  id: string;
  type: SourceType;
  ingestedAt: string;
  acceptedEvidenceCount: number;
  results: readonly (
    | { clientRef: string; status: "ACCEPTED"; code: null; message: null }
    | { clientRef: string; status: "REJECTED"; code: "INVALID_EVIDENCE" | "PARSE_FAILED" | "DUPLICATE_EVIDENCE"; message: string }
  )[];
};

export type CreateCorrectionRequest = {
  patch: CorrectionPatch;
  reason?: string;
};

export type PutDecisionRequest = {
  commitmentId: string;
  decision: Decision;
};

export type ListCommitmentsQuery = {
  limit?: number;
  cursor?: string;
};

export type GetCommitmentQuery = {
  evidenceLimit?: number;
  evidenceCursor?: string;
};

type RecoveryErrorBase = {
  message: string;
  retryable: boolean;
  requestId: string;
};

export type RecoveryError =
  | RecoveryErrorBase & { code: "STALE_STATE"; currentVersion: number }
  | RecoveryErrorBase & { code: "RATE_LIMITED"; retryAfterSeconds: number; currentVersion?: never }
  | RecoveryErrorBase & { code: Exclude<RecoveryErrorCode, "STALE_STATE" | "RATE_LIMITED">; currentVersion?: never; retryAfterSeconds?: never };

export type ApiSuccess<T> = {
  data: T;
  meta: {
    requestId: string;
    workspaceVersion: number;
  };
};

export type ApiFailure = {
  error: RecoveryError;
};

export type SubmitEvidenceResponse = ApiSuccess<{
  submission: EvidenceSubmissionDto;
  home: HomeProjectionDto;
  commitments: readonly CommitmentSummaryDto[];
  commitmentTotal: number;
}>;

export type GetHomeResponse = ApiSuccess<HomeProjectionDto>;

export type ListCommitmentsResponse = ApiSuccess<{
  items: readonly CommitmentSummaryDto[];
  total: number;
  nextCursor: string | null;
}>;

export type GetCommitmentResponse = ApiSuccess<CommitmentDetailDto>;

export type GetEvidenceResponse = ApiSuccess<EvidenceDto>;

export type CreateCorrectionResponse = ApiSuccess<{
  correction: CorrectionDto;
  commitment: CommitmentDetailDto;
  home: HomeProjectionDto;
}>;

export type ReverseCorrectionResponse = CreateCorrectionResponse;

export type PutDecisionResponse = ApiSuccess<{
  decision: DecisionDto;
  commitment: CommitmentSummaryDto;
  home: HomeProjectionDto;
}>;

export type ListDecisionsResponse = ApiSuccess<{
  decisions: readonly (DecisionDto & { commitmentId: string })[];
}>;

export type WorkspaceVersionTag = `"workspace:${number}"`;

export type RecoveryMutationHeaders = {
  "Content-Type": "application/json";
  "Idempotency-Key": string;
  "If-Match": WorkspaceVersionTag;
};

export type ReceiptInboxRotationHeaders = {
  "Idempotency-Key": string;
  "If-Match": string;
};

export type RecoveryEndpointContracts = {
  guestAudit: { ownership: "LEGACY_PATH_ONLY"; request: never; response: never; headers: never };
  prepareImport: { ownership: "RECOVERY_V1"; request: FormData; response: PrepareImportResponse | ApiFailure; headers: never };
  session: { ownership: "RECOVERY_V1"; request: never; response: RecoverySessionResponse | ApiFailure; headers: never };
  googleStart: { ownership: "RECOVERY_V1"; request: { next: string }; response: GoogleStartResponse; headers: never };
  logout: { ownership: "RECOVERY_V1"; request: never; response: LogoutResponse | ApiFailure; headers: never };
  submitEvidence: { ownership: "RECOVERY_V1"; request: EvidenceIngestRequest; response: SubmitEvidenceResponse | ApiFailure; headers: RecoveryMutationHeaders };
  home: { ownership: "RECOVERY_V1"; request: never; response: GetHomeResponse | ApiFailure; headers: never };
  evidence: { ownership: "RECOVERY_V1"; request: never; response: GetEvidenceResponse | ApiFailure; headers: never };
  commitments: { ownership: "RECOVERY_V1"; request: ListCommitmentsQuery; response: ListCommitmentsResponse | ApiFailure; headers: never };
  commitment: { ownership: "RECOVERY_V1"; request: GetCommitmentQuery; response: GetCommitmentResponse | ApiFailure; headers: never };
  createCorrection: { ownership: "RECOVERY_V1"; request: CreateCorrectionRequest; response: CreateCorrectionResponse | ApiFailure; headers: RecoveryMutationHeaders };
  reverseCorrection: { ownership: "RECOVERY_V1"; request: never; response: ReverseCorrectionResponse | ApiFailure; headers: RecoveryMutationHeaders };
  decisions: { ownership: "RECOVERY_V1"; request: never; response: ListDecisionsResponse | ApiFailure; headers: never };
  decision: { ownership: "RECOVERY_V1"; request: PutDecisionRequest; response: PutDecisionResponse | ApiFailure; headers: RecoveryMutationHeaders };
  sources: { ownership: "RECOVERY_V1"; request: never; response: ApiSuccess<ReceiptInboxStatusDto> | ApiFailure; headers: never };
  receiptInbox: { ownership: "RECOVERY_V1"; request: never; response: ApiSuccess<ReceiptInboxStatusDto> | ApiFailure; headers: never };
  rotateReceiptInbox: { ownership: "RECOVERY_V1"; request: never; response: ApiSuccess<ReceiptInboxStatusDto> | ApiFailure; headers: ReceiptInboxRotationHeaders };
  revokeReceiptInbox: { ownership: "RECOVERY_V1"; request: never; response: ApiSuccess<ReceiptInboxStatusDto> | ApiFailure; headers: never };
};

const encodePathSegment = (value: string) => encodeURIComponent(value);

export const recoveryEndpoints = {
  guestAudit: { method: "POST", path: "/api/audit" },
  prepareImport: { method: "POST", path: "/api/ingest" },
  session: { method: "GET", path: "/api/auth/session" },
  googleStart: (next: string) => ({ method: "GET" as const, path: `/api/auth/google/start?mode=json&next=${encodePathSegment(next)}` }),
  logout: { method: "POST", path: "/api/auth/logout" },
  submitEvidence: { method: "POST", path: "/api/workspaces/current/evidence" },
  home: { method: "GET", path: "/api/workspaces/current/brief" },
  evidence: (evidenceId: string) => ({
    method: "GET" as const,
    path: `/api/workspaces/current/evidence/${encodePathSegment(evidenceId)}`,
  }),
  commitments: { method: "GET", path: "/api/workspaces/current/commitments" },
  commitment: (commitmentId: string) => ({
    method: "GET" as const,
    path: `/api/workspaces/current/commitments/${encodePathSegment(commitmentId)}`,
  }),
  createCorrection: (commitmentId: string) => ({
    method: "POST" as const,
    path: `/api/workspaces/current/commitments/${encodePathSegment(commitmentId)}/corrections`,
  }),
  reverseCorrection: (commitmentId: string, correctionId: string) => ({
    method: "DELETE" as const,
    path: `/api/workspaces/current/commitments/${encodePathSegment(commitmentId)}/corrections/${encodePathSegment(correctionId)}`,
  }),
  decisions: { method: "GET", path: "/api/workspaces/current/decisions" },
  decision: { method: "PUT", path: "/api/workspaces/current/decisions" },
  sources: { method: "GET", path: "/api/workspaces/current/sources" },
  receiptInbox: { method: "POST", path: "/api/workspaces/current/sources/receipt-inbox" },
  rotateReceiptInbox: { method: "POST", path: "/api/workspaces/current/sources/receipt-inbox/rotate" },
  revokeReceiptInbox: { method: "DELETE", path: "/api/workspaces/current/sources/receipt-inbox" },
} as const;
