import type {
  Cadence,
  CommitmentDetailDto,
  CommitmentSummaryDto,
  CorrectionField,
  CorrectionPatch,
  Decision,
  DecisionDto,
  EvidenceSubmissionDto,
  HomeProjectionDto,
  RecoveryError,
  ReceiptInboxStatusDto,
  RecoverySessionResponse,
  SourceType,
} from "@/lib/recovery/contracts";
import { decisionLabels } from "./labels";
import type { FailureOrigin, ResponseMeta, TransportFailure } from "./transport";
import { decimalToMinorUnits, minorUnitsToDecimal } from "@/lib/recovery/domain";

// Pure state for the Recovery workspace. It holds exactly two things: server
// payloads stored verbatim, and the client-only facts the UI is allowed to own
// (draft input, selection, dialogs, focus, pending mutation, rollback metadata).
// It never derives recurrence, totals, confidence, ordering, or exposure.

export const recoveryViews = ["HOME", "ATTENTION", "COMMITMENTS", "ADD_EVIDENCE", "MANDATE"] as const;
export type RecoveryView = (typeof recoveryViews)[number];

export const recoveryViewLabels: Record<RecoveryView, string> = {
  HOME: "Home",
  ATTENTION: "Attention",
  COMMITMENTS: "Subscriptions",
  ADD_EVIDENCE: "Sources",
  MANDATE: "Mandate",
};

export type RecoveryFailure = { error: RecoveryError; origin: FailureOrigin };

export type LoadState =
  | { kind: "IDLE" }
  | { kind: "LOADING" }
  | { kind: "READY" }
  | { kind: "AUTH_REQUIRED" }
  | { kind: "FAILED"; failure: RecoveryFailure };

export type PreparedCsvSource = {
  clientRef: string;
  name: string;
  text: string;
  rowCount: number;
  warnings: readonly string[];
};

export type EvidenceDraft = {
  mode: SourceType;
  receiptText: string;
  csvSources: readonly PreparedCsvSource[];
  preparing: boolean;
};

export type CorrectionDraft = {
  field: CorrectionField;
  merchant: string;
  amountMinor: string;
  amountCurrency: string;
  date: string;
  cadence: Cadence;
  isRecurring: boolean;
  reason: string;
};

export type RecoveryDialog =
  | { kind: "EVIDENCE_INSPECTOR"; commitmentId: string | null; evidenceId: string }
  | { kind: "CORRECTION"; commitmentId: string; field: CorrectionField };

export type PendingMutation =
  | { kind: "EVIDENCE"; idempotencyKey: string }
  | { kind: "DECISION"; idempotencyKey: string; commitmentId: string; decision: Decision; previous: DecisionDto | null }
  | { kind: "CORRECTION"; idempotencyKey: string; commitmentId: string; field: CorrectionField }
  | { kind: "CORRECTION_REVERSAL"; idempotencyKey: string; commitmentId: string; correctionId: string }
  | { kind: "MANDATE_SIGN"; idempotencyKey: string }
  | { kind: "MANDATE_REVOKE"; idempotencyKey: string }
  | { kind: "CANDIDATE_VETO"; idempotencyKey: string; candidateId: string }
  | { kind: "SOURCE_DISCONNECT"; idempotencyKey: string; sourceId: string }
  | { kind: "SOURCE_RECONNECT"; idempotencyKey: string; sourceId: string };

export type RollbackNotice = { mutation: PendingMutation; failure: RecoveryFailure };

