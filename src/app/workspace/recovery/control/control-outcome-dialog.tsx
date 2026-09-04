"use client";

import { useState } from "react";

import type { ControlProposalDto, RecordControlOutcomeObservationRequest } from "@/lib/commitment-control/contracts";
import { formatDay } from "../labels";
import { RecoveryDialog } from "../recovery-dialog";
import { FailureBlock } from "../recovery-states";
import type { RecoveryFailure } from "../state";
import { controlOutcomeObservationRequest } from "./control-state";

export function ControlOutcomeDialog({
  proposal,
  today,
  pending,
  online,
  failure,
  returnFocusId,
  onClose,
  onSubmit,
}: {
  proposal: ControlProposalDto;
  today: string;
  pending: boolean;
  online: boolean;
  failure: RecoveryFailure | null;
  returnFocusId: string | null;
  onClose: () => void;
  onSubmit: (request: RecordControlOutcomeObservationRequest) => void;
}) {
  const target = proposal.intendedOutcome;
  const [valueText, setValueText] = useState("");
  const [observedOn, setObservedOn] = useState(today);
  const [error, setError] = useState<string | null>(null);
  if (!target) return null;

  const submit = () => {
    const built = controlOutcomeObservationRequest({ valueText, observedOn }, proposal, today);
    if (!built.ok) {
      setError(built.message);
      return;
    }
    setError(null);
    onSubmit(built.request);
  };

  return (
    <RecoveryDialog
      title="Record the observed outcome"
      description="This records a person-entered business observation against the frozen target. It is not a receipt or independently verified proof."
      onClose={onClose}
      returnFocusId={returnFocusId}
      footer={(
        <>
          {error ? <p role="alert" className="mr-auto text-sm text-ember">{error}</p> : null}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={pending || !online} onClick={submit}>
            {pending ? "Recording…" : "Record outcome"}
          </button>
        </>
      )}
    >
      <p className="truth-label truth-frozen">Frozen target · never rewritten</p>
      <p className="mt-2 text-sm text-(--ink)">
        {target.metric}: {target.targetDirection === "AT_LEAST" ? "at least" : "at most"} {target.targetValue} {target.unit}
      </p>
      <p className="control-card-meta">Review date {formatDay(target.reviewOn)}</p>
      <div className="control-field mt-5">
        <label className="field-label" htmlFor="control-standalone-outcome-value">Observed value ({target.unit})</label>
        <input
          id="control-standalone-outcome-value"
          className="field font-data tnum"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={valueText}
          onChange={(event) => { setValueText(event.target.value); setError(null); }}
        />
      </div>
      <div className="control-field mt-3">
        <label className="field-label" htmlFor="control-standalone-outcome-date">Observed on</label>
        <input
          id="control-standalone-outcome-date"
          className="field font-data"
          type="date"
          min={target.reviewOn}
          max={today}
          value={observedOn}
          onChange={(event) => { setObservedOn(event.target.value); setError(null); }}
        />
      </div>
      {failure ? <div className="mt-4"><FailureBlock failure={failure} /></div> : null}
      {!online ? <p className="control-note mt-3">This device is offline. Nothing will be sent until the connection returns.</p> : null}
    </RecoveryDialog>
  );
}