"use client";

import type { ControlDecisionDto, ControlProposalDto } from "@/lib/commitment-control/contracts";
import type { CommitmentSummaryDto, EvidenceDto } from "@/lib/recovery/contracts";
import { formatDay } from "../labels";
import { RecoveryDialog } from "../recovery-dialog";
import { FailureBlock, LoadingBlock } from "../recovery-states";
import type { RecoveryFailure } from "../state";
import { ControlFact } from "./control-evaluation";
import type { ControlReconciliationDraft } from "./control-state";

export type ControlEvidenceState =
  | { kind: "IDLE" }
  | { kind: "LOADING" }
  | { kind: "READY"; items: readonly EvidenceDto[] }
  | { kind: "FAILED"; failure: RecoveryFailure };

// Reconciliation reuses the Recovery evidence already stored in this workspace.
// Nothing is uploaded, matched, or guessed here: a person names the receipt, and
// the server compares it with the frozen authorization.

export function ControlReconciliationDialog({
  proposal,
  decision,
  commitments,
  draft,
  evidence,
  pending,
  online,
  failure,
  returnFocusId,
  onSelectCommitment,
  onSelectEvidence,
  onClose,
  onSubmit,
  onAddBill,
}: {
  proposal: ControlProposalDto;
  decision: ControlDecisionDto;
  commitments: readonly CommitmentSummaryDto[];
  draft: ControlReconciliationDraft;
  evidence: ControlEvidenceState;
  pending: boolean;
  online: boolean;
  failure: RecoveryFailure | null;
  returnFocusId: string | null;
  onSelectCommitment: (commitmentId: string) => void;
  onSelectEvidence: (evidenceId: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  onAddBill?: () => void;
}) {
  const merchantFilter = proposal.merchant.trim().toLowerCase();
  const filteredCommitments = merchantFilter
    ? commitments.filter((commitment) => commitment.merchant.toLowerCase().includes(merchantFilter) || merchantFilter.includes(commitment.merchant.toLowerCase()))
    : commitments;
  const listed = filteredCommitments.length ? filteredCommitments : commitments;
  const selectedCommitment = commitments.find((commitment) => commitment.id === draft.commitmentId) ?? null;
  return (
    <RecoveryDialog
      title="Link observed evidence"
      description="This is the last unique step: a later receipt is compared to the frozen cap. The authorization is never rewritten by what the receipt shows."
      onClose={onClose}
      returnFocusId={returnFocusId}
      footer={
        <>
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
      <dl className="proof mt-2">
        <ControlFact label="Frozen expected" money={{ minor: decision.expectedAmountMinor, currency: decision.currency, provenance: { kind: "frozen" } }} />
        {decision.approvedCapMinor === null ? (
          <ControlFact label="Approved cap" value="No cap — declined" engraved />
        ) : (
          <ControlFact label="Approved cap" money={{ minor: decision.approvedCapMinor, currency: decision.currency, provenance: { kind: "frozen" } }} />
        )}
      </dl>
      <p className="control-card-meta mt-2">{proposal.merchant} · authorized in {decision.currency}</p>

      <div className="control-field mt-5">
        <label className="field-label" htmlFor="control-reconcile-commitment">Saved bill to take the receipt from</label>
        <select
          id="control-reconcile-commitment"
          className="field"
          value={draft.commitmentId ?? ""}
          onChange={(event) => onSelectCommitment(event.target.value)}
        >
          <option value="">Choose a bill…</option>
          {listed.map((commitment) => (
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
          <div>
            <p className="control-note">This bill has no saved receipt to link.</p>
            {onAddBill ? (
              <button type="button" className="btn btn-ghost mt-3" onClick={onAddBill}>Add a bill</button>
            ) : null}
          </div>
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
              </label>
            ))}
          </fieldset>
        )}
      </div>

      {failure ? <div className="mt-4"><FailureBlock failure={failure} /></div> : null}
      {!online ? <p className="control-note mt-3">This device is offline. Nothing will be sent until the connection returns.</p> : null}
    </RecoveryDialog>
  );
}
