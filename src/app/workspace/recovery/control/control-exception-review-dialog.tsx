"use client";

import { useState } from "react";

import {
  controlExceptionDispositions,
  type ControlExceptionDisposition,
  type ControlExceptionTargetKind,
  type RecordControlExceptionReviewRequest,
} from "@/lib/commitment-control/contracts";
import { RecoveryDialog } from "../recovery-dialog";
import { FailureBlock } from "../recovery-states";
import type { RecoveryFailure } from "../state";
import { controlExceptionReviewRequest } from "./control-state";

const dispositionLabels: Record<ControlExceptionDisposition, string> = {
  NO_FURTHER_ACTION: "No further action",
  NEW_PROPOSAL_REQUIRED: "A new proposal is required",
  CORRECTED_OUTSIDE_VOGNARY: "Corrected outside Vognary",
};

export function ControlExceptionReviewDialog({
  headline,
  detail,
  targetKind,
  targetId,
  pending,
  online,
  failure,
  returnFocusId,
  onClose,
  onSubmit,
}: {
  headline: string;
  detail: string;
  targetKind: ControlExceptionTargetKind;
  targetId: string;
  pending: boolean;
  online: boolean;
  failure: RecoveryFailure | null;
  returnFocusId: string | null;
  onClose: () => void;
  onSubmit: (request: RecordControlExceptionReviewRequest) => void;
}) {
  const [disposition, setDisposition] = useState<ControlExceptionDisposition | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const built = controlExceptionReviewRequest({ disposition, note }, { targetKind, targetId });
    if (!built.ok) {
      setError(built.message);
      return;
    }
    setError(null);
    onSubmit(built.request);
  };

  return (
    <RecoveryDialog
      title="Record the exception disposition"
      description="This appends what a person decided to do next. It does not alter the original evidence, authorization, or verdict."
      onClose={onClose}
      returnFocusId={returnFocusId}
      footer={(
        <>
          {error ? <p role="alert" className="mr-auto text-sm text-ember">{error}</p> : null}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={pending || !online} onClick={submit}>
            {pending ? "Recording…" : "Record disposition"}
          </button>
        </>
      )}
    >
      <p className="truth-label truth-frozen">Original exception · unchanged</p>
      <h3 className="mt-2 font-display text-base font-semibold text-(--ink)">{headline}</h3>
      <p className="control-note mt-1">{detail}</p>
      <fieldset className="control-choice-set mt-5">
        <legend className="field-label">What happens next?</legend>
        {controlExceptionDispositions.map((value) => (
          <label key={value} className="control-choice" htmlFor={`control-exception-${value}`}>
            <input
              id={`control-exception-${value}`}
              className="tick"
              type="radio"
              name="control-exception-disposition"
              value={value}
              checked={disposition === value}
              onChange={() => { setDisposition(value); setError(null); }}
            />
            <span className="control-choice-title">{dispositionLabels[value]}</span>
          </label>
        ))}
      </fieldset>
      <div className="control-field mt-5">
        <label className="field-label" htmlFor="control-exception-note">Why this disposition was chosen</label>
        <textarea
          id="control-exception-note"
          className="field min-h-24"
          maxLength={500}
          value={note}
          onChange={(event) => { setNote(event.target.value); setError(null); }}
        />
      </div>
      {failure ? <div className="mt-4"><FailureBlock failure={failure} /></div> : null}
      {!online ? <p className="control-note mt-3">This device is offline. Nothing will be sent until the connection returns.</p> : null}
    </RecoveryDialog>
  );
}