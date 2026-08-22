"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  buildGuestAuditTransferBinding,
  guestAuditTransferBindingKey,
  guestAuditTransferKey,
  parseGuestAuditSnapshot,
  parseGuestAuditTransferBinding,
  persistGuestRecoveryEvidenceTransfer,
} from "@/lib/guest-audit-transfer";
import {
  clearStartSessionRecord,
  matchStartDecision,
  readStartSessionRecord,
} from "@/lib/recovery/start-session";
import { stampForCycleAction } from "@/lib/recovery/decision-cycle";
import { isReceiptImageFile } from "@/lib/recovery/wow-first-session";
import {
  recoveryLimits,
  type CommitmentSummaryDto,
  type CorrectionDto,
  type CorrectionField,
  type Decision,
  type EvidenceDto,
  type PutCommitmentContextRequest,
  type PutDecisionRequest,
  type SourceType,
} from "@/lib/recovery/contracts";
import { VognaryMark } from "../../brand";
import { correctionFieldLabels, decisionLabels } from "./labels";
import { RecoveryAddEvidence } from "./recovery-add-evidence";
import { RecoveryCommitments, type CommitmentsHandlers } from "./recovery-commitments";
import { RecoveryOverlay } from "./ui/overlay";
import { CorrectionForm, EvidenceInspector } from "./recovery-evidence-panels";
import { RecoveryHome } from "./recovery-home";
import { RecoveryMandate } from "./recovery-mandate";
import { RecoverySources } from "./recovery-sources";
import { AuthRequiredBlock, FailureBlock, LoadingBlock, OfflineBlock, StateBlock } from "./recovery-states";
import { offAutopilotNoticeReadiness } from "@/lib/recovery/notice-readiness";
import {
  correctionPatchFromDraft,
  evidenceRequestFromDraft,
  initialRecoveryState,
  recoveryReducer,
  recoveryViewLabels,
  recoveryViews,
  type PendingMutation,
  type RecoveryState,
  type RecoveryView,
} from "./state";
import { clientFailureReference, createRecoveryTransport, type RecoveryTransport, type TransportFailure } from "./transport";
import { recordCitedPictureActivationWithRetry, workspaceActivationGate } from "./activation-attempt";

const newIdempotencyKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `recovery-${Date.now()}-${Math.random().toString(16).slice(2)}`;

type GuestTransferStatus =
  | { kind: "IDLE" }
  | { kind: "SAVING" }
  | { kind: "SAVED"; detail: string }
  | { kind: "RETAINED"; detail: string; retryable: boolean };

type RecoverySnapshotResult =
  | {
      ok: true;
      home: Awaited<ReturnType<RecoveryTransport["home"]>> & { ok: true };
      commitments: Awaited<ReturnType<RecoveryTransport["commitments"]>> & { ok: true };
    }
  | { ok: false; failure: TransportFailure };

async function readRecoverySnapshot(transport: RecoveryTransport): Promise<RecoverySnapshotResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const home = await transport.home();
    if (!home.ok) return { ok: false, failure: home };
    const commitments = await transport.commitments();
    if (!commitments.ok) return { ok: false, failure: commitments };
    if (
      home.meta.workspaceVersion === commitments.meta.workspaceVersion
      && home.data.workspace.version === home.meta.workspaceVersion
    ) {
      return { ok: true, home, commitments };
    }
  }
  return {
    ok: false,
    failure: {
      ok: false,
      origin: "CLIENT",
      error: {
        code: "STALE_STATE",
        message: "The workspace changed while this device was loading it.",
        retryable: true,
        requestId: clientFailureReference,
        currentVersion: 0,
      },
    },
  };
}

