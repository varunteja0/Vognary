"use client";

import { useEffect, useRef } from "react";
import type { CommitmentControlBriefDto } from "@/lib/commitment-control/contracts";
import { formatMoment } from "../labels";
import { ControlEvaluation, ControlFact } from "./control-evaluation";
import {
  controlDecisionRecordedLabels,
  controlStatusLabels,
  controlStatusToneClass,
  controlVerdictLabels,
  controlVerdictMeanings,
  controlVerdictToneClass,
  formatControlMoney,
  type ControlReconciliationVerdict,
} from "./control-format";

export type ControlProposalEntry = CommitmentControlBriefDto["proposals"][number];

// One proposal, one record. The frozen expected amount, the authorized cap and
// every later observation live in a single proof ledger, on adjacent rows,
// sharing one right-hand money column so the comparison is a glance rather
// than an act of memory. Nothing here is recomputed: every figure is the
// server's, rendered as published, and a later observation never rewrites the
// authorization it is compared against.

const proofToneClass: Record<ControlReconciliationVerdict, string> = {
  MATCHED: "proof proof-observed",
  WITHIN_CAP: "proof proof-observed",
  OVER_CAP: "proof proof-exceeded",
  CURRENCY_MISMATCH: "proof proof-unknown",
  CANNOT_EVALUATE: "proof proof-unknown",
};

export function ControlProposalRow({
  entry,
  canDecide,
  pendingKind,
  focused,
  lead,
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
  lead: boolean;
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
    <article
      className="control-card"
      data-lead={lead && !decision ? "true" : undefined}
      data-settled={decision ? "true" : undefined}
      aria-labelledby={`control-proposal-${proposal.id}`}
    >
      <header className="control-card-head">
        <div className="control-card-topline">
          <h4
            id={`control-proposal-${proposal.id}`}
            ref={headingRef}
            tabIndex={-1}
            data-focus-quiet
            className="control-card-title outline-none"
          >
            {proposal.merchant}
          </h4>
          {decision ? (
            <span className="pill pill-planned">{controlDecisionRecordedLabels[decision.action]}</span>
          ) : evaluation ? (
            <span className="pill pill-partial">Awaiting a human decision</span>
          ) : null}
        </div>
        <p className="control-card-purpose">{proposal.purpose}</p>
        <p className="control-card-meta">Entered {formatMoment(proposal.createdAt)} · {proposal.submittedByDisplayName ? `by ${proposal.submittedByDisplayName}` : "submitter name not on record"} · basis {proposal.assumptionBasis === "USER_ENTERED_ASSUMPTION" ? "user entered" : proposal.assumptionBasis}</p>
      </header>

      {decision ? (
        <section aria-label={`Authorization for ${proposal.merchant}`} className="control-authority">
          <p className="truth-label truth-authority">Human authorization · frozen</p>
          <p className="control-card-meta">
            Decided {formatMoment(decision.decidedAt)} on policy version {decision.evaluationPolicyVersion}
            {decision.decidedByDisplayName ? ` · by ${decision.decidedByDisplayName}` : ""}
          </p>
          {reconciliations.length === 0 ? (
            <div className="control-settled">
              <dl className="proof">
                <ControlFact label="Frozen expected" value={formatControlMoney(decision.expectedAmountMinor, decision.currency)} engraved />
                <ControlFact
                  label="Approved cap"
                  value={decision.approvedCapMinor === null ? "No cap — declined" : formatControlMoney(decision.approvedCapMinor, decision.currency)}
                  engraved
                />
                <ControlFact label="Observed" value="Awaiting evidence" observed />
              </dl>
              <div className="control-settled-side">
                <p className="proof-head">
                  <span className="pill pill-planned">Awaiting evidence</span>
                </p>
                <p className="control-note">
                  No receipt has been linked to this authorization yet, so nothing has been observed against the frozen cap.
                </p>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {reconciliations.length ? (
        <section aria-label={`Observed outcomes for ${proposal.merchant}`} className="control-outcomes">
          <p className="truth-label truth-observed">Observed outcome</p>
          <ul className="control-outcome-list">
            {reconciliations.map((reconciliation, index) => (
              <li key={reconciliation.id} className="control-outcome control-settled">
                <dl className={proofToneClass[reconciliation.verdict]}>
                  <ControlFact
                    label="Frozen expected"
                    value={formatControlMoney(reconciliation.expectedAmountMinor, reconciliation.authorizationCurrency)}
                    engraved
                  />
                  <ControlFact
                    label="Frozen cap"
                    value={reconciliation.approvedCapMinor === null
                      ? "No cap — declined"
                      : formatControlMoney(reconciliation.approvedCapMinor, reconciliation.authorizationCurrency)}
                    engraved
                  />
                  <ControlFact
                    label="Observed"
                    value={formatControlMoney(reconciliation.observedAmountMinor, reconciliation.observedCurrency)}
                    observed
                  />
                </dl>
                <div className="control-settled-side">
                  <p className="proof-head">
                    <span className={controlVerdictToneClass[reconciliation.verdict]}>{controlVerdictLabels[reconciliation.verdict]}</span>
                  </p>
                  <p className="control-note">{controlVerdictMeanings[reconciliation.verdict]}</p>
                  <p className="control-card-meta">
                    {formatMoment(reconciliation.reconciledAt)} · authorized in {reconciliation.authorizationCurrency} · observed in {reconciliation.observedCurrency ?? "no published currency"}
                  </p>
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
                    <span className="control-card-meta">Observation {index + 1}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {evaluation ? (
        decision ? (
          // Once a person has authorized, the pre-decision reading becomes
          // history: the authority, cap, observation, verdict and evidence stay
          // on the page and the policy reading is opened on demand.
          <details className="control-more">
            <summary>
              How policy read this proposal
              <span className={controlStatusToneClass[evaluation.status]}>{controlStatusLabels[evaluation.status]}</span>
            </summary>
            <div className="control-more-body">
              <ControlEvaluation proposal={proposal} evaluation={evaluation} onInspectEvidence={onInspectEvidence} />
            </div>
          </details>
        ) : (
          <ControlEvaluation proposal={proposal} evaluation={evaluation} onInspectEvidence={onInspectEvidence} />
        )
      ) : (
        <p className="control-note">This proposal carries no evaluation, so there is no policy context to show.</p>
      )}

      {!decision && evaluation ? (
        <div className="control-card-actions">
          {canDecide ? (
            <button
              id={decideButtonId}
              type="button"
              className={lead ? "btn btn-primary" : "btn btn-seal"}
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
    </article>
  );
}
