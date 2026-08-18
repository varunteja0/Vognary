"use client";

import { decisions, type CommitmentSummaryDto, type CorrectionDto, type CorrectionField, type Decision, type EvidenceDto } from "@/lib/recovery/contracts";
import { correctionFieldLabels, cadenceLabels, commitmentStatusLabels, decisionLabels, decisionMeanings, decisionStamps, expectedVsObservedLabels, formatDay, formatMoment, sourceLabels } from "./labels";
import { CorrectionHistory, EvidenceRow } from "./recovery-evidence-panels";
import { ConfidenceBadge, ConfidenceDetail, FailureBlock, LoadingBlock, MoneyValue, StateBlock } from "./recovery-states";
import { displayedDecision, type PendingMutation, type RecoveryState } from "./state";

const primaryDecisions = ["KEEP", "CANCEL", "MONITOR"] as const satisfies readonly Decision[];
const secondaryDecisions = ["DOWNGRADE", "INVESTIGATE"] as const satisfies readonly Decision[];

export type CommitmentsHandlers = {
  onSelect: (commitmentId: string | null) => void;
  onDecide: (commitment: CommitmentSummaryDto, decision: Decision) => void;
  onInspectEvidence: (evidence: EvidenceDto, buttonId: string) => void;
  onCorrect: (field: CorrectionField, buttonId: string) => void;
  onReverseCorrection: (correction: CorrectionDto) => void;
  onEvidencePage: (cursor: string | null) => void;
  onAddEvidence: () => void;
  onRetryDetail: () => void;
  onLoadMoreCommitments: () => void;
  loadingMoreCommitments: boolean;
};