// The signed-in Recovery workspace. It owns transport, drafts, selection, dialogs,
// focus, and pending-mutation state. Every money, date, cadence, confidence, and
// ordering fact on screen is the server's, rendered as published.
export default function RecoveryWorkspaceClient({ receiptInboxPubliclyAvailable }: { receiptInboxPubliclyAvailable: boolean }) {
  const [state, dispatch] = useReducer(recoveryReducer, initialRecoveryState);
  const transport = useMemo(() => createRecoveryTransport(), []);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [loadingMoreCommitments, setLoadingMoreCommitments] = useState(false);
  const [guestTransferStatus, setGuestTransferStatus] = useState<GuestTransferStatus>({ kind: "IDLE" });
  const [guestTransferAttempt, setGuestTransferAttempt] = useState(0);
  const [startReplayNotice, setStartReplayNotice] = useState<string | null>(null);
  const [inspectedEvidence, setInspectedEvidence] = useState<EvidenceDto | null>(null);
  const [inspectedEvidenceFailure, setInspectedEvidenceFailure] = useState<TransportFailure | null>(null);
  const [inspectingEvidence, setInspectingEvidence] = useState(false);
  const viewHeadingRef = useRef<HTMLHeadingElement>(null);
  const viewChangedRef = useRef(false);

  const loadSnapshot = useCallback(async () => {
    dispatch({ type: "SNAPSHOT_REQUESTED" });
    const snapshot = await readRecoverySnapshot(transport);
    if (!snapshot.ok) {
      dispatch({ type: "SNAPSHOT_FAILED", failure: snapshot.failure });
      return false;
    }
    dispatch({
      type: "SNAPSHOT_LOADED",
      home: snapshot.home.data,
      commitments: snapshot.commitments.data.items,
      total: snapshot.commitments.data.total,
      nextCursor: snapshot.commitments.data.nextCursor,
      meta: snapshot.home.meta,
    });
    return true;
  }, [transport]);

  const loadSources = useCallback(async () => {
    if (!receiptInboxPubliclyAvailable) return;
    dispatch({ type: "SOURCES_REQUESTED" });
    const result = await transport.sources();
    if (result.ok) dispatch({ type: "SOURCES_LOADED", receiptInbox: result.data, meta: result.meta });
    else dispatch({ type: "SOURCES_FAILED", failure: result });
  }, [receiptInboxPubliclyAvailable, transport]);

  const recordCitedPictureActivation = useCallback((workspaceId: string) => {
    workspaceActivationGate.request(workspaceId, () => recordCitedPictureActivationWithRetry({
      record: () => transport.recordWorkspaceActivation(),
    }));
  }, [transport]);

  useEffect(() => {
    const update = () => dispatch({ type: "NETWORK_CHANGED", online: navigator.onLine });
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await transport.session();
      if (cancelled) return;
      if (!session.ok) return dispatch({ type: "SNAPSHOT_FAILED", failure: session });
      dispatch({ type: "SESSION_RESOLVED", session: session.data });
      if (!session.data.authenticated) return;
      dispatch({ type: "SNAPSHOT_REQUESTED" });
      const initialSnapshot = await readRecoverySnapshot(transport);
      if (cancelled) return;
      if (!initialSnapshot.ok) return dispatch({ type: "SNAPSHOT_FAILED", failure: initialSnapshot.failure });

      let rawTransfer: string | null;
      try {
        rawTransfer = window.sessionStorage.getItem(guestAuditTransferKey);
      } catch {
        dispatch({
          type: "SNAPSHOT_LOADED",
          home: initialSnapshot.home.data,
          commitments: initialSnapshot.commitments.data.items,
          total: initialSnapshot.commitments.data.total,
          nextCursor: initialSnapshot.commitments.data.nextCursor,
          meta: initialSnapshot.home.meta,
        });
        setGuestTransferStatus({
          kind: "RETAINED",
          detail: "This browser would not allow the workspace to read earlier staged evidence. Nothing was cleared. Allow session storage, then retry.",
          retryable: true,
        });
        return;
      }

      if (!rawTransfer) {
        try {
          window.sessionStorage.removeItem(guestAuditTransferBindingKey);
        } catch {
          // No staged evidence remains; a stale binding can be ignored safely.
        }
        dispatch({
          type: "SNAPSHOT_LOADED",
          home: initialSnapshot.home.data,
          commitments: initialSnapshot.commitments.data.items,
          total: initialSnapshot.commitments.data.total,
          nextCursor: initialSnapshot.commitments.data.nextCursor,
          meta: initialSnapshot.home.meta,
        });
        setGuestTransferStatus({ kind: "IDLE" });
        return;
      }

      const guestSnapshot = parseGuestAuditSnapshot(rawTransfer);
      if (!guestSnapshot) {
        dispatch({
          type: "SNAPSHOT_LOADED",
          home: initialSnapshot.home.data,
          commitments: initialSnapshot.commitments.data.items,
          total: initialSnapshot.commitments.data.total,
          nextCursor: initialSnapshot.commitments.data.nextCursor,
          meta: initialSnapshot.home.meta,
        });
        setGuestTransferStatus({
          kind: "RETAINED",
          detail: "The earlier staged evidence is expired or unreadable. It remains in this tab and was not treated as saved evidence.",
          retryable: false,
        });
        return;
      }

      try {
        const currentBinding = parseGuestAuditTransferBinding(
          window.sessionStorage.getItem(guestAuditTransferBindingKey),
          guestSnapshot,
        );
        const expectedBinding = {
          userId: session.data.session.userId,
          workspaceId: session.data.session.workspaceId,
        };
        if (currentBinding && (
          currentBinding.userId !== expectedBinding.userId
          || currentBinding.workspaceId !== expectedBinding.workspaceId
        )) {
          dispatch({
            type: "SNAPSHOT_LOADED",
            home: initialSnapshot.home.data,
            commitments: initialSnapshot.commitments.data.items,
            total: initialSnapshot.commitments.data.total,
            nextCursor: initialSnapshot.commitments.data.nextCursor,
            meta: initialSnapshot.home.meta,
          });
          setGuestTransferStatus({
            kind: "RETAINED",
            detail: "This staged evidence belongs to a different signed account in this tab. It was not imported or cleared.",
            retryable: false,
          });
          return;
        }
        if (!currentBinding) {
          const serializedBinding = buildGuestAuditTransferBinding(guestSnapshot, expectedBinding);
          window.sessionStorage.setItem(guestAuditTransferBindingKey, serializedBinding);
          if (window.sessionStorage.getItem(guestAuditTransferBindingKey) !== serializedBinding) throw new Error();
        }
      } catch {
        dispatch({
          type: "SNAPSHOT_LOADED",
          home: initialSnapshot.home.data,
          commitments: initialSnapshot.commitments.data.items,
          total: initialSnapshot.commitments.data.total,
          nextCursor: initialSnapshot.commitments.data.nextCursor,
          meta: initialSnapshot.home.meta,
        });
        setGuestTransferStatus({
          kind: "RETAINED",
          detail: "This browser could not bind the staged audit to the signed account. Nothing was imported or cleared.",
          retryable: true,
        });
        return;
      }

      setGuestTransferStatus({ kind: "SAVING" });
      const transferFailure: { current: TransportFailure | null } = { current: null };
      const persisted = await persistGuestRecoveryEvidenceTransfer({
        snapshot: guestSnapshot,
        initialWorkspaceVersion: initialSnapshot.home.meta.workspaceVersion,
        submit: async (request, context) => {
          const result = await transport.submitEvidence(request, context);
          if (!result.ok) {
            transferFailure.current = result;
            return { ok: false };
          }
          return {
            ok: true,
            workspaceVersion: result.meta.workspaceVersion,
            acceptedEvidenceCount: result.data.submission.acceptedEvidenceCount,
            results: result.data.submission.results,
          };
        },
      });
      if (cancelled) return;

      const finalSnapshot = await readRecoverySnapshot(transport);
      if (cancelled) return;
      if (!finalSnapshot.ok) {
        setGuestTransferStatus({
          kind: "RETAINED",
          detail: "The workspace could not verify the final saved view. The staged evidence remains in this tab.",
          retryable: true,
        });
        return dispatch({ type: "SNAPSHOT_FAILED", failure: finalSnapshot.failure });
      }
      dispatch({
        type: "SNAPSHOT_LOADED",
        home: finalSnapshot.home.data,
        commitments: finalSnapshot.commitments.data.items,
        total: finalSnapshot.commitments.data.total,
        nextCursor: finalSnapshot.commitments.data.nextCursor,
        meta: finalSnapshot.home.meta,
      });

      if (!persisted.ok) {
        const detail = persisted.reason === "SUBMISSION_FAILED"
          ? `Saving stopped before every staged item was confirmed. The staged evidence remains in this tab.${transferFailure.current ? ` Reference ${transferFailure.current.error.requestId}.` : ""}`
          : persisted.reason === "PERSISTENCE_UNCONFIRMED"
            ? "The workspace did not accept every staged item. The staged evidence remains in this tab and was not labelled fully saved."
            : "The staged copy contains no supported evidence that Recovery can save. It remains in this tab.";
        setGuestTransferStatus({ kind: "RETAINED", detail, retryable: persisted.reason === "SUBMISSION_FAILED" });
        return;
      }

      const reflectedInWorkspace = finalSnapshot.home.meta.workspaceVersion === persisted.workspaceVersion
        && finalSnapshot.home.data.coverage.evidenceCount >= persisted.acceptedEvidenceCount
        && finalSnapshot.commitments.data.items.length > 0;
      if (!reflectedInWorkspace) {
        setGuestTransferStatus({
          kind: "RETAINED",
          detail: "The workspace accepted evidence but did not yet confirm a canonical commitment in Home. The staged evidence remains in this tab.",
          retryable: true,
        });
        return;
      }
      if (persisted.unsupportedSourceNames.length || persisted.unsupportedManualItemCount) {
        setGuestTransferStatus({
          kind: "RETAINED",
          detail: "Supported staged evidence is saved, but some file or manual-only claims were not promoted to canonical truth. The complete staged copy remains in this tab.",
          retryable: false,
        });
        return;
      }

      try {
        if (window.sessionStorage.getItem(guestAuditTransferKey) !== rawTransfer) {
          setGuestTransferStatus({
            kind: "RETAINED",
            detail: "The staged evidence changed while saving. The newer copy remains in this tab and was not cleared.",
            retryable: true,
          });
          return;
        }
        window.sessionStorage.removeItem(guestAuditTransferKey);
        window.sessionStorage.removeItem(guestAuditTransferBindingKey);
        setGuestTransferStatus({
          kind: "SAVED",
          detail: `${persisted.acceptedEvidenceCount === 1 ? "1 bill was" : `${persisted.acceptedEvidenceCount} bills were`} saved. The copy in this tab was cleared only after Home confirmed it.`,
        });
      } catch {
        setGuestTransferStatus({
          kind: "RETAINED",
          detail: "Recovery confirmed the saved evidence, but this browser would not clear the staged guest copy. It remains available for safety.",
          retryable: false,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [guestTransferAttempt, transport]);

  useEffect(() => {
    if (state.view !== "ADD_EVIDENCE") return;
    void loadSources();
  }, [loadSources, state.view]);

  useEffect(() => {
    if (
      state.status.kind !== "READY"
      || !state.home?.coverage.evidenceCount
      || state.sourceStatus.kind !== "IDLE"
    ) return;
    void loadSources();
  }, [loadSources, state.home?.coverage.evidenceCount, state.sourceStatus.kind, state.status.kind]);

  useEffect(() => {
    if (state.view === "ADD_EVIDENCE" && state.sourceStatus.kind === "READY" && state.refreshRequired) {
      void loadSnapshot();
    }
  }, [loadSnapshot, state.refreshRequired, state.sourceStatus.kind, state.view]);

  useEffect(() => {
    if (state.view !== "ADD_EVIDENCE" || !state.receiptInbox?.alias) return;
    if (state.receiptInbox.forwardingVerifiedAt && state.receiptInbox.setupCompletedAt && state.receiptInbox.state === "READY") return;
    const interval = window.setInterval(() => void loadSources(), 10_000);
    return () => window.clearInterval(interval);
  }, [loadSources, state.receiptInbox, state.view]);

  const { selectedCommitmentId, detailEvidenceCursor, detailRefreshToken } = state;
  useEffect(() => {
    if (!selectedCommitmentId) return;
    let cancelled = false;
    void (async () => {
      const result = await transport.commitment(selectedCommitmentId, {
        evidenceLimit: recoveryLimits.maxCommitmentEvidencePageSize,
        evidenceCursor: detailEvidenceCursor ?? undefined,
      });
      if (cancelled) return;
      if (result.ok) dispatch({ type: "DETAIL_LOADED", detail: result.data, meta: result.meta });
      else dispatch({ type: "DETAIL_FAILED", failure: result });
    })();
    return () => {
      cancelled = true;
    };
  }, [detailEvidenceCursor, detailRefreshToken, selectedCommitmentId, transport]);

  const inspectedEvidenceId = state.dialog?.kind === "EVIDENCE_INSPECTOR" ? state.dialog.evidenceId : null;
  useEffect(() => {
    if (!inspectedEvidenceId) return;
    let cancelled = false;
    void (async () => {
      const result = await transport.evidence(inspectedEvidenceId);
      if (cancelled) return;
      setInspectingEvidence(false);
      if (!result.ok) {
        setInspectedEvidenceFailure(result);
        return;
      }
      if (state.workspaceVersion !== null && result.meta.workspaceVersion !== state.workspaceVersion) {
        setInspectedEvidenceFailure({
          ok: false,
          origin: "CLIENT",
          error: {
            code: "STALE_STATE",
            message: "The evidence belongs to another saved workspace version.",
            retryable: true,
            requestId: clientFailureReference,
            currentVersion: result.meta.workspaceVersion,
          },
        });
        return;
      }
      setInspectedEvidence(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [inspectedEvidenceId, state.workspaceVersion, transport]);

  useEffect(() => {
    if (!viewChangedRef.current) {
      viewChangedRef.current = true;
      return;
    }
    viewHeadingRef.current?.focus();
  }, [state.view]);

  function selectView(view: RecoveryView) {
    dispatch({ type: "VIEW_SELECTED", view });
  }

  function openCommitment(commitmentId: string) {
    dispatch({ type: "VIEW_SELECTED", view: "COMMITMENTS" });
    dispatch({ type: "COMMITMENT_SELECTED", commitmentId });
  }

  function inspectEvidence(commitmentId: string | null, evidenceId: string, buttonId: string) {
    setInspectingEvidence(true);
    setInspectedEvidence(null);
    setInspectedEvidenceFailure(null);
    dispatch({
      type: "DIALOG_OPENED",
      dialog: { kind: "EVIDENCE_INSPECTOR", commitmentId, evidenceId },
      returnFocusId: buttonId,
    });
  }

  async function decide(request: PutDecisionRequest) {
    if (state.workspaceVersion === null) return;
    const commitment = state.commitments.find((item) => item.id === request.commitmentId)
      ?? (state.detail?.id === request.commitmentId ? state.detail : null);
    if (!commitment) return;
    const idempotencyKey = newIdempotencyKey();
    dispatch({ type: "DECISION_STARTED", commitmentId: request.commitmentId, decision: request.decision, previous: commitment.decision, idempotencyKey });
    const result = await transport.putDecision(
      request,
      { workspaceVersion: state.workspaceVersion, idempotencyKey },
    );
    if (result.ok) dispatch({ type: "DECISION_SAVED", commitment: result.data.commitment, home: result.data.home, meta: result.meta });
    else dispatch({ type: "MUTATION_FAILED", failure: result });
  }

  async function decideFromDetail(commitment: CommitmentSummaryDto, decision: Decision) {
    await decide({ commitmentId: commitment.id, decision });
  }

  async function saveContext(commitmentId: string, request: PutCommitmentContextRequest) {
    if (state.workspaceVersion === null) return;
    const idempotencyKey = newIdempotencyKey();
    dispatch({ type: "CONTEXT_STARTED", commitmentId, idempotencyKey });
    const result = await transport.putCommitmentContext(commitmentId, request, { workspaceVersion: state.workspaceVersion, idempotencyKey });
    if (result.ok) dispatch({ type: "CONTEXT_SAVED", detail: result.data.commitment, home: result.data.home, meta: result.meta });
    else dispatch({ type: "MUTATION_FAILED", failure: result });
  }

  async function submitCorrection() {
    const dialog = state.dialog;
    if (dialog?.kind !== "CORRECTION" || state.workspaceVersion === null) return;
    const patch = correctionPatchFromDraft(state.correctionDraft);
    if (!patch) {
      setCorrectionError("Enter a complete value before saving this correction.");
      return;
    }
    setCorrectionError(null);
    const idempotencyKey = newIdempotencyKey();
    dispatch({ type: "CORRECTION_STARTED", commitmentId: dialog.commitmentId, field: dialog.field, idempotencyKey });
    const result = await transport.createCorrection(
      dialog.commitmentId,
      { patch, ...(state.correctionDraft.reason.trim() ? { reason: state.correctionDraft.reason.trim() } : {}) },
      { workspaceVersion: state.workspaceVersion, idempotencyKey },
    );
    if (result.ok) dispatch({ type: "CORRECTION_SAVED", detail: result.data.commitment, home: result.data.home, meta: result.meta });
    else dispatch({ type: "MUTATION_FAILED", failure: result });
  }

  async function reverseCorrection(correction: CorrectionDto) {
    if (state.workspaceVersion === null) return;
    const idempotencyKey = newIdempotencyKey();
    dispatch({ type: "CORRECTION_REVERSAL_STARTED", commitmentId: correction.commitmentId, correctionId: correction.id, idempotencyKey });
    const result = await transport.reverseCorrection(correction.commitmentId, correction.id, {
      workspaceVersion: state.workspaceVersion,
      idempotencyKey,
    });
    if (result.ok) dispatch({ type: "CORRECTION_SAVED", detail: result.data.commitment, home: result.data.home, meta: result.meta });
    else dispatch({ type: "MUTATION_FAILED", failure: result });
  }

  async function submitEvidence(mode: SourceType) {
    if (state.workspaceVersion === null) return;
    const request = evidenceRequestFromDraft(state.evidenceDraft, mode);
    if (!request) return;
    dispatch({ type: "EVIDENCE_MODE_SELECTED", mode });
    const idempotencyKey = newIdempotencyKey();
    dispatch({ type: "EVIDENCE_SUBMIT_STARTED", idempotencyKey });
    const result = await transport.submitEvidence(request, { workspaceVersion: state.workspaceVersion, idempotencyKey });
    if (result.ok) {
      dispatch({
        type: "EVIDENCE_SUBMITTED",
        submission: result.data.submission,
        home: result.data.home,
        commitments: result.data.commitments,
        total: result.data.commitmentTotal,
        meta: result.meta,
      });
    } else {
      dispatch({ type: "EVIDENCE_SUBMIT_FAILED", failure: result });
    }
  }

  async function prepareFiles(files: readonly File[]) {
    const documents = files.filter((file) => !isReceiptImageFile(file));
    if (!documents.length) return;
    dispatch({ type: "CSV_PREPARE_STARTED" });
    const result = await transport.prepareImport(documents.slice(0, recoveryLimits.maxCsvSources));
    if (!result.ok) return dispatch({ type: "CSV_PREPARE_FAILED", failure: result });
    dispatch({
      type: "CSV_SOURCES_PREPARED",
      sources: result.data.sources.map((source, index) => ({
        clientRef: `csv-${Date.now()}-${index}`,
        name: source.name,
        text: source.text,
        rowCount: source.rowCount,
        warnings: source.warnings,
      })),
    });
  }

  async function consentReminder() {
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
      const response = await fetch("/api/renewal-alerts/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          enabled: true,
          weeklyDigestEnabled: false,
          sevenDayEnabled: false,
          oneDayEnabled: true,
          timeZone,
          sendHourLocal: 9,
        }),
      });
      if (!response.ok) {
        window.sessionStorage.setItem("vognary.reminder-consent", "requested");
      }
    } catch {
      try {
        window.sessionStorage.setItem("vognary.reminder-consent", "requested");
      } catch {
        // Consent stays on-screen even if storage is unavailable.
      }
    }
  }

  const startReplayRef = useRef(false);
  useEffect(() => {
    if (startReplayRef.current) return;
    if (state.status.kind !== "READY" || !state.home) return;
    const record = readStartSessionRecord();
    if (!record?.decisions.length) return;
    if (!state.home.decisionQueue.length) return;
    startReplayRef.current = true;
    const home = state.home;
    void (async () => {
      const unmatched: string[] = [];
      for (const decision of record.decisions) {
        const card = home.decisionQueue.find((item) => matchStartDecision(item.merchant, [decision]));
        if (!card) {
          unmatched.push(decision.merchant);
          continue;
        }
        await decide({
          commitmentId: card.commitmentId,
          decision: stampForCycleAction(decision.action),
          action: decision.action,
        });
      }
      if (record.reminderRequested) await consentReminder();
      clearStartSessionRecord();
      if (unmatched.length) {
        setStartReplayNotice(
          unmatched.length === 1
            ? `Your bills were saved. We could not re-apply the decision for ${unmatched[0]}. Decide it again here. Nothing was cancelled.`
            : `Your bills were saved. We could not re-apply decisions for ${unmatched.join(", ")}. Decide them again here. Nothing was cancelled.`,
        );
      }
    })();
    // One-shot replay of /start decisions; decide is the current snapshot writer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.home, state.status.kind]);

  async function updateReceiptInbox(action: "PROVISION" | "ROTATE" | "REVOKE") {
    const activeAliasId = state.receiptInbox?.alias?.id ?? null;
    if (action === "ROTATE" && !activeAliasId) return;
    dispatch({ type: "SOURCE_ACTION_STARTED", action });
    const result = action === "PROVISION"
      ? await transport.provisionReceiptInbox()
      : action === "ROTATE"
        ? await transport.rotateReceiptInbox(activeAliasId!, newIdempotencyKey())
        : await transport.revokeReceiptInbox();
    if (result.ok) dispatch({ type: "SOURCE_ACTION_SAVED", receiptInbox: result.data, meta: result.meta });
    else dispatch({ type: "SOURCE_ACTION_FAILED", failure: result });
  }

  async function signMandate() {
    if (state.workspaceVersion === null) return;
    const idempotencyKey = newIdempotencyKey();
    dispatch({ type: "MANDATE_STARTED", action: "SIGN", idempotencyKey });
    const result = await transport.signStandingMandate({ workspaceVersion: state.workspaceVersion, idempotencyKey });
    if (!result.ok) {
      dispatch({ type: "MUTATION_FAILED", failure: result });
      return;
    }
    await loadSnapshot();
  }

  async function revokeMandate() {
    if (state.workspaceVersion === null) return;
    const idempotencyKey = newIdempotencyKey();
    dispatch({ type: "MANDATE_STARTED", action: "REVOKE", idempotencyKey });
    const result = await transport.revokeStandingMandate({ workspaceVersion: state.workspaceVersion, idempotencyKey });
    if (!result.ok) {
      dispatch({ type: "MUTATION_FAILED", failure: result });
      return;
    }
    await loadSnapshot();
  }

  async function vetoCandidate(candidateId: string) {
    if (state.workspaceVersion === null) return;
    const idempotencyKey = newIdempotencyKey();
    dispatch({ type: "VETO_STARTED", candidateId, idempotencyKey });
    const result = await transport.vetoAutopilotCandidate(candidateId, { workspaceVersion: state.workspaceVersion, idempotencyKey });
    if (!result.ok) {
      dispatch({ type: "MUTATION_FAILED", failure: result });
      return;
    }
    await loadSnapshot();
  }

  async function disconnectEvidenceSource(sourceId: string) {
    if (state.workspaceVersion === null) return;
    const idempotencyKey = newIdempotencyKey();
    dispatch({ type: "EVIDENCE_SOURCE_STARTED", action: "DISCONNECT", sourceId, idempotencyKey });
    const result = await transport.disconnectRecoverySource(sourceId, { workspaceVersion: state.workspaceVersion, idempotencyKey });
    if (!result.ok) {
      dispatch({ type: "MUTATION_FAILED", failure: result });
      return;
    }
    await loadSnapshot();
  }

  async function reconnectEvidenceSource(sourceId: string) {
    if (state.workspaceVersion === null) return;
    const idempotencyKey = newIdempotencyKey();
    dispatch({ type: "EVIDENCE_SOURCE_STARTED", action: "RECONNECT", sourceId, idempotencyKey });
    const result = await transport.reconnectRecoverySource(sourceId, { workspaceVersion: state.workspaceVersion, idempotencyKey });
    if (!result.ok) {
      dispatch({ type: "MUTATION_FAILED", failure: result });
      return;
    }
    await loadSnapshot();
  }

  async function loadMoreCommitments() {
    if (!state.commitmentsCursor || loadingMoreCommitments) return;
    setLoadingMoreCommitments(true);
    const result = await transport.commitments({ cursor: state.commitmentsCursor });
    setLoadingMoreCommitments(false);
    if (result.ok) dispatch({ type: "COMMITMENTS_PAGE_APPENDED", items: result.data.items, total: result.data.total, nextCursor: result.data.nextCursor, meta: result.meta });
    else dispatch({ type: "SNAPSHOT_FAILED", failure: result });
  }

  const workspaceEmpty = state.home !== null && state.commitments.length === 0 && state.home.coverage.evidenceCount === 0;

  const commitmentsHandlers: CommitmentsHandlers = {
    onSelect: (commitmentId) => dispatch({ type: "COMMITMENT_SELECTED", commitmentId }),
    onDecide: (commitment, decision) => void decideFromDetail(commitment, decision),
    onSaveContext: (commitmentId, request) => void saveContext(commitmentId, request),
    onInspectEvidence: (evidence: EvidenceDto, buttonId: string) =>
      inspectEvidence(state.selectedCommitmentId ?? "", evidence.id, buttonId),
    onCorrect: (field: CorrectionField, buttonId: string) => {
      setCorrectionError(null);
      dispatch({
        type: "DIALOG_OPENED",
        dialog: { kind: "CORRECTION", commitmentId: state.selectedCommitmentId ?? "", field },
        returnFocusId: buttonId,
      });
    },
    onReverseCorrection: (correction) => void reverseCorrection(correction),
    onEvidencePage: (cursor) => dispatch({ type: "DETAIL_EVIDENCE_PAGE_REQUESTED", cursor }),
    onAddEvidence: () => dispatch({ type: "ADD_BILLS_OPENED" }),
    onRetryDetail: () => dispatch({ type: "DETAIL_EVIDENCE_PAGE_REQUESTED", cursor: state.detailEvidenceCursor }),
    onLoadMoreCommitments: () => void loadMoreCommitments(),
    loadingMoreCommitments,
  };

  const accountEmail = state.session?.authenticated ? state.session.session.email : null;
  const mandateAvailable = Boolean(state.home?.autopilot?.mandate)
    || state.home?.autopilot?.noticeReadiness.state === "proven-ready";
  const primaryViews = mandateAvailable
    ? recoveryViews
    : recoveryViews.filter((view) => view !== "MANDATE");
  return (
    <main id="recovery-workspace" className="relative px-4 pb-28 pt-5 text-foreground sm:px-6 sm:pb-10 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2.5">
            <VognaryMark size={24} />
            <h1 className="font-display text-lg font-semibold text-(--ink)">Vognary</h1>
          </div>
          <div className="flex items-center gap-2">
            <p className="hidden font-data text-xs text-(--muted) sm:block">
              {state.workspaceVersion === null ? "Loading your workspace…" : "Saved to Vognary"}
            </p>
            <Link
              href="/profile"
              aria-label={accountEmail ? `Account for ${accountEmail}` : "Account"}
              className="btn btn-sm btn-ghost"
            >
              <span aria-hidden className="grid size-6 place-items-center rounded-full bg-(--card-2) font-data text-xs text-(--ink)">
                {accountEmail?.charAt(0).toUpperCase() ?? "A"}
              </span>
              <span className="hidden sm:inline">Account</span>
            </Link>
          </div>
        </header>

        <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card px-2 py-2 sm:static sm:mt-5 sm:border-0 sm:bg-transparent sm:p-0">
          <ul className={`viewnav ${primaryViews.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
            {primaryViews.map((view) => (
              <li key={view} className="min-w-0">
                <button
                  type="button"
                  onClick={() => selectView(view)}
                  aria-current={state.view === view ? "page" : undefined}
                  className="truncate"
                >
                  {recoveryViewLabels[view]}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{state.announcement}</p>

        <div className="mt-5 grid gap-4">
          {!state.online ? <OfflineBlock /> : null}
          <GuestTransferBlock status={guestTransferStatus} onRetry={() => setGuestTransferAttempt((attempt) => attempt + 1)} />
          {startReplayNotice ? (
            <div role="status" className="inset p-4">
              <p className="text-sm leading-6 text-(--ink)">{startReplayNotice}</p>
            </div>
          ) : null}
          {state.refreshRequired ? (
            <StateBlock
              eyebrow="Out of date"
              title="This page is behind the saved workspace"
              detail="A change landed after this page loaded. Reload to see the saved truth before deciding anything else."
              tone="caution"
            >
              <button type="button" onClick={() => void loadSnapshot()} className="btn btn-sm btn-primary">Reload the saved workspace</button>
            </StateBlock>
          ) : null}
          {state.rollback ? <RollbackAlert state={state} onDismiss={() => dispatch({ type: "ROLLBACK_DISMISSED" })} /> : null}
        </div>

        {/* Focus target for view changes. It is never Tab-reachable, so the
            programmatic ring is suppressed rather than drawn across the page. */}
        <h2
          ref={viewHeadingRef}
          tabIndex={-1}
          data-focus-quiet
          className={
            state.view === "HOME"
              ? "mt-6 w-fit font-data text-xs font-medium text-(--muted) outline-none"
              : "mt-6 w-fit font-display text-2xl font-semibold tracking-tight text-(--ink) outline-none"
          }
        >
          {recoveryViewLabels[state.view]}
        </h2>

        <div className="mt-4">
          {state.status.kind === "AUTH_REQUIRED" ? (
            <AuthRequiredBlock />
          ) : state.status.kind === "LOADING" ? (
            <LoadingBlock label="Opening your saved workspace…" />
          ) : state.status.kind === "FAILED" ? (
            <FailureBlock failure={state.status.failure}>
              <button type="button" onClick={() => void loadSnapshot()} className="btn btn-sm btn-primary">Try again</button>
            </FailureBlock>
          ) : (
            renderView()
          )}
        </div>
      </div>

      {state.addBillsOpen ? (
        <RecoveryOverlay
          title="Add bills"
          onClose={() => dispatch({ type: "ADD_BILLS_CLOSED" })}
          returnFocusId={null}
        >
          <RecoveryAddEvidence
            draft={state.evidenceDraft}
            submission={state.submission}
            failure={state.evidenceFailure}
            pending={state.pending?.kind === "EVIDENCE"}
            online={state.online}
            handlers={{
              onModeChange: (mode) => dispatch({ type: "EVIDENCE_MODE_SELECTED", mode }),
              onReceiptChange: (text) => dispatch({ type: "RECEIPT_DRAFT_CHANGED", text }),
              onFilesChosen: (files) => void prepareFiles(files),
              onImageDrafts: (drafts) => dispatch({ type: "IMAGE_DRAFTS_ADDED", drafts }),
              onImageProposal: (clientRef, proposal) => dispatch({ type: "IMAGE_DRAFT_PROPOSAL", clientRef, proposal }),
              onRemoveSource: (clientRef) => dispatch({ type: "CSV_SOURCE_REMOVED", clientRef }),
              onConfirmImageLine: (clientRef, text) => dispatch({ type: "IMAGE_LINE_CONFIRMED", clientRef, text }),
              onRemoveImageDraft: (clientRef) => dispatch({ type: "IMAGE_DRAFT_REMOVED", clientRef }),
              onSubmit: (mode) => void submitEvidence(mode),
            }}
          />
        </RecoveryOverlay>
      ) : null}

      {state.dialog?.kind === "EVIDENCE_INSPECTOR" ? (
        <RecoveryOverlay
          title="The receipt"
          description="This is the stored bill, unedited."
          onClose={() => dispatch({ type: "DIALOG_CLOSED" })}
          returnFocusId={state.returnFocusId}
        >
          {inspectedEvidence ? (
            <EvidenceInspector evidence={inspectedEvidence} />
          ) : inspectedEvidenceFailure ? (
            <FailureBlock failure={inspectedEvidenceFailure} />
          ) : inspectingEvidence ? (
            <LoadingBlock label="Opening the saved receipt…" />
          ) : (
            <p className="text-sm leading-6 text-(--muted)">This receipt is not on the page any more. Close and reopen the commitment.</p>
          )}
        </RecoveryOverlay>
      ) : null}

      {state.dialog?.kind === "CORRECTION" && state.detail ? (
        <RecoveryOverlay
          title={`Correct ${correctionFieldLabels[state.dialog.field].toLowerCase()}`}
          description="Corrections sit on top of your evidence. The evidence itself is never changed, and every correction can be reversed."
          onClose={() => dispatch({ type: "DIALOG_CLOSED" })}
          returnFocusId={state.returnFocusId}
          footer={
            <>
              {correctionError ? <p role="alert" className="mr-auto text-sm text-ember">{correctionError}</p> : null}
              <button type="button" onClick={() => dispatch({ type: "DIALOG_CLOSED" })} className="btn btn-ghost">Cancel</button>
              <button type="submit" form="recovery-correction-form" disabled={state.pending !== null} className="btn btn-primary">
                {state.pending?.kind === "CORRECTION" ? "Saving…" : "Save correction"}
              </button>
            </>
          }
        >
          <CorrectionForm
            draft={state.correctionDraft}
            detail={state.detail}
            formId="recovery-correction-form"
            onChange={(draft) => dispatch({ type: "CORRECTION_DRAFT_CHANGED", draft })}
            onSubmit={() => void submitCorrection()}
          />
        </RecoveryOverlay>
      ) : null}
    </main>
  );

  function renderView() {
    if (state.view === "ADD_EVIDENCE") {
      return (
        <RecoverySources
          receiptInboxPubliclyAvailable={receiptInboxPubliclyAvailable}
          receiptInbox={state.receiptInbox}
          sourceStatus={state.sourceStatus}
          pendingAction={state.pendingSourceAction}
          evidenceSources={state.home?.evidenceSources ?? []}
          canManageEvidenceSources={state.home?.workspace.role === "owner" || state.home?.workspace.role === "admin"}
          pendingMutation={state.pending}
          onDisconnectEvidenceSource={(sourceId) => void disconnectEvidenceSource(sourceId)}
          onReconnectEvidenceSource={(sourceId) => void reconnectEvidenceSource(sourceId)}
          onProvision={() => void updateReceiptInbox("PROVISION")}
          onRotate={() => void updateReceiptInbox("ROTATE")}
          onRevoke={() => void updateReceiptInbox("REVOKE")}
          onRetry={() => void loadSources()}
          onAddBills={() => dispatch({ type: "ADD_BILLS_OPENED" })}
          firstValue={workspaceEmpty}
        />
      );
    }

    if (state.view === "COMMITMENTS") {
      return <RecoveryCommitments state={state} handlers={commitmentsHandlers} />;
    }

    if (state.view === "MANDATE") {
      return (
        <RecoveryMandate
          mandate={state.home?.autopilot?.mandate ?? null}
          executionEnabled={state.home?.autopilot?.executionEnabled ?? false}
          noticeReadiness={state.home?.autopilot?.noticeReadiness ?? offAutopilotNoticeReadiness}
          pendingKind={state.pending?.kind === "MANDATE_SIGN" ? "SIGN" : state.pending?.kind === "MANDATE_REVOKE" ? "REVOKE" : null}
          online={state.online}
          canSign={state.home?.workspace.role === "owner"}
          canOperate={state.home?.workspace.role === "owner" || state.home?.workspace.role === "admin"}
          handled={state.home?.autopilot?.handled ?? []}
          needsHelp={state.home?.autopilot?.needsHelp ?? []}
          attempts={state.home?.autopilot?.attempts ?? []}
          onSign={() => void signMandate()}
          onRevoke={() => void revokeMandate()}
        />
      );
    }

    return state.home ? (
      <RecoveryHome
        home={state.home}
        commitments={state.commitments}
        commitmentTotal={state.commitmentTotal}
        showFirstResult={state.showFirstResult}
        receiptInboxPubliclyAvailable={receiptInboxPubliclyAvailable}
        onOpenCommitment={openCommitment}
        onAddEvidence={() => dispatch({ type: "ADD_BILLS_OPENED" })}
        onOpenSources={() => selectView("ADD_EVIDENCE")}
        onSeeAllCommitments={() => selectView("COMMITMENTS")}
        onDismissFirstResult={() => dispatch({ type: "FIRST_RESULT_DISMISSED" })}
        onDecide={(request) => void decide(request)}
        onReminderConsent={() => void consentReminder()}
        onPaymentAsk={(answer) => {
          try {
            window.sessionStorage.setItem("vognary.payment-ask", answer);
          } catch {
            // Written intent is research-only; missing storage does not change money.
          }
        }}
        onSaveContext={(commitmentId, request) => void saveContext(commitmentId, request)}
        onWorkspaceMutated={() => void loadSnapshot()}
        receiptInbox={state.receiptInbox}
        onVeto={(candidateId) => void vetoCandidate(candidateId)}
        pendingVetoId={state.pending?.kind === "CANDIDATE_VETO" ? state.pending.candidateId : null}
        pendingDecisionId={state.pending?.kind === "DECISION" ? state.pending.commitmentId : null}
        onCitedPictureRendered={recordCitedPictureActivation}
      />
    ) : (
      <LoadingBlock label="Opening your saved workspace…" />
    );
  }
}

function GuestTransferBlock({ status, onRetry }: { status: GuestTransferStatus; onRetry: () => void }) {
  if (status.kind === "IDLE") return null;
  if (status.kind === "SAVING") {
    return (
      <div role="status" aria-live="polite">
        <StateBlock
          eyebrow="Saving your bills"
          title="Saving your bills…"
          detail="Each bill is being saved. The copy stays in this tab until Home confirms it."
        />
      </div>
    );
  }
  if (status.kind === "SAVED") {
    return (
      <div role="status" aria-live="polite">
        <StateBlock eyebrow="Bills imported" title="Earlier bills were saved" detail={status.detail} />
      </div>
    );
  }
  return (
    <div role="alert">
      <StateBlock eyebrow="Staged bills retained" title="The staged copy was not cleared" detail={status.detail} tone="caution">
        {status.retryable ? <button type="button" onClick={onRetry} className="btn btn-sm btn-primary">Retry saving staged bills</button> : null}
      </StateBlock>
    </div>
  );
}

function RollbackAlert({ state, onDismiss }: { state: RecoveryState; onDismiss: () => void }) {
  const rollback = state.rollback;
  if (!rollback) return null;
  const { mutation, failure } = rollback;
  const commitment = "commitmentId" in mutation ? state.commitments.find((item) => item.id === mutation.commitmentId) ?? null : null;

  const attempted = rollbackAttemptLabel(mutation, commitment);

  const restored =
    mutation.kind === "DECISION"
      ? commitment?.decision
        ? `still ${decisionLabels[commitment.decision.value]}`
        : "still without a recorded decision"
      : "unchanged";

  return (
    <div role="alert" className="inset border border-ember p-4">
      <p className="eyebrow eyebrow-xs text-ember">Rolled back</p>
      <p className="mt-2 text-sm leading-6 text-(--ink)">
        {attempted} was not saved. The workspace is {restored}, exactly as the server last reported it.
      </p>
      <p className="mt-1 text-sm leading-6 text-(--muted)">
        {failure.error.message} · reference {failure.error.requestId} · {failure.origin === "SERVER" ? "raised by the workspace" : "raised on this device"}
      </p>
      <button type="button" onClick={onDismiss} className="btn btn-sm btn-ghost mt-3">Dismiss</button>
    </div>
  );
}

function rollbackAttemptLabel(mutation: PendingMutation, commitment: CommitmentSummaryDto | null) {
  switch (mutation.kind) {
    case "EVIDENCE":
      return "your evidence submission";
    case "DECISION":
      return `“${decisionLabels[mutation.decision]}” for ${commitment?.merchant ?? "this commitment"}`;
    case "CONTEXT":
      return `how ${commitment?.merchant ?? "this software"} is used`;
    case "CORRECTION":
      return `the ${correctionFieldLabels[mutation.field].toLowerCase()} correction`;
    case "CORRECTION_REVERSAL":
      return "reversing that correction";
    case "MANDATE_SIGN":
      return "signing the standing mandate";
    case "MANDATE_REVOKE":
      return "revoking the standing mandate";
    case "CANDIDATE_VETO":
      return "vetoing that Autopilot case";
    case "SOURCE_DISCONNECT":
      return "disconnecting that evidence source";
    case "SOURCE_RECONNECT":
      return "reconnecting that evidence source";
    default: {
      const exhaustive: never = mutation;
      return exhaustive;
    }
  }
}
