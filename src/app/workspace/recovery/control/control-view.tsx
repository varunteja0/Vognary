"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AuthorizationLoop } from "@/app/authorization-loop";
import { activeCommitmentControlStep, commitmentControlStepLabel } from "@/lib/commitment-control-loop";
import { controlDraftFromGuestProposal, readGuestProposalDraft } from "@/lib/guest-proposal-draft";
import type { CommitmentSummaryDto, EvidenceDto } from "@/lib/recovery/contracts";
import { currencyExponent, minorUnitsToDecimal } from "@/lib/recovery/domain";
import { formatMoment } from "../labels";
import { FailureBlock, LoadingBlock, StateBlock } from "../recovery-states";
import type { TransportFailure } from "../transport";
import { ControlDecisionDialog } from "./control-decision-dialog";
import {
  controlCategories,
  controlCategoryLabels,
  controlPostureLabels,
  formatControlMoney,
} from "./control-format";
import { ControlPolicyDialog } from "./control-policy-dialog";
import { ControlProposalComposer } from "./control-proposal-composer";
import { ControlProposalRow } from "./control-proposal-row";
import { ControlReconciliationDialog, type ControlEvidenceState } from "./control-reconciliation-dialog";
import {
  controlDecisionRequest,
  controlPolicyRequest,
  controlProposalRequest,
  controlReducer,
  initialControlState,
  policyDraftFrom,
  resolveIdempotencyKey,
  type ControlDecisionDraft,
  type ControlPolicyDraft,
  type ControlProposalDraft,
  type ControlState,
} from "./control-state";
import { createControlTransport } from "./control-transport";

// The Commitment Control desk: proposal, policy context, human decision, frozen
// cap, observed outcome. Four unframed bands inside the canonical workspace
// shell. Every money, exposure, headroom, verdict, and cap on screen is the
// server's, rendered as published.

const newIdempotencyKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `control-${Date.now()}-${Math.random().toString(16).slice(2)}`;

type ControlBriefResult = Awaited<ReturnType<ReturnType<typeof createControlTransport>["brief"]>>;
const initialBriefRequests = new Map<string, Promise<ControlBriefResult>>();

function readInitialBriefOnce(workspaceId: string, transport: ReturnType<typeof createControlTransport>) {
  const active = initialBriefRequests.get(workspaceId);
  if (active) return active;
  const request = transport.brief().finally(() => {
    if (initialBriefRequests.get(workspaceId) === request) initialBriefRequests.delete(workspaceId);
  });
  initialBriefRequests.set(workspaceId, request);
  return request;
}

const toMajorUnits = (minor: string, currency: string) => {
  try {
    return minorUnitsToDecimal(minor, currencyExponent(currency));
  } catch {
    return minor;
  }
};

export type ControlEvidenceLoader = (commitmentId: string) => Promise<
  { ok: true; items: readonly EvidenceDto[] } | { ok: false; failure: TransportFailure }
>;

export type CommitmentControlDesk = {
  state: ControlState;
  available: boolean;
  unavailable: boolean;
  evidence: ControlEvidenceState;
  reload: () => void;
  handlers: {
    changeDraft: (draft: Partial<ControlProposalDraft>) => void;
    toggleCommitment: (commitmentId: string) => void;
    submitProposal: () => void;
    openDecision: (proposalId: string, returnFocusId: string) => void;
    openReconciliation: (proposalId: string, returnFocusId: string) => void;
    openPolicy: (returnFocusId: string) => void;
    closeDialog: () => void;
    changeDecisionDraft: (draft: Partial<ControlDecisionDraft>) => void;
    submitDecision: () => void;
    selectReconciliationCommitment: (commitmentId: string) => void;
    selectReconciliationEvidence: (evidenceId: string) => void;
    submitReconciliation: () => void;
    changePolicyDraft: (draft: Partial<ControlPolicyDraft>) => void;
    submitPolicy: () => void;
    focusProposal: (proposalId: string) => void;
    clearFocus: () => void;
  };
};

/**
 * Owns the Control desk's transport and client state. A workspace that is not
 * enrolled answers the brief with 503 FEATURE_UNAVAILABLE; the desk then marks
 * itself unavailable for the session and never asks again.
 */
