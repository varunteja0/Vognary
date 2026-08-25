"use client";

import { useEffect, useRef } from "react";
import type { CommitmentControlBriefDto } from "@/lib/commitment-control/contracts";
import { formatDay, formatMoment } from "../labels";
import { ControlEvaluation, ControlFact } from "./control-evaluation";
import {
  controlDecisionRecordedLabels,
  controlVerdictLabels,
  controlVerdictMeanings,
  controlVerdictToneClass,
  formatControlMoney,
} from "./control-format";

export type ControlProposalEntry = CommitmentControlBriefDto["proposals"][number];

// One proposal, one card: the assumption, the citation, the policy context, the
// frozen decision, and every appended observation. Nothing here is recomputed.

export function ControlProposalRow({
  entry,
  canDecide,
  pendingKind,
  focused,
  online,
  onDecide,
  onReconcile,
  onInspectEvidence,
  onFocused,
}: {
  entry: ControlProposalEntry;
  canDecide: boolean;
  pendingKind: "DECISION" | "RECONCILIATION" | null;
  focused: boolean;
  online: boolean;
  onDecide: (proposalId: string, buttonId: string) => void;
  onReconcile: (proposalId: string, buttonId: string) => void;
  onInspectEvidence: ((evidenceId: string, buttonId: string) => void) | null;
  onFocused: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { proposal, evaluation, decision, reconciliations } = entry;

  useEffect(() => {
    if (!focused) return;
    headingRef.current?.focus();
    onFocused();
  }, [focused, onFocused]);

  const decideButtonId = `control-decide-${proposal.id}`;
  const reconcileButtonId = `control-reconcile-${proposal.id}`;

  return (
    <article className="control-card" aria-labelledby={`control-proposal-${proposal.id}`}>
      <header className="control-card-head">
        <h4
          id={`control-proposal-${proposal.id}`}
          ref={headingRef}
          tabIndex={-1}
          data-focus-quiet
          className="control-card-title outline-none"
        >
          {proposal.merchant}
        </h4>
        <p className="control-card-purpose">{proposal.purpose}</p>
        <p className="font-data text-xs text-(--muted)">Entered {formatMoment(proposal.createdAt)}</p>
      </header>

      {evaluation ? (
        <ControlEvaluation proposal={proposal} evaluation={evaluation} onInspectEvidence={onInspectEvidence} />
      ) : (
        <p className="control-note">This proposal carries no evaluation, so there is no policy context to show.</p>
      )}

      {decision ? (
        <section aria-label={`Decision for ${proposal.merchant}`} className="control-decision">
          <p className="eyebrow eyebrow-xs">Human decision</p>
          <dl className="control-facts">
            <ControlFact label="Decision" value={controlDecisionRecordedLabels[decision.action]} />
            <ControlFact label="Frozen expected" value={formatControlMoney(decision.expectedAmountMinor, decision.currency)} />
            <ControlFact
              label="Approved cap"
              value={decision.approvedCapMinor === null ? "No cap — declined" : formatControlMoney(decision.approvedCapMinor, decision.currency)}
            />
            <ControlFact label="Policy version" value={String(decision.evaluationPolicyVersion)} />
            <ControlFact label="Decided" value={formatMoment(decision.decidedAt)} />
          </dl>
        </section>
      ) : evaluation ? (
        <div className="control-card-actions">
          {canDecide ? (
            <button
              id={decideButtonId}
              type="button"
              className="btn btn-sm btn-primary"
              disabled={pendingKind !== null || !online}
              onClick={() => onDecide(proposal.id, decideButtonId)}
            >
              {pendingKind === "DECISION" ? "Recording…" : "Decide this proposal"}
            </button>
          ) : (
            <p className="control-note">
              This proposal is waiting on a workspace owner or admin. No decision has been recorded yet.
            </p>
          )}
        </div>
      ) : null}

      {reconciliations.length ? (
        <section aria-label={`Observed outcomes for ${proposal.merchant}`} className="control-outcomes">
          <p className="eyebrow eyebrow-xs">Observed outcomes</p>
          <ul className="control-outcome-list">
            {reconciliations.map((reconciliation, index) => (
              <li key={reconciliation.id} className="control-outcome">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={controlVerdictToneClass[reconciliation.verdict]}>{controlVerdictLabels[reconciliation.verdict]}</span>
                  <span className="font-data text-xs text-(--muted)">{formatMoment(reconciliation.reconciledAt)}</span>
                </div>
                <p className="control-note">{controlVerdictMeanings[reconciliation.verdict]}</p>
                <dl className="control-facts">
                  <ControlFact
                    label="Frozen expected"
                    value={formatControlMoney(reconciliation.expectedAmountMinor, reconciliation.authorizationCurrency)}
                  />
                  <ControlFact
                    label="Frozen cap"
                    value={reconciliation.approvedCapMinor === null
                      ? "No cap — declined"
                      : formatControlMoney(reconciliation.approvedCapMinor, reconciliation.authorizationCurrency)}
                  />
                  <ControlFact
                    label="Observed"
                    value={formatControlMoney(reconciliation.observedAmountMinor, reconciliation.observedCurrency)}
                  />
                  <ControlFact label="Authorized in" value={reconciliation.authorizationCurrency} />
                  <ControlFact label="Observed in" value={reconciliation.observedCurrency ?? "Not published"} />
                </dl>
                {onInspectEvidence ? (
                  <button
                    id={`control-outcome-evidence-${reconciliation.id}`}
                    type="button"
                    className="link-quiet"
                    onClick={() => onInspectEvidence(reconciliation.evidenceId, `control-outcome-evidence-${reconciliation.id}`)}
                  >
                    Open the observed receipt
                  </button>
                ) : (
                  <span className="font-data text-xs text-(--muted)">Observation {index + 1}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {decision && decision.action !== "DECLINE" ? (
        <div className="control-card-actions">
          {canDecide ? (
            <button
              id={reconcileButtonId}
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={pendingKind !== null || !online}
              onClick={() => onReconcile(proposal.id, reconcileButtonId)}
            >
              {pendingKind === "RECONCILIATION" ? "Linking…" : "Link observed evidence"}
            </button>
          ) : null}
          <p className="control-note">
            The frozen cap never changes. A later observation is appended beside it, whatever it shows.
          </p>
        </div>
      ) : null}

      <p className="font-data text-xs text-(--muted)">
        Projected from {formatDay(proposal.asOfDate)} · assumption basis {proposal.assumptionBasis === "USER_ENTERED_ASSUMPTION" ? "user entered" : proposal.assumptionBasis}
      </p>
    </article>
  );
}
