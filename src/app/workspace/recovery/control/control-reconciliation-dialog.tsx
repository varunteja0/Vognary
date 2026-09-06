"use client";

import { Plus } from "lucide-react";
import type { ControlDecisionDto, ControlProposalDto } from "@/lib/commitment-control/contracts";
import type { ControlReconciliationCandidate } from "@/lib/commitment-control/reconciliation-candidates";
import type { CommitmentSummaryDto, EvidenceDto } from "@/lib/recovery/contracts";
import { formatDay } from "../labels";
import { RecoveryDialog } from "../recovery-dialog";
import { FailureBlock, LoadingBlock } from "../recovery-states";
import type { RecoveryFailure } from "../state";
import { ControlFact } from "./control-evaluation";
import { ControlAuthorizationAmountFacts } from "./control-authorization-facts";
import { formatControlMoney } from "./control-format";
import { ControlOutcomeFact } from "./control-outcome-fact";
import type { ControlReconciliationDraft } from "./control-state";

export type ControlEvidenceState =
  | { kind: "IDLE" }
  | { kind: "LOADING" }
  | { kind: "READY"; items: readonly EvidenceDto[] }
  | { kind: "FAILED"; failure: RecoveryFailure };

export type ControlCandidateState =
  | { kind: "IDLE" | "LOADING" }
  | { kind: "READY"; items: readonly ControlReconciliationCandidate[] }
  | { kind: "FAILED" };

// Reconciliation reuses the Recovery evidence already stored in this workspace.
// Nothing is uploaded, matched, or guessed here: a person names the receipt, and
// the server compares it with the frozen authorization.