export function useCommitmentControl({
  enabled,
  workspaceId,
  loadEvidence,
}: {
  enabled: boolean;
  workspaceId: string | null;
  loadEvidence: ControlEvidenceLoader;
}): CommitmentControlDesk {
  const transport = useMemo(() => createControlTransport(), []);
  const [state, dispatch] = useReducer(controlReducer, initialControlState);
  const [evidence, setEvidence] = useState<ControlEvidenceState>({ kind: "IDLE" });
  // Mutation handlers read the committed state, never a render-time snapshot,
  // so a retry always sends the workspace version the reader actually saw.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const loadBrief = useCallback(async (dedupeInitialRequest = false) => {
    if (!workspaceId) return;
    dispatch({ type: "BRIEF_REQUESTED" });
    const result = dedupeInitialRequest ? await readInitialBriefOnce(workspaceId, transport) : await transport.brief();
    if (result.ok) dispatch({ type: "BRIEF_LOADED", brief: result.data, meta: result.meta });
    else dispatch({ type: "BRIEF_FAILED", failure: result });
  }, [transport, workspaceId]);

  const requestedRef = useRef(false);
  useEffect(() => {
    if (!enabled || !workspaceId || requestedRef.current) return;
    requestedRef.current = true;
    void loadBrief(true);
  }, [enabled, loadBrief, workspaceId]);

  const proposalFor = useCallback((proposalId: string) => {
    return stateRef.current.brief?.proposals.find((entry) => entry.proposal.id === proposalId) ?? null;
  }, []);

  const submitProposal = useCallback(async () => {
    const current = stateRef.current;
    if (current.workspaceVersion === null || current.pending) return;
    const built = controlProposalRequest(current.draft);
    if (!built.ok) {
      dispatch({ type: "PROPOSAL_REJECTED", errors: built.errors });
      return;
    }
    const signature = JSON.stringify(built.request);
    const idempotencyKey = resolveIdempotencyKey(current.idempotency, "PROPOSAL", signature, newIdempotencyKey);
    dispatch({ type: "PROPOSAL_STARTED", idempotencyKey, signature });
    const result = await transport.createProposal(built.request, { workspaceVersion: current.workspaceVersion, idempotencyKey });
    if (result.ok) {
      dispatch({
        type: "PROPOSAL_SAVED",
        proposal: result.data.proposal,
        evaluation: result.data.evaluation,
        submitted: built.request,
        meta: result.meta,
      });
      return;
    }
    dispatch({ type: "PROPOSAL_FAILED", failure: result });
    if (result.error.code === "STALE_STATE") await loadBrief();
  }, [loadBrief, transport]);

  const submitDecision = useCallback(async () => {
    const current = stateRef.current;
    if (current.dialog?.kind !== "DECISION" || current.workspaceVersion === null || current.pending) return;
    const entry = proposalFor(current.dialog.proposalId);
    if (!entry) return;
    const built = controlDecisionRequest(current.decisionDraft, entry.proposal, entry.evaluation);
    if (!built.ok) {
      dispatch({ type: "DECISION_DRAFT_CHANGED", draft: { error: built.message } });
      return;
    }
    const signature = JSON.stringify({ proposalId: entry.proposal.id, ...built.request });
    const idempotencyKey = resolveIdempotencyKey(current.idempotency, "DECISION", signature, newIdempotencyKey);
    dispatch({ type: "DECISION_STARTED", proposalId: entry.proposal.id, action: built.request.action, idempotencyKey, signature });
    const result = await transport.decideProposal(entry.proposal.id, built.request, {
      workspaceVersion: current.workspaceVersion,
      idempotencyKey,
    });
    if (result.ok) {
      dispatch({ type: "DECISION_SAVED", decision: result.data.decision, meta: result.meta });
      return;
    }
    dispatch({ type: "DECISION_FAILED", failure: result });
    if (result.error.code === "STALE_STATE") await loadBrief();
  }, [loadBrief, proposalFor, transport]);

  const submitReconciliation = useCallback(async () => {
    const current = stateRef.current;
    if (current.dialog?.kind !== "RECONCILIATION" || current.workspaceVersion === null || current.pending) return;
    const evidenceId = current.reconciliationDraft.evidenceId;
    if (!evidenceId) return;
    const proposalId = current.dialog.proposalId;
    const signature = JSON.stringify({ proposalId, evidenceId });
    const idempotencyKey = resolveIdempotencyKey(current.idempotency, "RECONCILIATION", signature, newIdempotencyKey);
    dispatch({ type: "RECONCILIATION_STARTED", proposalId, idempotencyKey, signature });
    const result = await transport.reconcileProposal(proposalId, { evidenceId }, {
      workspaceVersion: current.workspaceVersion,
      idempotencyKey,
    });
    if (result.ok) {
      dispatch({ type: "RECONCILIATION_SAVED", reconciliation: result.data.reconciliation, meta: result.meta });
      return;
    }
    dispatch({ type: "RECONCILIATION_FAILED", failure: result });
    if (result.error.code === "STALE_STATE") await loadBrief();
  }, [loadBrief, transport]);

  const submitPolicy = useCallback(async () => {
    const current = stateRef.current;
    if (!current.policyDraft || current.workspaceVersion === null || current.pending) return;
    const built = controlPolicyRequest(current.policyDraft);
    if (!built.ok) {
      dispatch({ type: "POLICY_DRAFT_CHANGED", draft: { error: built.message, step: "EDIT" } });
      return;
    }
    const signature = JSON.stringify(built.request);
    const idempotencyKey = resolveIdempotencyKey(current.idempotency, "POLICY", signature, newIdempotencyKey);
    dispatch({ type: "POLICY_STARTED", idempotencyKey, signature });
    const result = await transport.putPolicy(built.request, { workspaceVersion: current.workspaceVersion, idempotencyKey });
    if (result.ok) {
      dispatch({ type: "POLICY_SAVED", policy: result.data.policy, meta: result.meta });
      return;
    }
    dispatch({ type: "POLICY_FAILED", failure: result });
    if (result.error.code === "STALE_STATE") await loadBrief();
  }, [loadBrief, transport]);

  const selectReconciliationCommitment = useCallback(async (commitmentId: string) => {
    dispatch({ type: "RECONCILIATION_DRAFT_CHANGED", draft: { commitmentId: commitmentId || null, evidenceId: null } });
    if (!commitmentId) {
      setEvidence({ kind: "IDLE" });
      return;
    }
    setEvidence({ kind: "LOADING" });
    const result = await loadEvidence(commitmentId);
    setEvidence(result.ok
      ? { kind: "READY", items: result.items }
      : { kind: "FAILED", failure: { error: result.failure.error, origin: result.failure.origin } });
  }, [loadEvidence]);

  return {
    state,
    available: state.status.kind === "READY",
    unavailable: state.status.kind === "UNAVAILABLE",
    evidence,
    reload: () => void loadBrief(false),
    handlers: {
      changeDraft: (draft) => dispatch({ type: "DRAFT_CHANGED", draft }),
      toggleCommitment: (commitmentId) => dispatch({ type: "EXISTING_COMMITMENT_TOGGLED", commitmentId }),
      submitProposal: () => void submitProposal(),
      openDecision: (proposalId, returnFocusId) => dispatch({ type: "DIALOG_OPENED", dialog: { kind: "DECISION", proposalId }, returnFocusId }),
      openReconciliation: (proposalId, returnFocusId) => {
        setEvidence({ kind: "IDLE" });
        dispatch({ type: "DIALOG_OPENED", dialog: { kind: "RECONCILIATION", proposalId }, returnFocusId });
      },
      openPolicy: (returnFocusId) => dispatch({
        type: "DIALOG_OPENED",
        dialog: { kind: "POLICY" },
        returnFocusId,
        policyDraft: policyDraftFrom(stateRef.current.brief?.policy ?? null, toMajorUnits),
      }),
      closeDialog: () => dispatch({ type: "DIALOG_CLOSED" }),
      changeDecisionDraft: (draft) => dispatch({ type: "DECISION_DRAFT_CHANGED", draft }),
      submitDecision: () => void submitDecision(),
      selectReconciliationCommitment: (commitmentId) => void selectReconciliationCommitment(commitmentId),
      selectReconciliationEvidence: (evidenceId) => dispatch({ type: "RECONCILIATION_DRAFT_CHANGED", draft: { evidenceId } }),
      submitReconciliation: () => void submitReconciliation(),
      changePolicyDraft: (draft) => dispatch({ type: "POLICY_DRAFT_CHANGED", draft }),
      submitPolicy: () => void submitPolicy(),
      focusProposal: (proposalId) => dispatch({ type: "FOCUS_SET", proposalId }),
      clearFocus: () => dispatch({ type: "FOCUS_CLEARED" }),
    },
  };
}

