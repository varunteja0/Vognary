"use client";

import type { ControlEvaluationDto, ControlProposalDto } from "@/lib/commitment-control/contracts";
import { indiaCalendarDate } from "@/lib/date-only";
import { RecoveryDialog } from "../recovery-dialog";
import { FailureBlock } from "../recovery-states";
import type { RecoveryFailure } from "../state";
import { ControlFact } from "./control-evaluation";
import {
  controlDecisionActionLabels,
  controlDecisionActionMeanings,
  controlDecisionActions,
  controlStatusLabels,
  controlStatusToneClass,
  formatControlMoney,
} from "./control-format";
import type { ControlDecisionDraft } from "./control-state";
import { ControlOutcomeFact } from "./control-outcome-fact";

export function ControlDecisionDialog({
  proposal,
  evaluation,
  draft,
  pending,
  online,
  failure,
  returnFocusId,
  onChange,
  onClose,
  onSubmit,
}: {
  proposal: ControlProposalDto;
  evaluation: ControlEvaluationDto | null;
  draft: ControlDecisionDraft;
  pending: boolean;
  online: boolean;
  failure: RecoveryFailure | null;
  returnFocusId: string | null;
  onChange: (draft: Partial<ControlDecisionDraft>) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const today = indiaCalendarDate();
  const approvalWindowClosed = proposal.intendedOutcome !== null && proposal.intendedOutcome.reviewOn < today;
  return (
    <RecoveryDialog
      title="Authorize this obligation"
      description="Vognary records your decision. It does not purchase, provision, cancel, or move any money."
      onClose={onClose}
      returnFocusId={returnFocusId}
      footer={
        <>
          {draft.error ? <p role="alert" className="mr-auto text-sm text-ember">{draft.error}</p> : null}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="control-decision-form" className="btn btn-primary" disabled={pending || !online || !draft.action}>
            {pending ? "Recording…" : "Record decision"}
          </button>
        </>
      }
    >
      <dl className="control-facts">
        <ControlFact label="Merchant" value={proposal.merchant} />
        <ControlFact label="Purpose" value={proposal.purpose} />
        <ControlFact label="Assumption per charge" money={{ minor: proposal.amountMinor, currency: proposal.currency, provenance: { kind: "assumed" } }} />
        <ControlOutcomeFact outcome={proposal.intendedOutcome} />
      </dl>

      {evaluation ? (
        <p className="proof-head mt-4">
          <span className={controlStatusToneClass[evaluation.status]}>{controlStatusLabels[evaluation.status]}</span>
          <span className="control-card-meta">Policy version {evaluation.policyVersion} · policy context only, not an authorization</span>
        </p>
      ) : null}

      <form
        id="control-decision-form"
        noValidate
        className="mt-5"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <fieldset className="control-choice-set">
          <legend className="field-label">Your decision</legend>
          {controlDecisionActions.map((action) => (
            <label key={action} className="control-choice" htmlFor={`control-action-${action}`}>
              <input
                id={`control-action-${action}`}
                className="tick"
                type="radio"
                name="control-decision-action"
                value={action}
                checked={draft.action === action}
                disabled={approvalWindowClosed && action !== "DECLINE"}
                onChange={() => onChange({ action })}
              />
              <span className="control-choice-title">{controlDecisionActionLabels[action]}</span>
              <span className="control-note">{controlDecisionActionMeanings[action]}</span>
            </label>
          ))}
        </fieldset>

        {approvalWindowClosed ? (
          <p role="alert" className="control-note mt-3">The outcome review date has passed. This proposal can only be declined; submit a new proposal to create a new authorization window.</p>
        ) : null}

        {draft.action && draft.action !== "DECLINE" ? (
          <div className="control-field mt-4">
            <label className="field-label" htmlFor="control-authorization-expiry">Authorization expires on</label>
            <input
              id="control-authorization-expiry"
              name="authorizationExpiresOn"
              className="field font-data"
              type="date"
              min={today}
              max={proposal.intendedOutcome?.reviewOn}
              value={draft.authorizationExpiresOn}
              aria-invalid={draft.error ? true : undefined}
              onChange={(event) => onChange({ authorizationExpiresOn: event.target.value })}
            />
            <p className="field-hint">The decision stays frozen after this date. Renewal requires a new proposal; nothing expires automatically.</p>
          </div>
        ) : null}

        {draft.action === "APPROVE_WITH_CAP" ? (
          <div className="control-field mt-4">
            <label className="field-label" htmlFor="control-cap">Approved cap per charge ({proposal.currency})</label>
            <input
              id="control-cap"
              name="approvedCapMinor"
              className="field font-data tnum"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={draft.capText}
              aria-invalid={draft.error ? true : undefined}
              aria-describedby="control-cap-hint"
              onChange={(event) => onChange({ capText: event.target.value })}
            />
            <p id="control-cap-hint" className="field-hint">
              At or below {formatControlMoney(proposal.amountMinor, proposal.currency)}. This exact figure is frozen.
            </p>
          </div>
        ) : null}

        {evaluation?.status === "OUTSIDE_POLICY" && draft.action && draft.action !== "DECLINE" ? (
          <div className="control-field mt-4">
            <label className="field-label" htmlFor="control-override-reason">Why this outside-policy proposal is authorized</label>
            <textarea
              id="control-override-reason"
              className="field"
              rows={3}
              maxLength={500}
              value={draft.overrideReason}
              onChange={(event) => onChange({ overrideReason: event.target.value })}
            />
            <p className="field-hint">Required. This reason is stored with the decision and is never an automatic approval.</p>
          </div>
        ) : null}
      </form>

      {failure ? <div className="mt-4"><FailureBlock failure={failure} /></div> : null}
      {!online ? <p className="control-note mt-3">This device is offline. Nothing will be sent until the connection returns.</p> : null}
    </RecoveryDialog>
  );
}