export function RecoveryCommitments({ state, handlers }: { state: RecoveryState; handlers: CommitmentsHandlers }) {
  const selected = state.selectedCommitmentId;

  if (!state.commitments.length) {
    return (
      <StateBlock
        eyebrow="Nothing saved yet"
        title="No commitments yet"
        detail="Add a software receipt and Vognary will show a commitment only when the receipt supports it."
      >
        <button type="button" onClick={handlers.onAddEvidence} className="btn btn-primary">Add receipts</button>
      </StateBlock>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:items-start">
      <section aria-label="Commitments" className={`panel p-3 sm:p-4 ${selected ? "hidden lg:block" : "block"}`}>
        <div className="flex items-baseline justify-between gap-2 px-1">
          <h3 className="folio" data-folio="05">Commitments</h3>
          <span className="font-data text-xs text-(--muted)">{state.commitments.length} shown</span>
        </div>
        <ul className="mt-3 grid gap-2">
          {state.commitments.map((commitment) => (
            <li key={commitment.id}>
              <button
                type="button"
                onClick={() => handlers.onSelect(commitment.id)}
                data-active={commitment.id === selected}
                aria-current={commitment.id === selected ? "true" : undefined}
                className="ledger-row inset w-full p-3 text-left"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-display text-base font-semibold text-(--ink)">{commitment.merchant}</span>
                  <MoneyValue amount={commitment.amount} className="text-sm font-semibold text-(--ink)" />
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-data text-xs text-(--muted)">
                  <span>{cadenceLabels[commitment.cadence]}</span>
                  <span>{commitment.nextExpectedDate ? formatDay(commitment.nextExpectedDate) : "No date published"}</span>
                  <span>{commitment.evidenceCount} receipt{commitment.evidenceCount === 1 ? "" : "s"}</span>
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={decisionStamps[commitment.decision?.value ?? commitment.recommendedDecision]}>
                    {commitment.decision ? decisionLabels[commitment.decision.value] : `Suggested: ${decisionLabels[commitment.recommendedDecision]}`}
                  </span>
                  <ConfidenceBadge confidence={commitment.confidence} />
                </span>
              </button>
            </li>
          ))}
        </ul>
        {state.commitmentsCursor ? (
          <button
            type="button"
            onClick={handlers.onLoadMoreCommitments}
            disabled={handlers.loadingMoreCommitments}
            className="btn btn-sm btn-ghost mt-3 w-full"
          >
            {handlers.loadingMoreCommitments ? "Loading…" : "Show more commitments"}
          </button>
        ) : null}
      </section>

      <div className={selected ? "block" : "hidden lg:block"}>
        {selected ? (
          <CommitmentDetailPanel state={state} handlers={handlers} />
        ) : (
          <StateBlock
            eyebrow="Nothing selected"
            title="Choose a commitment to see why it appears"
            detail="Every amount, date, and frequency can be traced to a receipt or source you provided."
          />
        )}
      </div>
    </div>
  );
}

function CommitmentDetailPanel({ state, handlers }: { state: RecoveryState; handlers: CommitmentsHandlers }) {
  const { detail, detailStatus } = state;

  if (detailStatus.kind === "LOADING" && !detail) return <LoadingBlock label="Opening this commitment…" />;
  if (detailStatus.kind === "FAILED") {
    return (
      <FailureBlock failure={detailStatus.failure}>
        <button type="button" onClick={handlers.onRetryDetail} className="btn btn-sm btn-primary">Try again</button>
        <button type="button" onClick={() => handlers.onSelect(null)} className="btn btn-sm btn-ghost">Back to the list</button>
      </FailureBlock>
    );
  }
  if (!detail) {
    return (
      <StateBlock
        eyebrow="Unavailable"
        title="This commitment could not be opened"
        detail="Nothing is assumed about it. Go back to the list and try again."
      >
        <button type="button" onClick={() => handlers.onSelect(null)} className="btn btn-sm btn-ghost">Back to the list</button>
      </StateBlock>
    );
  }

  const decisionPending = state.pending?.kind === "DECISION" && state.pending.commitmentId === detail.id;
  const shown = displayedDecision(state, detail.id, detail.decision);

  return (
    <article aria-labelledby="recovery-commitment-heading" className="grid gap-5">
      <section className="panel p-4 sm:p-5">
        <button type="button" onClick={() => handlers.onSelect(null)} className="btn btn-sm btn-ghost lg:hidden">← Back to the list</button>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3 lg:mt-0">
          <div>
            <h3 id="recovery-commitment-heading" className="font-display text-2xl font-semibold text-(--ink)">{detail.merchant}</h3>
            <p className="mt-1 font-data text-xs text-(--muted)">
              {detail.category} · {commitmentStatusLabels[detail.status]} · updated {formatMoment(detail.updatedAt)}
            </p>
          </div>
          <MoneyValue amount={detail.amount} className="text-2xl font-semibold text-(--ink)" />
        </div>

        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <DetailFact label="Frequency" value={cadenceLabels[detail.cadence]} />
          <DetailFact label="Expected next charge" value={detail.nextExpectedDate ? formatDay(detail.nextExpectedDate) : "Not enough information"} />
          <DetailFact
            label="Estimated monthly cost"
            value={detail.cadence === "IRREGULAR" ? "Not established" : detail.monthlyEquivalent.display}
            note={detail.cadence === "IRREGULAR" ? undefined : detail.monthlyEquivalent.currency}
          />
        </dl>

        <div className="mt-4 inset p-4">
          <ConfidenceDetail confidence={detail.confidence} />
          {detail.belief ? <p className="mt-3 text-sm leading-6 text-(--ink-soft)">{detail.belief}</p> : null}
          {detail.because[0] ? <p className="mt-1 text-sm leading-6 text-(--muted)">{detail.because[0]}</p> : null}
          {detail.riskTags.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {detail.riskTags.map((tag) => <span key={tag} className="pill pill-partial">{tag}</span>)}
            </div>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="recovery-expectation-heading" className="panel p-4 sm:p-5">
        <h4 id="recovery-expectation-heading" className="font-display text-xl font-semibold text-(--ink)">Expected vs observed</h4>
        <p className="mt-2 font-data text-xs text-(--muted)">{expectedVsObservedLabels[detail.expectation.status]}</p>
        <p className="mt-2 text-sm leading-6 text-(--ink-soft)">{detail.expectation.summary}</p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <DetailFact
            label="Expected"
            value={detail.expectation.expectedAmount?.display ?? "Not established"}
            note={[detail.expectation.expectedDate ? formatDay(detail.expectation.expectedDate) : null, detail.expectation.expectedAmount?.currency].filter(Boolean).join(" · ") || undefined}
          />
          <DetailFact
            label="Observed"
            value={detail.expectation.observedAmount?.display ?? "No supporting evidence yet"}
            note={[detail.expectation.observedDate ? formatDay(detail.expectation.observedDate) : null, detail.expectation.observedAmount?.currency].filter(Boolean).join(" · ") || undefined}
          />
        </dl>
        {detail.expectation.windowStart && detail.expectation.windowEnd ? (
          <p className="mt-3 font-data text-xs text-(--muted)">
            Window {formatDay(detail.expectation.windowStart)} to {formatDay(detail.expectation.windowEnd)}. Absence is not treated as cancellation.
          </p>
        ) : null}
        {detail.expectation.reasons[0] ? (
          <p className="mt-2 text-sm leading-6 text-(--muted)">{detail.expectation.reasons[0]}</p>
        ) : null}
      </section>

      {detail.memory.length ? (
        <section aria-labelledby="recovery-memory-heading" className="panel p-4 sm:p-5">
          <h4 id="recovery-memory-heading" className="font-display text-xl font-semibold text-(--ink)">Amount history</h4>
          <p className="mt-2 text-sm leading-6 text-(--muted)">Dated amounts from stored evidence. Original receipts are not rewritten.</p>
          <ol className="mt-4 grid gap-2">
            {detail.memory.map((point) => (
              <li key={point.evidenceId} className="flex flex-wrap items-baseline justify-between gap-2 inset p-3">
                <span className="font-data text-sm text-(--ink)">{formatDay(point.date)}</span>
                <span className="flex flex-wrap items-baseline gap-2">
                  <MoneyValue amount={point.amount} className="text-sm font-semibold text-(--ink)" />
                  <span className="font-data text-xs text-(--muted)">{sourceLabels[point.sourceType]}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section aria-labelledby="recovery-decision-heading" className="panel p-4 sm:p-5">
        <h4 id="recovery-decision-heading" className="font-display text-xl font-semibold text-(--ink)">What do you want to do?</h4>
        <p className="mt-3 text-sm leading-6 text-(--ink-soft)">
          Vognary suggests <strong>{decisionLabels[detail.recommendedDecision]}</strong>. {detail.recommendationReason}
        </p>
        <p className="mt-1 text-xs leading-5 text-(--muted)">Nothing changes until you choose.</p>
        <div role="group" aria-label="Your choice" className="mt-4 flex flex-wrap gap-2">
          {primaryDecisions.map((decision) => {
            const active = shown.value === decision;
            return (
              <button
                key={decision}
                type="button"
                aria-pressed={active}
                aria-describedby={`recovery-decision-meaning-${decision}`}
                disabled={state.pending !== null}
                onClick={() => handlers.onDecide(detail, decision)}
                className={`btn btn-sm ${active ? "btn-primary" : "btn-ghost"}`}
              >
                {decisionLabels[decision]}
                {active && decisionPending ? " · saving…" : ""}
              </button>
            );
          })}
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-(--ink-soft)">More choices</summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {secondaryDecisions.map((decision) => {
              const active = shown.value === decision;
              return (
                <button
                  key={decision}
                  type="button"
                  aria-pressed={active}
                  aria-describedby={`recovery-decision-meaning-${decision}`}
                  disabled={state.pending !== null}
                  onClick={() => handlers.onDecide(detail, decision)}
                  className={`btn btn-sm ${active ? "btn-primary" : "btn-ghost"}`}
                >
                  {decisionLabels[decision]}
                  {active && decisionPending ? " · saving…" : ""}
                </button>
              );
            })}
          </div>
        </details>
        <ul className="sr-only">
          {decisions.map((decision) => (
            <li key={decision} id={`recovery-decision-meaning-${decision}`}>{decisionMeanings[decision]}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-5 text-(--muted)">Planning to cancel records your intent; Vognary does not cancel the service.</p>
        <p className="mt-3 font-data text-xs text-(--muted)">
          {detail.decision
            ? `Saved ${decisionLabels[detail.decision.value]} on ${formatMoment(detail.decision.decidedAt)} · last updated ${formatMoment(detail.decision.updatedAt)}.`
            : "No choice has been saved for this commitment yet."}
        </p>
      </section>

      <section aria-labelledby="recovery-evidence-heading" className="panel p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 id="recovery-evidence-heading" className="font-display text-xl font-semibold text-(--ink)">Why Vognary thinks this</h4>
          <span className="font-data text-xs text-(--muted)">
            Showing {detail.evidence.items.length} of {detail.evidence.total}
          </span>
        </div>
        {detail.evidence.items.length ? (
          <ul className="mt-4 grid gap-3">
            {detail.evidence.items.map((evidence) => (
              <EvidenceRow
                key={evidence.id}
                evidence={evidence}
                buttonId={`recovery-evidence-${evidence.id}`}
                onInspect={() => handlers.onInspectEvidence(evidence, `recovery-evidence-${evidence.id}`)}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm leading-6 text-(--muted)">The workspace published no evidence rows for this page.</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {state.detailEvidenceCursor ? (
            <button type="button" onClick={() => handlers.onEvidencePage(null)} className="btn btn-sm btn-ghost">Back to the first page of evidence</button>
          ) : null}
          {detail.evidence.nextCursor ? (
            <button type="button" onClick={() => handlers.onEvidencePage(detail.evidence.nextCursor)} className="btn btn-sm btn-ghost">Next page of evidence</button>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="recovery-corrections-heading" className="panel p-4 sm:p-5">
        <h4 id="recovery-corrections-heading" className="folio" data-folio="08">Corrections</h4>
        <p className="mt-3 text-sm leading-6 text-(--muted)">Correct what the evidence got wrong. Your original evidence is never overwritten.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {(Object.keys(correctionFieldLabels) as CorrectionField[]).map((field) => (
            <button
              key={field}
              type="button"
              id={`recovery-correct-${field}`}
              disabled={state.pending !== null}
              onClick={() => handlers.onCorrect(field, `recovery-correct-${field}`)}
              className="btn btn-sm btn-ghost"
            >
              Correct {correctionFieldLabels[field].toLowerCase()}
            </button>
          ))}
        </div>
        <div className="mt-5">
          <CorrectionHistory
            corrections={detail.corrections}
            onReverse={handlers.onReverseCorrection}
            reversingId={reversingCorrectionId(state.pending)}
            disabled={state.pending !== null}
          />
        </div>
      </section>
    </article>
  );
}

function reversingCorrectionId(pending: PendingMutation | null) {
  return pending?.kind === "CORRECTION_REVERSAL" ? pending.correctionId : null;
}

function DetailFact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="inset p-3">
      <dt className="eyebrow eyebrow-xs">{label}</dt>
      <dd className="font-data mt-1.5 text-base font-semibold tnum text-(--ink)">{value}</dd>
      {note ? <dd className="mt-1 font-data text-xs text-(--muted)">{note}</dd> : null}
    </div>
  );
}