export type RecoveryState = {
  view: RecoveryView;
  online: boolean;
  session: RecoverySessionResponse | null;
  status: LoadState;
  detailStatus: LoadState;
  sourceStatus: LoadState;
  receiptInbox: ReceiptInboxStatusDto | null;
  pendingSourceAction: "PROVISION" | "ROTATE" | "REVOKE" | null;
  workspaceVersion: number | null;
  requestId: string | null;
  home: HomeProjectionDto | null;
  commitments: readonly CommitmentSummaryDto[];
  commitmentTotal: number;
  commitmentsCursor: string | null;
  selectedCommitmentId: string | null;
  detail: CommitmentDetailDto | null;
  detailEvidenceCursor: string | null;
  detailRefreshToken: number;
  dialog: RecoveryDialog | null;
  returnFocusId: string | null;
  evidenceDraft: EvidenceDraft;
  correctionDraft: CorrectionDraft;
  pending: PendingMutation | null;
  rollback: RollbackNotice | null;
  submission: EvidenceSubmissionDto | null;
  evidenceFailure: RecoveryFailure | null;
  refreshRequired: boolean;
  announcement: string;
};

const emptyEvidenceDraft: EvidenceDraft = {
  mode: "RECEIPT_PASTE",
  receiptText: "",
  csvSources: [],
  preparing: false,
};

const emptyCorrectionDraft: CorrectionDraft = {
  field: "MERCHANT",
  merchant: "",
  amountMinor: "",
  amountCurrency: "INR",
  date: "",
  cadence: "MONTHLY",
  isRecurring: true,
  reason: "",
};

export const initialRecoveryState: RecoveryState = {
  view: "HOME",
  online: true,
  session: null,
  status: { kind: "LOADING" },
  detailStatus: { kind: "IDLE" },
  sourceStatus: { kind: "IDLE" },
  receiptInbox: null,
  pendingSourceAction: null,
  workspaceVersion: null,
  requestId: null,
  home: null,
  commitments: [],
  commitmentTotal: 0,
  commitmentsCursor: null,
  selectedCommitmentId: null,
  detail: null,
  detailEvidenceCursor: null,
  detailRefreshToken: 0,
  dialog: null,
  returnFocusId: null,
  evidenceDraft: emptyEvidenceDraft,
  correctionDraft: emptyCorrectionDraft,
  pending: null,
  rollback: null,
  submission: null,
  evidenceFailure: null,
  refreshRequired: false,
  announcement: "",
};

export type RecoveryAction =
  | { type: "NETWORK_CHANGED"; online: boolean }
  | { type: "SESSION_RESOLVED"; session: RecoverySessionResponse }
  | { type: "SNAPSHOT_REQUESTED" }
  | { type: "SNAPSHOT_LOADED"; home: HomeProjectionDto; commitments: readonly CommitmentSummaryDto[]; total: number; nextCursor: string | null; meta: ResponseMeta }
  | { type: "COMMITMENTS_PAGE_APPENDED"; items: readonly CommitmentSummaryDto[]; total: number; nextCursor: string | null; meta: ResponseMeta }
  | { type: "SNAPSHOT_FAILED"; failure: TransportFailure }
  | { type: "VIEW_SELECTED"; view: RecoveryView }
  | { type: "COMMITMENT_SELECTED"; commitmentId: string | null }
  | { type: "DETAIL_EVIDENCE_PAGE_REQUESTED"; cursor: string | null }
  | { type: "DETAIL_LOADED"; detail: CommitmentDetailDto; meta: ResponseMeta }
  | { type: "DETAIL_FAILED"; failure: TransportFailure }
  | { type: "SOURCES_REQUESTED" }
  | { type: "SOURCES_LOADED"; receiptInbox: ReceiptInboxStatusDto; meta: ResponseMeta }
  | { type: "SOURCES_FAILED"; failure: TransportFailure }
  | { type: "SOURCE_ACTION_STARTED"; action: "PROVISION" | "ROTATE" | "REVOKE" }
  | { type: "SOURCE_ACTION_SAVED"; receiptInbox: ReceiptInboxStatusDto; meta: ResponseMeta }
  | { type: "SOURCE_ACTION_FAILED"; failure: TransportFailure }
  | { type: "DIALOG_OPENED"; dialog: RecoveryDialog; returnFocusId: string | null }
  | { type: "DIALOG_CLOSED" }
  | { type: "EVIDENCE_MODE_SELECTED"; mode: SourceType }
  | { type: "RECEIPT_DRAFT_CHANGED"; text: string }
  | { type: "CSV_PREPARE_STARTED" }
  | { type: "CSV_SOURCES_PREPARED"; sources: readonly PreparedCsvSource[] }
  | { type: "CSV_SOURCE_REMOVED"; clientRef: string }
  | { type: "CSV_PREPARE_FAILED"; failure: TransportFailure }
  | { type: "EVIDENCE_SUBMIT_STARTED"; idempotencyKey: string }
  | { type: "EVIDENCE_SUBMITTED"; submission: EvidenceSubmissionDto; home: HomeProjectionDto; commitments: readonly CommitmentSummaryDto[]; total: number; meta: ResponseMeta }
  | { type: "EVIDENCE_SUBMIT_FAILED"; failure: TransportFailure }
  | { type: "DECISION_STARTED"; commitmentId: string; decision: Decision; previous: DecisionDto | null; idempotencyKey: string }
  | { type: "DECISION_SAVED"; commitment: CommitmentSummaryDto; home: HomeProjectionDto; meta: ResponseMeta }
  | { type: "CORRECTION_DRAFT_CHANGED"; draft: Partial<CorrectionDraft> }
  | { type: "CORRECTION_STARTED"; commitmentId: string; field: CorrectionField; idempotencyKey: string }
  | { type: "CORRECTION_REVERSAL_STARTED"; commitmentId: string; correctionId: string; idempotencyKey: string }
  | { type: "CORRECTION_SAVED"; detail: CommitmentDetailDto; home: HomeProjectionDto; meta: ResponseMeta }
  | { type: "MUTATION_FAILED"; failure: TransportFailure }
  | { type: "ROLLBACK_DISMISSED" }
  | { type: "MANDATE_STARTED"; action: "SIGN" | "REVOKE"; idempotencyKey: string }
  | { type: "VETO_STARTED"; candidateId: string; idempotencyKey: string }
  | { type: "EVIDENCE_SOURCE_STARTED"; action: "DISCONNECT" | "RECONNECT"; sourceId: string; idempotencyKey: string };