/** Only commitments the server will accept as cited exposure are offered. */
export function eligibleExposureCommitments(commitments: readonly CommitmentSummaryDto[]): readonly CommitmentSummaryDto[] {
  return commitments.filter((commitment) =>
    commitment.status === "ACTIVE"
    && commitment.evidenceCount > 0);
}

export function ControlView({
  desk,
  commitments,
  online,
  onInspectEvidence,
  onAddBill,
}: {
  desk: CommitmentControlDesk;
  commitments: readonly CommitmentSummaryDto[];
  online: boolean;
  onInspectEvidence: ((evidenceId: string, buttonId: string) => void) | null;
  onAddBill?: () => void;
}) {
  const { state, handlers } = desk;
  const guestDraftApplied = useRef(false);

  useEffect(() => {
    if (guestDraftApplied.current || state.status.kind !== "READY" || state.draft.merchant.trim()) return;
    const patch = controlDraftFromGuestProposal(readGuestProposalDraft());
    if (!patch) return;
    guestDraftApplied.current = true;
    handlers.changeDraft(patch);
  }, [handlers, state.draft.merchant, state.status.kind]);

  if (state.status.kind === "LOADING" || state.status.kind === "IDLE") {
    return <LoadingBlock label="Opening the Control desk…" />;
  }
  if (state.status.kind === "FAILED") {
    return (
      <FailureBlock failure={state.status.failure}>
        <button type="button" className="btn btn-sm btn-primary" onClick={desk.reload}>Try again</button>
      </FailureBlock>
    );
  }
  if (state.status.kind === "UNAVAILABLE" || !state.brief) return null;

  const { brief } = state;
  const policy = brief.policy;
  const awaitingDecision = brief.proposals.filter((entry) => entry.evaluation !== null && entry.decision === null);
  const authorized = brief.proposals.filter((entry) => entry.decision !== null);
  const awaitingEvidence = authorized.filter((entry) => entry.decision?.action !== "DECLINE" && entry.reconciliations.length === 0);
  const dialogProposalId = state.dialog && state.dialog.kind !== "POLICY" ? state.dialog.proposalId : null;
  const dialogEntry = dialogProposalId
    ? brief.proposals.find((entry) => entry.proposal.id === dialogProposalId) ?? null
    : null;

  const blockedReason = !brief.capabilities.canSubmitProposal
    ? "This account can read the Control desk but cannot submit a proposal."
    : policy === null
      ? "No policy version exists yet, so no proposal can be evaluated. A workspace owner or admin has to record one first."
      : null;
  const activeStep = activeCommitmentControlStep({
    citedEvidence: commitments.some((commitment) => commitment.evidenceCount > 0),
    hasPolicy: policy !== null,
    awaitingHumanDecision: awaitingDecision.length > 0,
    authorizedAwaitingEvidence: awaitingEvidence.length > 0,
  });

  return (
    <div className="control-desk">
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{state.announcement}</p>

      {/* What the desk already knows, before any new work is entered. Every
          figure below is a count of server records or a published policy
          version — nothing is derived, projected or estimated here. */}
      <section aria-labelledby="control-masthead-heading" className="control-masthead">
        <div className="control-masthead-top">
          <h3 id="control-masthead-heading" className="control-masthead-title">Commitment Control</h3>
          <p className="control-masthead-stamp">
            {policy === null ? "No policy version recorded" : `Policy version ${policy.policyVersion} · recorded ${formatMoment(policy.createdAt)}`}
          </p>
        </div>
        <AuthorizationLoop compact activeStep={activeStep} />
        <dl className="control-figures">
          <div className="control-figure truth-policy">
            <dt>Policy in force</dt>
            <dd>{policy === null ? "None" : `v${policy.policyVersion}`}<small>{policy === null ? "No proposal can be evaluated" : `${policy.categoryRules.length} of ${controlCategories.length} categories set`}</small></dd>
          </div>
          <div className="control-figure truth-frozen">
            <dt>Currency limits</dt>
            <dd>{policy === null ? "0" : String(policy.currencyLimits.length)}<small>{policy === null || policy.currencyLimits.length === 0 ? "No currency carries a limit" : policy.currencyLimits.map((limit) => limit.currency).join(" · ")}</small></dd>
          </div>
          <div className="control-figure truth-authority">
            <dt>Needs a human decision</dt>
            <dd>{String(awaitingDecision.length)}<small>{brief.capabilities.canDecide ? "You can decide these" : "Owner or admin only"}</small></dd>
          </div>
          <div className="control-figure truth-observed">
            <dt>Awaiting evidence</dt>
            <dd>{String(awaitingEvidence.length)}<small>{`${authorized.length} authorized in total`}</small></dd>
          </div>
        </dl>
      </section>

      {state.staleNotice ? (
        <div role="alert">
          <StateBlock
            eyebrow="Workspace moved on"
            title="Your entry was kept, not sent"
            detail={state.staleNotice}
            tone="caution"
          />
        </div>
      ) : null}

      {policy === null ? (
        <StateBlock
          eyebrow="No policy yet"
          title={brief.capabilities.canConfigurePolicy ? "Record the first policy version" : "This workspace has no policy version"}
          detail={brief.capabilities.canConfigurePolicy
            ? "Policy sets category posture and per-currency limits. It never decides anything on its own; it only tells you what a proposal crosses."
            : "Only a workspace owner or admin can record a policy. Until one exists, no proposal can be evaluated here."}
          tone="caution"
        >
          {brief.capabilities.canConfigurePolicy ? (
            <button
              id="control-policy-setup"
              type="button"
              className="btn btn-sm btn-seal"
              onClick={() => handlers.openPolicy("control-policy-setup")}
            >
              Set the policy
            </button>
          ) : null}
        </StateBlock>
      ) : null}

      {state.failure && !state.staleNotice ? <FailureBlock failure={state.failure} /> : null}

      <ControlProposalComposer
        draft={state.draft}
        errors={state.draftErrors}
        pending={state.pending?.kind === "PROPOSAL"}
        online={online}
        primary={awaitingDecision.length === 0}
        blockedReason={blockedReason}
        eligibleCommitments={eligibleExposureCommitments(commitments)}
        handlers={{
          onChange: handlers.changeDraft,
          onToggleCommitment: handlers.toggleCommitment,
          onSubmit: handlers.submitProposal,
        }}
      />

      <section
        aria-labelledby="control-queue-heading"
        className="control-band"
        data-empty={awaitingDecision.length === 0 ? "true" : undefined}
      >
        <div className="control-band-head">
          <h3 id="control-queue-heading" className="control-heading">Needs a decision</h3>
          <p className="control-band-count">{commitmentControlStepLabel(4)}</p>
        </div>
        {awaitingDecision.length === 0 ? (
          <p className="control-note">
            {brief.proposals.length === 0
              ? "No proposal has been entered yet. The first one you evaluate appears here."
              : "Every evaluated proposal already carries a decision."}
          </p>
        ) : (
          <div className="control-card-list">
            {awaitingDecision.map((entry, index) => (
              <ControlProposalRow
                key={entry.proposal.id}
                entry={entry}
                canDecide={brief.capabilities.canDecide}
                pendingKind={pendingKindFor(state, entry.proposal.id)}
                focused={state.focusProposalId === entry.proposal.id}
                lead={index === 0}
                online={online}
                onDecide={handlers.openDecision}
                onReconcile={handlers.openReconciliation}
                onInspectEvidence={onInspectEvidence}
                onFocused={handlers.clearFocus}
              />
            ))}
          </div>
        )}
      </section>

      <section
        aria-labelledby="control-authorized-heading"
        className="control-band"
        data-empty={authorized.length === 0 ? "true" : undefined}
      >
        <div className="control-band-head">
          <h3 id="control-authorized-heading" className="control-heading">Authorized commitments</h3>
          <p className="control-band-count">{commitmentControlStepLabel(5)}</p>
        </div>
        {authorized.length === 0 ? (
          <p className="control-note">No proposal has been decided yet.</p>
        ) : (
          <div className="control-card-list">
            {authorized.map((entry) => (
              <ControlProposalRow
                key={entry.proposal.id}
                entry={entry}
                canDecide={brief.capabilities.canDecide}
                pendingKind={pendingKindFor(state, entry.proposal.id)}
                focused={state.focusProposalId === entry.proposal.id}
                lead={false}
                online={online}
                onDecide={handlers.openDecision}
                onReconcile={handlers.openReconciliation}
                onInspectEvidence={onInspectEvidence}
                onFocused={handlers.clearFocus}
              />
            ))}
          </div>
        )}
      </section>

      <section
        aria-labelledby="control-policy-heading"
        className="control-band"
        data-empty={policy === null ? "true" : undefined}
      >
        <div className="control-band-head">
          <h3 id="control-policy-heading" className="control-heading">Policy</h3>
          <p className="control-band-count">{policy ? `Version ${policy.policyVersion} · recorded ${formatMoment(policy.createdAt)}` : "Not set"}</p>
        </div>
        {policy ? (
          <div className="control-policy-summary">
            <dl className="control-posture-board">
              {controlCategories.map((category) => {
                const rule = policy.categoryRules.find((entry) => entry.category === category);
                return (
                  <div key={category} className="control-posture" data-posture={rule ? rule.posture : "UNSET"}>
                    <dt>{controlCategoryLabels[category]}</dt>
                    <dd>{rule ? controlPostureLabels[rule.posture] : "Not set"}</dd>
                  </div>
                );
              })}
            </dl>
            {policy.currencyLimits.length ? (
              <ul className="control-review-list">
                {policy.currencyLimits.map((limit) => (
                  <li key={limit.currency}>
                    <span className="font-data text-(--ink)">{limit.currency}</span>
                    <span className="font-data tnum text-(--ink-soft)">
                      per charge {formatControlMoney(limit.maxPerChargeMinor, limit.currency)}
                      {" · 13 weeks "}{formatControlMoney(limit.maxThirteenWeekMinor, limit.currency)}
                      {" · annual "}{formatControlMoney(limit.maxAnnualMinor, limit.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="control-note">No currency carries limits in this version.</p>
            )}
            {brief.capabilities.canConfigurePolicy ? (
              <button
                id="control-policy-edit"
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => handlers.openPolicy("control-policy-edit")}
              >
                Record a new policy version
              </button>
            ) : (
              <p className="control-note">Only a workspace owner or admin can record a new policy version.</p>
            )}
          </div>
        ) : (
          <p className="control-note">No policy version has been recorded in this workspace.</p>
        )}
      </section>

      {state.dialog?.kind === "DECISION" && dialogEntry ? (
        <ControlDecisionDialog
          proposal={dialogEntry.proposal}
          evaluation={dialogEntry.evaluation}
          draft={state.decisionDraft}
          pending={state.pending?.kind === "DECISION"}
          online={online}
          failure={state.failure}
          returnFocusId={state.returnFocusId}
          onChange={handlers.changeDecisionDraft}
          onClose={handlers.closeDialog}
          onSubmit={handlers.submitDecision}
        />
      ) : null}

      {state.dialog?.kind === "RECONCILIATION" && dialogEntry?.decision ? (
        <ControlReconciliationDialog
          proposal={dialogEntry.proposal}
          decision={dialogEntry.decision}
          commitments={commitments}
          draft={state.reconciliationDraft}
          evidence={desk.evidence}
          pending={state.pending?.kind === "RECONCILIATION"}
          online={online}
          failure={state.failure}
          returnFocusId={state.returnFocusId}
          onSelectCommitment={handlers.selectReconciliationCommitment}
          onSelectEvidence={handlers.selectReconciliationEvidence}
          onClose={handlers.closeDialog}
          onSubmit={handlers.submitReconciliation}
          onAddBill={onAddBill}
        />
      ) : null}

      {state.dialog?.kind === "POLICY" && state.policyDraft ? (
        <ControlPolicyDialog
          draft={state.policyDraft}
          currentVersion={policy?.policyVersion ?? null}
          pending={state.pending?.kind === "POLICY"}
          online={online}
          failure={state.failure}
          returnFocusId={state.returnFocusId}
          onChange={handlers.changePolicyDraft}
          onClose={handlers.closeDialog}
          onSubmit={handlers.submitPolicy}
        />
      ) : null}
    </div>
  );
}

function pendingKindFor(state: ControlState, proposalId: string): "DECISION" | "RECONCILIATION" | null {
  const pending = state.pending;
  if (!pending || pending.kind === "PROPOSAL" || pending.kind === "POLICY") return null;
  return pending.proposalId === proposalId ? pending.kind : null;
}
