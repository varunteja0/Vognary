"use client";

import { Fragment, useEffect, useRef } from "react";
import type { CommitmentControlBriefDto } from "@/lib/commitment-control/contracts";
import { formatDay, formatMoment } from "../labels";
import { ControlEvaluation, ControlFact } from "./control-evaluation";
import { ControlAuthorizationAmountFacts } from "./control-authorization-facts";
import { ControlOutcomeFact } from "./control-outcome-fact";
import {
  controlDecisionRecordedLabels,
  controlExceptionDispositionLabels,
  controlOutcomeVerdictLabels,
  controlOutcomeVerdictToneClass,
  controlStatusLabels,
  controlStatusToneClass,
  controlVerdictLabels,
  controlVerdictMeanings,
  controlVerdictToneClass,
  formatControlMoney,
} from "./control-format";

export type ControlProposalEntry = CommitmentControlBriefDto["proposals"][number];

// One proposal, one record, one ledger.
//
// The frozen figures a person authorized are rendered ONCE, at the top, and
// never again — a cap that appears twice on a screen is a cap the reader has to
// reconcile by memory. A single ruled cap line divides what was frozen before
// the spend from what arrived after it, and every later observation is appended
// below that line in the same money column, so the comparison is a glance.
//
// The contract validator already refuses any brief whose reconciliation carries
// different frozen figures from its decision (isCommitmentControlBriefDto), so
// rendering the authorization once is exact, not an assumption.
//
// Nothing here is recomputed. Every figure is the server's, rendered as
// published, and a later observation never rewrites the authorization it is
// compared against.

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
  // Null on a read-only render. The row then omits the control entirely rather
  // than mounting a button bound to nothing.
  onDecide: ((proposalId: string, buttonId: string) => void) | null;
  onReconcile: ((proposalId: string, buttonId: string) => void) | null;
  onInspectEvidence: ((evidenceId: string, buttonId: string) => void) | null;
  onFocused: (() => void) | null;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { proposal, evaluation, decision, reconciliations, outcomeObservations, exceptionReviews } = entry;

  useEffect(() => {
    if (!focused) return;
    headingRef.current?.focus();
    onFocused?.();
  }, [focused, onFocused]);

  const decideButtonId = `control-decide-${proposal.id}`;
  const reconcileButtonId = `control-reconcile-${proposal.id}`;
  // The record's tone follows the most recent observation, never an average.
  const settledVerdict = reconciliations[0]?.verdict ?? null;

  return (
    <article
      className="control-card"
      data-lead={lead && !decision ? "true" : undefined}
      data-settled={decision ? "true" : undefined}
      data-verdict={settledVerdict ?? undefined}
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

      <dl className="control-facts">
        <ControlOutcomeFact outcome={proposal.intendedOutcome} />
      </dl>

      {decision ? (
        <section aria-label={`Authorization record for ${proposal.merchant}`} className="control-authority">
          <p className="truth-label truth-authority">Human authorization · frozen</p>
          <p className="control-card-meta">
            {decision.decidedByDisplayName ?? "Deciding account not on record"} · {formatMoment(decision.decidedAt)} · policy version {decision.evaluationPolicyVersion}
            {decision.authorizationExpiresOn ? ` · expires ${decision.authorizationExpiresOn}` : " · expiry not recorded on this legacy decision"}
          </p>

          <div className="ledger">
            <dl className="ledger-rows">
              <ControlAuthorizationAmountFacts decision={decision} />
            </dl>

            {/* The cap line. Everything above it a named person froze before the
                obligation existed; everything below arrived afterwards. */}
            <p className="ledger-line">
              <span>Frozen before</span>
              <span>Observed after</span>
            </p>

            {decision.action === "DECLINE" ? (
              <p className="ledger-closed">
                Declined, so no cap was frozen and nothing can be reconciled against this record. Vognary did not cancel
                the vendor or move money.
              </p>
            ) : reconciliations.length === 0 ? (
              <>
                <dl className="ledger-rows">
                  <ControlFact label="Observed" value="Awaiting evidence" observed />
                </dl>
                <p className="ledger-closed">
                  No receipt has been linked to this authorization yet, so nothing has been observed against the frozen cap.
                </p>
              </>
            ) : (
              reconciliations.map((reconciliation, index) => (
                <Fragment key={reconciliation.id}>
                  <dl className="ledger-rows" data-verdict={reconciliation.verdict}>
                    <ControlFact
                      label={reconciliations.length > 1 ? `Observed ${index + 1}` : "Observed"}
                      {...(reconciliation.observedAmountMinor === null || reconciliation.observedCurrency === null
                        ? { value: "No comparable amount published" }
                        : {
                          money: {
                            minor: reconciliation.observedAmountMinor,
                            currency: reconciliation.observedCurrency,
                            provenance: { kind: "observed" as const },
                          },
                        })}
                      observed
                    />
                  </dl>
                  <div className="ledger-verdict" data-verdict={reconciliation.verdict}>
                    <p className="proof-head">
                      <span className={controlVerdictToneClass[reconciliation.verdict]}>{controlVerdictLabels[reconciliation.verdict]}</span>
                    </p>
                    <p className="control-note">{controlVerdictMeanings[reconciliation.verdict]}</p>
                    {reconciliation.outcome ? (
                      <>
                        <p className="proof-head mt-3">
                          <span className={controlOutcomeVerdictToneClass[reconciliation.outcome.verdict]}>
                            {controlOutcomeVerdictLabels[reconciliation.outcome.verdict]}
                          </span>
                        </p>
                        <p className="control-note">
                          {reconciliation.outcome.observedValue === null
                            ? `No observed ${reconciliation.outcome.unit} value is recorded yet.`
                            : `${reconciliation.outcome.observedValue} ${reconciliation.outcome.unit} observed on ${reconciliation.outcome.observedOn}.`}
                        </p>
                        <p className="control-card-meta">User-entered outcome observation · not Recovery evidence or independently verified proof</p>
                      </>
                    ) : null}
                    <p className="control-card-meta">
                      {formatMoment(reconciliation.reconciledAt)} · evidence dated {reconciliation.observedEvidenceDate ?? "not recorded"} · authorized in {reconciliation.authorizationCurrency} · observed in {reconciliation.observedCurrency ?? "no published currency"}
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
                      <span className="control-card-meta control-observation-index">Observation {index + 1}</span>
                    )}
                  </div>
                </Fragment>
              ))
            )}
          </div>
        </section>
      ) : null}

      {outcomeObservations.map((observation) => (
        <section key={observation.id} aria-label={`Outcome observation for ${proposal.merchant}`} className="control-authority">
          <p className="truth-label">User-entered outcome observation · append-only</p>
          <p className="proof-head mt-2">
            <span className={controlOutcomeVerdictToneClass[observation.verdict]}>
              {controlOutcomeVerdictLabels[observation.verdict]}
            </span>
          </p>
          <p className="control-note">
            {observation.observedValue} {observation.target.unit} observed on {formatDay(observation.observedOn)} against the frozen {observation.target.targetValue} {observation.target.unit} target.
          </p>
          <p className="control-card-meta">Not Recovery evidence or independently verified proof · recorded {formatMoment(observation.observedAt)}</p>
        </section>
      ))}

      {exceptionReviews.length > 0 ? (
        <section aria-label={`Exception dispositions for ${proposal.merchant}`} className="control-authority">
          <p className="truth-label truth-authority">Human disposition · append-only</p>
          <ul className="control-review-list mt-2">
            {exceptionReviews.map((review) => (
              <li key={review.id}>
                <span>
                  <span className="block text-sm font-medium text-(--ink)">{controlExceptionDispositionLabels[review.disposition]}</span>
                  <span className="control-note">{review.note}</span>
                </span>
                <span className="control-card-meta">Recorded {formatMoment(review.reviewedAt)}</span>
              </li>
            ))}
          </ul>
          <p className="control-card-meta">The original evidence, authorization, and verdict remain unchanged.</p>
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
        ) : lead ? (
          <ControlEvaluation proposal={proposal} evaluation={evaluation} onInspectEvidence={onInspectEvidence} />
        ) : (
          // Only the proposal being decided is read in full. The rest of the
          // queue stays one scannable line — the amount, which the card header
          // does not carry — and opens its policy reading on demand. The
          // verdict is not repeated here; the body owns it.
          <details className="control-more">
            <summary>
              {formatControlMoney(proposal.amountMinor, proposal.currency)}
            </summary>
            <div className="control-more-body">
              <ControlEvaluation proposal={proposal} evaluation={evaluation} onInspectEvidence={onInspectEvidence} />
            </div>
          </details>
        )
      ) : (
        <p className="control-note">This proposal carries no evaluation, so there is no policy context to show.</p>
      )}

      {!decision && evaluation ? (
        <div className="control-card-actions">
          {canDecide && onDecide ? (
            <button
              id={decideButtonId}
              type="button"
              className={lead ? "btn btn-primary" : "btn btn-ghost"}
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
          {canDecide && onReconcile ? (
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
            The frozen cap never changes. A later observation is appended below it, whatever it shows.
          </p>
        </div>
      ) : null}
    </article>
  );
}