const authRequired = (failure: TransportFailure) => failure.error.code === "AUTH_REQUIRED";
const needsReload = (failure: TransportFailure) => failure.error.code === "STALE_STATE" || failure.error.code === "CONFLICT";
const asFailure = (failure: TransportFailure): RecoveryFailure => ({ error: failure.error, origin: failure.origin });

function replaceCommitment(commitments: readonly CommitmentSummaryDto[], next: CommitmentSummaryDto) {
  // Server order is authoritative: the updated row is swapped in place, never re-sorted.
  const index = commitments.findIndex((item) => item.id === next.id);
  if (index < 0) return commitments;
  return [...commitments.slice(0, index), next, ...commitments.slice(index + 1)];
}

function correctionDraftFor(field: CorrectionField, detail: CommitmentDetailDto | null): CorrectionDraft {
  if (!detail) return { ...emptyCorrectionDraft, field };
  return {
    field,
    merchant: detail.merchant,
    amountMinor: minorUnitsToDecimal(detail.amount.minor, detail.amount.exponent),
    amountCurrency: detail.amount.currency,
    date: detail.nextExpectedDate ?? "",
    cadence: detail.cadence,
    isRecurring: detail.status === "ACTIVE",
    reason: "",
  };
}

export function correctionPatchFromDraft(draft: CorrectionDraft): CorrectionPatch | null {
  switch (draft.field) {
    case "MERCHANT": {
      const merchant = draft.merchant.trim();
      return merchant ? { field: "MERCHANT", value: { merchant } } : null;
    }
    case "AMOUNT": {
      try {
        return { field: "AMOUNT", value: { amountMinor: decimalToMinorUnits(draft.amountMinor.trim(), draft.amountCurrency) } };
      } catch {
        return null;
      }
    }
    case "NEXT_EXPECTED_DATE":
      return /^\d{4}-\d{2}-\d{2}$/.test(draft.date) ? { field: "NEXT_EXPECTED_DATE", value: { date: draft.date } } : null;
    case "CADENCE":
      return { field: "CADENCE", value: { cadence: draft.cadence } };
    case "IS_RECURRING":
      return { field: "IS_RECURRING", value: { isRecurring: draft.isRecurring } };
  }
}