export function ControlReconciliationDialog({
  proposal,
  decision,
  commitments,
  draft,
  evidence,
  candidates,
  pending,
  online,
  failure,
  returnFocusId,
  onSelectCommitment,
  onSelectEvidence,
  onChange,
  onClose,
  onSubmit,
  onAddBill,
}: {
  proposal: ControlProposalDto;
  decision: ControlDecisionDto;
  commitments: readonly CommitmentSummaryDto[];
  draft: ControlReconciliationDraft;
  evidence: ControlEvidenceState;
  candidates: ControlCandidateState;
  pending: boolean;
  online: boolean;
  failure: RecoveryFailure | null;
  returnFocusId: string | null;
  onSelectCommitment: (commitmentId: string) => void;
  onSelectEvidence: (evidenceId: string) => void;
  onChange: (draft: Partial<ControlReconciliationDraft>) => void;
  onClose: () => void;
  onSubmit: () => void;
  onAddBill?: () => void;
}) {
  const selectedCommitment = commitments.find((commitment) => commitment.id === draft.commitmentId) ?? null;
  return (
    <RecoveryDialog
      title="Link observed evidence"
      description="Choose the observed receipt. The saved authorization and cap stay unchanged."
      onClose={onClose}
      returnFocusId={returnFocusId}
      footer={
        <>
          {draft.error ? <p role="alert" className="mr-auto text-sm text-ember">{draft.error}</p> : null}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || !online || draft.evidenceId === null}
            onClick={onSubmit}
          >
            {pending ? "Comparing…" : "Link this receipt"}
          </button>
        </>
      }
    >
      <p className="truth-label truth-frozen">Frozen authorization · never rewritten</p>
      <div className="ledger mt-2">
        <dl className="ledger-rows">
          <ControlAuthorizationAmountFacts decision={decision} />
        </dl>
      </div>
      <p className="control-card-meta mt-2">{proposal.merchant} · authorized in {decision.currency}</p>
      <dl className="control-facts mt-4">
        <ControlFact
          label="Authorization expiry"
          value={decision.authorizationExpiresOn ? formatDay(decision.authorizationExpiresOn) : "Not recorded on this legacy decision"}
        />
        <ControlOutcomeFact outcome={proposal.intendedOutcome} />
      </dl>

      {candidates.kind === "LOADING" ? (
        <p className="control-note mt-5">Checking for receipts inside the frozen authorization window…</p>
      ) : candidates.kind === "FAILED" ? (
        <p className="control-note mt-5">Receipt candidates could not be checked. You can still choose a saved bill manually.</p>
      ) : candidates.kind === "READY" && candidates.items.length > 0 ? (
        <section className="mt-5" aria-labelledby="control-candidates-heading">
          <p id="control-candidates-heading" className="field-label">Receipts available to review</p>
          <p className="control-note">
            These receipts share the authorized currency and fall inside the frozen authorization window. Vognary did not match a merchant or choose a receipt. Confirm the saved bill and exact receipt yourself.
          </p>
          <ul className="control-review-list mt-3">
            {candidates.items.map((candidate) => (
              <li key={candidate.evidenceId}>
                <span>
                  <span className="block text-sm font-medium text-(--ink)">{candidate.commitmentMerchant}</span>
                  <span className="control-card-meta">
                    {formatControlMoney(candidate.observedAmountMinor, candidate.observedCurrency)} · evidence dated {formatDay(candidate.observedEvidenceDate)}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => onSelectCommitment(candidate.commitmentId)}
                >
                  Review this saved bill
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="control-field mt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="field-label" htmlFor="control-reconcile-commitment">Saved bill to take the receipt from</label>
          {onAddBill ? (
            <button type="button" className="btn btn-sm btn-ghost" disabled={pending || !online} onClick={onAddBill}>
              <Plus size={16} aria-hidden />Add a bill
            </button>
          ) : null}
        </div>
        {commitments.length === 0 ? <p className="control-note mt-2">No bills have been saved in this workspace yet.</p> : null}
        <select
          id="control-reconcile-commitment"
          className="field mt-2"
          disabled={pending || commitments.length === 0}
          value={draft.commitmentId ?? ""}
          onChange={(event) => onSelectCommitment(event.target.value)}
        >
          <option value="">Choose a bill…</option>
          {commitments.map((commitment) => (
            <option key={commitment.id} value={commitment.id}>
              {commitment.merchant} · {commitment.amount.display}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4">
        {evidence.kind === "IDLE" ? (
          <p className="control-note">Choose a bill to list the receipts saved against it.</p>
        ) : evidence.kind === "LOADING" ? (
          <LoadingBlock label="Opening the saved receipts…" />
        ) : evidence.kind === "FAILED" ? (
          <FailureBlock failure={evidence.failure} />
        ) : evidence.items.length === 0 ? (
          <p className="control-note">This bill has no saved receipt to link.</p>
        ) : (
          <fieldset className="control-choice-set">
            <legend className="field-label">Receipt to compare</legend>
            {evidence.items.map((item) => (
              <label key={item.id} className="control-choice" htmlFor={`control-evidence-choice-${item.id}`}>
                <input
                  id={`control-evidence-choice-${item.id}`}
                  className="tick"
                  type="radio"
                  name="control-reconcile-evidence"
                  value={item.id}
                  checked={draft.evidenceId === item.id}
                  onChange={() => onSelectEvidence(item.id)}
                />
                <span className="control-choice-title font-data tnum">
                  {[selectedCommitment?.merchant, item.amount ? item.amount.display : "No amount on this receipt", item.date ? formatDay(item.date) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="control-note">{item.excerpt}</span>
                {candidates.kind === "READY" && candidates.items.some((candidate) => candidate.evidenceId === item.id) ? (
                  <span className="control-card-meta">Same currency and inside the authorization window · not matched by Vognary</span>
                ) : null}
              </label>
            ))}
          </fieldset>
        )}
      </div>

      {proposal.intendedOutcome ? (
        <div className="mt-5">
          <p className="field-label">Observed business outcome</p>
          <p className="control-note">Enter both fields to record a user-entered observation. It is not Recovery evidence or independently verified proof. Leave both blank when the outcome is not yet observed.</p>
          <div className="control-field mt-3">
            <label className="field-label" htmlFor="control-observed-outcome-value">
              Observed value ({proposal.intendedOutcome.unit})
            </label>
            <input
              id="control-observed-outcome-value"
              name="observedOutcomeValue"
              className="field font-data tnum"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={draft.outcomeValueText}
              aria-invalid={draft.error ? true : undefined}
              onChange={(event) => onChange({ outcomeValueText: event.target.value })}
            />
          </div>
          <div className="control-field mt-3">
            <label className="field-label" htmlFor="control-observed-outcome-date">Observed on</label>
            <input
              id="control-observed-outcome-date"
              name="observedOutcomeOn"
              className="field font-data"
              type="date"
              min={proposal.intendedOutcome.reviewOn}
              value={draft.outcomeObservedOn}
              aria-invalid={draft.error ? true : undefined}
              onChange={(event) => onChange({ outcomeObservedOn: event.target.value })}
            />
          </div>
        </div>
      ) : null}

      {failure ? <div className="mt-4"><FailureBlock failure={failure} /></div> : null}
      {!online ? <p className="control-note mt-3">This device is offline. Nothing will be sent until the connection returns.</p> : null}
    </RecoveryDialog>
  );
}