export function evidenceRequestFromDraft(draft: EvidenceDraft, mode: SourceType) {
  if (mode === "RECEIPT_PASTE") {
    const text = draft.receiptText.trim();
    return text ? ({ kind: "RECEIPT_PASTE", receipts: [{ clientRef: "receipt-paste-1", text }] } as const) : null;
  }
  return draft.csvSources.length
    ? ({ kind: "CSV_IMPORT", sources: draft.csvSources.map(({ clientRef, name, text }) => ({ clientRef, name, text })) } as const)
    : null;
}

export function recoveryReducer(state: RecoveryState, action: RecoveryAction): RecoveryState {
  switch (action.type) {
    case "NETWORK_CHANGED":
      if (action.online === state.online) return state;
      return {
        ...state,
        online: action.online,
        announcement: action.online ? "Back online." : "Offline. Saved workspace data cannot be reached until the connection returns.",
      };

    case "SESSION_RESOLVED":
      return action.session.authenticated
        ? { ...state, session: action.session }
        : { ...state, session: action.session, status: { kind: "AUTH_REQUIRED" }, announcement: "Sign in required." };

    case "SNAPSHOT_REQUESTED":
      return { ...state, status: state.home ? state.status : { kind: "LOADING" } };

    case "SNAPSHOT_LOADED":
      {
      const refreshSelectedDetail = state.selectedCommitmentId !== null && state.detail === null;
      const pendingKind = state.pending?.kind;
      const clearMandatePending = pendingKind === "MANDATE_SIGN"
        || pendingKind === "MANDATE_REVOKE"
        || pendingKind === "CANDIDATE_VETO"
        || pendingKind === "SOURCE_DISCONNECT"
        || pendingKind === "SOURCE_RECONNECT";
      return {
        ...state,
        pending: clearMandatePending ? null : state.pending,
        status: { kind: "READY" },
        home: action.home,
        commitments: action.commitments,
        commitmentTotal: action.total,
        detailStatus: refreshSelectedDetail ? { kind: "LOADING" } : state.detailStatus,
        detailRefreshToken: refreshSelectedDetail ? state.detailRefreshToken + 1 : state.detailRefreshToken,
        commitmentsCursor: action.nextCursor,
        workspaceVersion: action.meta.workspaceVersion,
        requestId: action.meta.requestId,
        refreshRequired: false,
        announcement: "Workspace loaded from your saved evidence.",
      };
      }

    case "COMMITMENTS_PAGE_APPENDED":
      if (state.workspaceVersion !== null && action.meta.workspaceVersion !== state.workspaceVersion) {
        return {
          ...state,
          refreshRequired: true,
          announcement: "The commitments page belongs to another saved workspace version. Reload before continuing.",
        };
      }
      // Cursor pages arrive in the server's own sequence, so appending preserves it.
      return {
        ...state,
        commitments: [...state.commitments, ...action.items],
        commitmentTotal: action.total,
        commitmentsCursor: action.nextCursor,
        workspaceVersion: action.meta.workspaceVersion,
        announcement: `${action.items.length} more commitment${action.items.length === 1 ? "" : "s"} loaded.`,
      };

    case "SNAPSHOT_FAILED":
      {
      const pendingKind = state.pending?.kind;
      const clearMandatePending = pendingKind === "MANDATE_SIGN"
        || pendingKind === "MANDATE_REVOKE"
        || pendingKind === "CANDIDATE_VETO"
        || pendingKind === "SOURCE_DISCONNECT"
        || pendingKind === "SOURCE_RECONNECT";
      return {
        ...state,
        pending: clearMandatePending ? null : state.pending,
        status: authRequired(action.failure) ? { kind: "AUTH_REQUIRED" } : { kind: "FAILED", failure: asFailure(action.failure) },
        announcement: action.failure.error.message,
      };
      }

    case "VIEW_SELECTED":
      return { ...state, view: action.view, announcement: `${recoveryViewLabels[action.view]} view.` };

    case "COMMITMENT_SELECTED":
      return {
        ...state,
        selectedCommitmentId: action.commitmentId,
        detail: null,
        detailEvidenceCursor: null,
        detailStatus: action.commitmentId ? { kind: "LOADING" } : { kind: "IDLE" },
      };

    case "DETAIL_EVIDENCE_PAGE_REQUESTED":
      return { ...state, detailEvidenceCursor: action.cursor, detailStatus: { kind: "LOADING" } };

    case "DETAIL_LOADED":
      if (state.workspaceVersion !== null && action.meta.workspaceVersion !== state.workspaceVersion) {
        return {
          ...state,
          detail: null,
          detailStatus: { kind: "IDLE" },
          refreshRequired: true,
          announcement: "The commitment detail belongs to another saved workspace version. Reload before continuing.",
        };
      }
      return {
        ...state,
        detail: action.detail,
        detailStatus: { kind: "READY" },
        workspaceVersion: action.meta.workspaceVersion,
      };

    case "DETAIL_FAILED":
      return {
        ...state,
        detailStatus: authRequired(action.failure) ? { kind: "AUTH_REQUIRED" } : { kind: "FAILED", failure: asFailure(action.failure) },
        announcement: action.failure.error.message,
      };

    case "SOURCES_REQUESTED":
      return {
        ...state,
        sourceStatus: state.receiptInbox ? state.sourceStatus : { kind: "LOADING" },
      };

    case "SOURCES_LOADED":
      {
      const versionChanged = state.workspaceVersion !== null && action.meta.workspaceVersion !== state.workspaceVersion;
      return {
        ...state,
        sourceStatus: { kind: "READY" },
        receiptInbox: action.receiptInbox,
        refreshRequired: state.refreshRequired || versionChanged,
        announcement: versionChanged
          ? "A receipt changed the saved workspace. Refreshing Home now."
          : "Source status loaded.",
      };
      }

    case "SOURCES_FAILED":
      return authRequired(action.failure) ? {
        ...state,
        status: { kind: "AUTH_REQUIRED" },
        sourceStatus: { kind: "AUTH_REQUIRED" },
        announcement: action.failure.error.message,
      } : {
        ...state,
        sourceStatus: { kind: "FAILED", failure: asFailure(action.failure) },
        announcement: action.failure.error.message,
      };

    case "SOURCE_ACTION_STARTED":
      return {
        ...state,
        pendingSourceAction: action.action,
        announcement: `${action.action === "PROVISION" ? "Creating" : action.action === "ROTATE" ? "Rotating" : "Stopping"} receipt address…`,
      };

    case "SOURCE_ACTION_SAVED":
      return {
        ...state,
        sourceStatus: { kind: "READY" },
        receiptInbox: action.receiptInbox,
        pendingSourceAction: null,
        announcement: "Receipt source updated.",
      };

    case "SOURCE_ACTION_FAILED":
      return authRequired(action.failure) ? {
        ...state,
        status: { kind: "AUTH_REQUIRED" },
        sourceStatus: { kind: "AUTH_REQUIRED" },
        pendingSourceAction: null,
        announcement: action.failure.error.message,
      } : {
        ...state,
        sourceStatus: { kind: "FAILED", failure: asFailure(action.failure) },
        pendingSourceAction: null,
        announcement: action.failure.error.message,
      };

    case "DIALOG_OPENED":
      return {
        ...state,
        dialog: action.dialog,
        returnFocusId: action.returnFocusId,
        correctionDraft: action.dialog.kind === "CORRECTION" ? correctionDraftFor(action.dialog.field, state.detail) : state.correctionDraft,
      };

    case "DIALOG_CLOSED":
      return { ...state, dialog: null, returnFocusId: null };

    case "EVIDENCE_MODE_SELECTED":
      return { ...state, evidenceDraft: { ...state.evidenceDraft, mode: action.mode }, evidenceFailure: null };

    case "RECEIPT_DRAFT_CHANGED":
      return { ...state, evidenceDraft: { ...state.evidenceDraft, receiptText: action.text } };

    case "CSV_PREPARE_STARTED":
      return { ...state, evidenceDraft: { ...state.evidenceDraft, preparing: true }, evidenceFailure: null };

    case "CSV_SOURCES_PREPARED":
      return {
        ...state,
        evidenceDraft: { ...state.evidenceDraft, preparing: false, csvSources: [...state.evidenceDraft.csvSources, ...action.sources] },
        announcement: `${action.sources.length} file${action.sources.length === 1 ? "" : "s"} ready to submit as evidence.`,
      };

    case "CSV_SOURCE_REMOVED":
      return {
        ...state,
        evidenceDraft: { ...state.evidenceDraft, csvSources: state.evidenceDraft.csvSources.filter((source) => source.clientRef !== action.clientRef) },
      };

    case "CSV_PREPARE_FAILED":
      return {
        ...state,
        evidenceDraft: { ...state.evidenceDraft, preparing: false },
        evidenceFailure: asFailure(action.failure),
        announcement: action.failure.error.message,
      };

    case "EVIDENCE_SUBMIT_STARTED":
      return {
        ...state,
        pending: { kind: "EVIDENCE", idempotencyKey: action.idempotencyKey },
        evidenceFailure: null,
        rollback: null,
        announcement: "Submitting evidence…",
      };

    case "EVIDENCE_SUBMITTED": {
      const everyResultAccepted = action.submission.results.every((result) => result.status === "ACCEPTED");
      const refreshSelectedDetail = state.selectedCommitmentId !== null;
      return {
        ...state,
        pending: null,
        submission: action.submission,
        home: action.home,
        commitments: action.commitments,
        commitmentTotal: action.total,
        detail: refreshSelectedDetail ? null : state.detail,
        detailStatus: refreshSelectedDetail ? { kind: "LOADING" } : state.detailStatus,
        detailRefreshToken: refreshSelectedDetail ? state.detailRefreshToken + 1 : state.detailRefreshToken,
        workspaceVersion: action.meta.workspaceVersion,
        requestId: action.meta.requestId,
        status: { kind: "READY" },
        refreshRequired: false,
        evidenceDraft: everyResultAccepted ? emptyEvidenceDraft : { ...state.evidenceDraft, preparing: false },
        announcement: evidenceSubmissionAnnouncement(action.submission),
      };
    }

    case "EVIDENCE_SUBMIT_FAILED":
      return {
        ...state,
        pending: null,
        evidenceFailure: asFailure(action.failure),
        status: authRequired(action.failure) ? { kind: "AUTH_REQUIRED" } : state.status,
        refreshRequired: state.refreshRequired || needsReload(action.failure),
        announcement: action.failure.error.message,
      };

    case "DECISION_STARTED":
      return {
        ...state,
        pending: { kind: "DECISION", idempotencyKey: action.idempotencyKey, commitmentId: action.commitmentId, decision: action.decision, previous: action.previous },
        rollback: null,
        announcement: `Saving ${decisionLabels[action.decision]}…`,
      };

    case "DECISION_SAVED":
      {
        const refreshSelectedDetail = state.selectedCommitmentId === action.commitment.id;
      return {
        ...state,
        pending: null,
        commitments: replaceCommitment(state.commitments, action.commitment),
        detail: refreshSelectedDetail ? null : state.detail,
        detailStatus: refreshSelectedDetail ? { kind: "LOADING" } : state.detailStatus,
        home: action.home,
        workspaceVersion: action.meta.workspaceVersion,
        requestId: action.meta.requestId,
        detailRefreshToken: refreshSelectedDetail ? state.detailRefreshToken + 1 : state.detailRefreshToken,
        announcement: action.commitment.decision
          ? `Saved. ${action.commitment.merchant} is now ${decisionLabels[action.commitment.decision.value]}.`
          : `Saved. ${action.commitment.merchant} has no recorded decision.`,
      };
          }

    case "CORRECTION_DRAFT_CHANGED":
      return { ...state, correctionDraft: { ...state.correctionDraft, ...action.draft } };

    case "CORRECTION_STARTED":
      return {
        ...state,
        pending: { kind: "CORRECTION", idempotencyKey: action.idempotencyKey, commitmentId: action.commitmentId, field: action.field },
        rollback: null,
        announcement: "Saving correction…",
      };

    case "CORRECTION_REVERSAL_STARTED":
      return {
        ...state,
        pending: { kind: "CORRECTION_REVERSAL", idempotencyKey: action.idempotencyKey, commitmentId: action.commitmentId, correctionId: action.correctionId },
        rollback: null,
        announcement: "Reversing correction…",
      };

    case "CORRECTION_SAVED":
      return {
        ...state,
        pending: null,
        dialog: null,
        commitments: replaceCommitment(state.commitments, action.detail),
        detail: action.detail,
        detailStatus: { kind: "READY" },
        home: action.home,
        workspaceVersion: action.meta.workspaceVersion,
        requestId: action.meta.requestId,
        announcement: "Correction saved. The workspace now shows the corrected values.",
      };

    case "MUTATION_FAILED":
      return {
        ...state,
        pending: null,
        rollback: state.pending ? { mutation: state.pending, failure: asFailure(action.failure) } : state.rollback,
        status: authRequired(action.failure) ? { kind: "AUTH_REQUIRED" } : state.status,
        refreshRequired: state.refreshRequired || needsReload(action.failure),
        announcement: `Not saved. ${action.failure.error.message}`,
      };

    case "ROLLBACK_DISMISSED":
      return { ...state, rollback: null };

    case "MANDATE_STARTED":
      return {
        ...state,
        pending: { kind: action.action === "SIGN" ? "MANDATE_SIGN" : "MANDATE_REVOKE", idempotencyKey: action.idempotencyKey },
        rollback: null,
        announcement: action.action === "SIGN" ? "Saving the standing mandate…" : "Revoking the standing mandate…",
      };

    case "VETO_STARTED":
      return {
        ...state,
        pending: { kind: "CANDIDATE_VETO", idempotencyKey: action.idempotencyKey, candidateId: action.candidateId },
        rollback: null,
        announcement: "Recording the veto…",
      };

    case "EVIDENCE_SOURCE_STARTED":
      return {
        ...state,
        pending: {
          kind: action.action === "DISCONNECT" ? "SOURCE_DISCONNECT" : "SOURCE_RECONNECT",
          idempotencyKey: action.idempotencyKey,
          sourceId: action.sourceId,
        },
        rollback: null,
        announcement: action.action === "DISCONNECT"
          ? "Disconnecting this evidence source…"
          : "Reconnecting this evidence source…",
      };
  }
}

function evidenceSubmissionAnnouncement(submission: EvidenceSubmissionDto) {
  const evidenceCount = submission.acceptedEvidenceCount;
  const submittedCount = submission.results.length;
  const submittedUnit = submission.type === "CSV_IMPORT" ? "file" : "receipt";
  return `Evidence submitted. ${evidenceCount} evidence item${evidenceCount === 1 ? "" : "s"} saved from ${submittedCount} submitted ${submittedUnit}${submittedCount === 1 ? "" : "s"}.`;
}

// The decision a control should render right now: the pending intent while a
// mutation is in flight, otherwise the server's own decision. The pending value
// is user input, never a fabricated server DecisionDto.
export function displayedDecision(state: RecoveryState, commitmentId: string, serverDecision: DecisionDto | null): { value: Decision | null; pending: boolean } {
  const pending = state.pending;
  if (pending?.kind === "DECISION" && pending.commitmentId === commitmentId) return { value: pending.decision, pending: true };
  return { value: serverDecision?.value ?? null, pending: false };
}
