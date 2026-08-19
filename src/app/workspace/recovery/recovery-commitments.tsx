"use client";

import { useState } from "react";
import {
  commitmentImportances,
  commitmentOwners,
  commitmentPurposes,
  decisions,
  type CommitmentSummaryDto,
  type CorrectionDto,
  type CorrectionField,
  type Decision,
  type EvidenceDto,
  type PutCommitmentContextRequest,
} from "@/lib/recovery/contracts";
import {
  cadenceLabels,
  correctionFieldLabels,
  decisionLabels,
  decisionMeanings,
  formatDay,
  formatMoment,
  importanceLabels,
  ownerLabels,
  purposeLabels,
  sourceLabels,
} from "./labels";
import {
  cadenceShortLabels,
  commitmentNeedsAttention,
  customerPhrases,
  customerStatusForCommitment,
  customerStatusLabels,
  overlapIdsForWorkspace,
  presentExpectedObservation,
} from "./present";
import { CorrectionHistory, EvidenceRow } from "./recovery-evidence-panels";
import { FailureBlock, LoadingBlock, MoneyValue, StateBlock } from "./recovery-states";
import { displayedDecision, type PendingMutation, type RecoveryState } from "./state";
import { DisclosureTabs } from "./ui/disclosure-tabs";

const primaryDecisions = ["KEEP", "CANCEL", "MONITOR"] as const satisfies readonly Decision[];
const secondaryDecisions = ["DOWNGRADE", "INVESTIGATE"] as const satisfies readonly Decision[];

export type CommitmentsHandlers = {
  onSelect: (commitmentId: string | null) => void;
  onDecide: (commitment: CommitmentSummaryDto, decision: Decision) => void;
  onSaveContext: (commitmentId: string, request: PutCommitmentContextRequest) => void;
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
  const [filter, setFilter] = useState<"ALL" | "ATTENTION">("ALL");
  const overlapIds = state.home ? overlapIdsForWorkspace(state.home) : new Set<string>();
  const rows = filter === "ATTENTION"
    ? state.commitments.filter((commitment) => commitmentNeedsAttention(commitment, overlapIds.has(commitment.id)))
    : state.commitments;

  if (!state.commitments.length) {
    return (
      <StateBlock
        eyebrow="Nothing saved yet"
        title="No commitments yet"
        detail="Add a few software bills and Vognary will organize what you're paying for."
      >
        <button type="button" onClick={handlers.onAddEvidence} className="btn btn-primary">{customerPhrases.addBills}</button>
      </StateBlock>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
      <section aria-label="Commitments" className={selected ? "hidden lg:block" : "block"}>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-pressed={filter === "ALL"} onClick={() => setFilter("ALL")} className={`btn btn-sm ${filter === "ALL" ? "btn-ghost font-semibold" : "btn-ghost"}`}>All</button>
          <button type="button" aria-pressed={filter === "ATTENTION"} onClick={() => setFilter("ATTENTION")} className={`btn btn-sm ${filter === "ATTENTION" ? "btn-ghost font-semibold" : "btn-ghost"}`}>Needs attention</button>
        </div>
        <ul className="mt-3 grid gap-1">
          <li className="hidden px-3 py-2 font-data text-xs uppercase tracking-[0.12em] text-(--muted) lg:grid lg:grid-cols-[minmax(0,1fr)_7rem_6rem_7rem] lg:gap-3">
            <span>Vendor</span>
            <span>Cost</span>
            <span>Next</span>
            <span>Status</span>
          </li>
          {rows.map((commitment) => {
            const status = customerStatusForCommitment(commitment, overlapIds.has(commitment.id));
            return (
              <li key={commitment.id}>
                <button
                  type="button"
                  onClick={() => handlers.onSelect(commitment.id)}
                  data-active={commitment.id === selected}
                  aria-current={commitment.id === selected ? "true" : undefined}
                  className="ledger-row w-full p-3 text-left lg:grid lg:grid-cols-[minmax(0,1fr)_7rem_6rem_7rem] lg:items-baseline lg:gap-3"
                >
                  <span className="font-display text-base font-semibold text-(--ink)">{commitment.merchant}</span>
                  <span className="mt-1 font-data text-sm text-(--ink-soft) lg:mt-0">
                    {commitment.amount.display}{cadenceShortLabels[commitment.cadence]}
                  </span>
                  <span className="mt-1 font-data text-xs text-(--muted) lg:mt-0">
                    {commitment.nextExpectedDate ? formatDay(commitment.nextExpectedDate) : "—"}
                  </span>
                  <span className={`mt-2 text-xs font-medium lg:mt-0 ${status === "ON_TRACK" ? "text-(--muted)" : "text-ochre"}`}>
                    {customerStatusLabels[status]}
                  </span>
                </button>
              </li>
            );
          })}
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
          <CommitmentDetailPanel state={state} handlers={handlers} overlap={overlapIds.has(selected)} />
        ) : (
          <p className="px-1 text-sm leading-6 text-(--muted)">Choose a tool to see the next bill and why it is listed.</p>
        )}
      </div>
    </div>
  );
}

function CommitmentDetailPanel({
  state,
  handlers,
  overlap,
}: {
  state: RecoveryState;
  handlers: CommitmentsHandlers;
  overlap: boolean;
}) {
  const { detail, detailStatus } = state;
  const [tab, setTab] = useState<"overview" | "history" | "why">("overview");
  const [changeOpen, setChangeOpen] = useState(false);

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
  const status = customerStatusForCommitment(detail, overlap);
  const observation = presentExpectedObservation(detail.expectation);
  const needsDecision = status === "NEEDS_ATTENTION" || shown.value === "MONITOR" || shown.value === "CANCEL" || (!detail.decision && detail.recommendedDecision !== "KEEP");
  const showDecisions = needsDecision || changeOpen;

  return (
    <article aria-labelledby="recovery-commitment-heading" className="grid gap-6">
      <header>
        <button type="button" onClick={() => handlers.onSelect(null)} className="btn btn-sm btn-ghost lg:hidden">← Back</button>
        <h3 id="recovery-commitment-heading" className="mt-3 font-display text-3xl font-semibold tracking-tight text-(--ink) lg:mt-0">
          {detail.merchant}
        </h3>
        <p className="mt-2 font-data text-xl text-(--ink)">
          {detail.amount.display}
          <span className="text-base text-(--ink-soft)">{cadenceShortLabels[detail.cadence] || ` · ${cadenceLabels[detail.cadence]}`}</span>
        </p>
        <dl className="mt-4 grid gap-1 text-sm leading-6">
          <div className="flex flex-wrap gap-x-3">
            <dt className="text-(--muted)">Next expected</dt>
            <dd className="text-(--ink)">{detail.nextExpectedDate ? formatDay(detail.nextExpectedDate) : "Not enough information"}</dd>
          </div>
          <div className="flex flex-wrap gap-x-3">
            <dt className="text-(--muted)">Status</dt>
            <dd className="text-(--ink)">{customerStatusLabels[status]}</dd>
          </div>
        </dl>
        {observation ? (
          <p className="mt-3 text-sm leading-6 text-(--ink-soft)">
            {observation.sentence}
            {observation.detail ? ` ${observation.detail}` : ""}
          </p>
        ) : null}
      </header>

      <section aria-labelledby="recovery-decision-heading">
        <h4 id="recovery-decision-heading" className="sr-only">Decision</h4>
        {showDecisions ? (
          <>
            {!needsDecision ? <p className="mb-3 text-sm leading-6 text-(--muted)">{customerPhrases.noActionNeeded}</p> : null}
            <div role="group" aria-label="Your choice" className="flex flex-wrap gap-2">
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
              <summary className="cursor-pointer text-sm font-medium text-(--ink-soft)">More</summary>
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
                    </button>
                  );
                })}
              </div>
            </details>
            {shown.value === "CANCEL" ? (
              <p className="mt-3 text-xs leading-6 text-(--muted)">Planning to cancel records your intent. Vognary does not cancel the service.</p>
            ) : null}
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm leading-6 text-(--muted)">{customerPhrases.noActionNeeded}</p>
            <button type="button" onClick={() => setChangeOpen(true)} className="btn btn-sm btn-ghost">Change</button>
          </div>
        )}
        {detail.decision ? (
          <p className="mt-2 font-data text-xs text-(--muted)">Saved {decisionLabels[detail.decision.value]} on {formatMoment(detail.decision.decidedAt)}.</p>
        ) : null}
        <ul className="sr-only">
          {decisions.map((decision) => (
            <li key={decision} id={`recovery-decision-meaning-${decision}`}>{decisionMeanings[decision]}</li>
          ))}
        </ul>
      </section>

      <DisclosureTabs
        active={tab}
        onChange={setTab}
        labelledBy="recovery-commitment-heading"
        tabs={[
          {
            id: "overview",
            label: "Overview",
            panel: (
              <div className="grid gap-4">
                {detail.overlap ? (
                  <p className="text-sm leading-6 text-(--ink-soft)">
                    Possible overlap with {detail.overlap.merchants.filter((name) => name !== detail.merchant).join(", ") || detail.overlap.label}.
                  </p>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-3">
                  <ContextSelect
                    id="recovery-purpose"
                    label="Purpose"
                    value={detail.context?.purpose ?? ""}
                    disabled={state.pending !== null}
                    options={commitmentPurposes.map((value) => [value, purposeLabels[value]] as const)}
                    onChange={(value) => {
                      if (commitmentPurposes.includes(value as typeof commitmentPurposes[number])) {
                        handlers.onSaveContext(detail.id, { purpose: value as typeof commitmentPurposes[number] });
                      }
                    }}
                  />
                  <ContextSelect
                    id="recovery-importance"
                    label="If you stop?"
                    value={detail.context?.importance ?? ""}
                    disabled={state.pending !== null}
                    options={commitmentImportances.map((value) => [value, importanceLabels[value]] as const)}
                    onChange={(value) => {
                      if (commitmentImportances.includes(value as typeof commitmentImportances[number])) {
                        handlers.onSaveContext(detail.id, { importance: value as typeof commitmentImportances[number] });
                      }
                    }}
                  />
                  <ContextSelect
                    id="recovery-owner"
                    label="Owner"
                    value={detail.context?.owner ?? ""}
                    disabled={state.pending !== null}
                    options={commitmentOwners.map((value) => [value, ownerLabels[value]] as const)}
                    onChange={(value) => {
                      if (commitmentOwners.includes(value as typeof commitmentOwners[number])) {
                        handlers.onSaveContext(detail.id, { owner: value as typeof commitmentOwners[number] });
                      }
                    }}
                  />
                </div>
              </div>
            ),
          },
          {
            id: "history",
            label: "History",
            panel: detail.memory.length ? (
              <ol className="grid gap-2">
                {detail.memory.map((point) => (
                  <li key={point.evidenceId} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span className="font-data text-sm text-(--ink)">{formatDay(point.date)}</span>
                    <span className="flex flex-wrap items-baseline gap-2">
                      <MoneyValue amount={point.amount} className="text-sm font-semibold text-(--ink)" />
                      <span className="font-data text-xs text-(--muted)">{sourceLabels[point.sourceType]}</span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm leading-6 text-(--muted)">No dated amounts yet.</p>
            ),
          },
          {
            id: "why",
            label: "Why",
            panel: (
              <div className="grid gap-4">
                {detail.confidence.state === "LOW" || detail.confidence.state === "UNKNOWN" ? (
                  <p className="text-sm leading-6 text-(--ink-soft)">Not enough history yet.</p>
                ) : null}
                {detail.evidence.items.length ? (
                  <ul className="grid gap-3">
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
                  <p className="text-sm leading-6 text-(--muted)">No receipt excerpt is on this page yet.</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {state.detailEvidenceCursor ? (
                    <button type="button" onClick={() => handlers.onEvidencePage(null)} className="btn btn-sm btn-ghost">Earlier receipts</button>
                  ) : null}
                  {detail.evidence.nextCursor ? (
                    <button type="button" onClick={() => handlers.onEvidencePage(detail.evidence.nextCursor)} className="btn btn-sm btn-ghost">More receipts</button>
                  ) : null}
                </div>
              </div>
            ),
          },
        ]}
      />

      <details>
        <summary className="cursor-pointer text-sm font-medium text-(--ink-soft)">{customerPhrases.somethingWrong}</summary>
        <div className="mt-4 grid gap-3">
          <p className="text-sm leading-6 text-(--muted)">Correct what we got wrong. The original bill is never overwritten.</p>
          <div className="flex flex-wrap gap-2">
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
          <CorrectionHistory
            corrections={detail.corrections}
            onReverse={handlers.onReverseCorrection}
            reversingId={reversingCorrectionId(state.pending)}
            disabled={state.pending !== null}
          />
        </div>
      </details>
    </article>
  );
}

function reversingCorrectionId(pending: PendingMutation | null) {
  return pending?.kind === "CORRECTION_REVERSAL" ? pending.correctionId : null;
}

function ContextSelect({
  id,
  label,
  value,
  disabled,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id} className="grid gap-1">
      <span className="field-label">{label}</span>
      <select
        id={id}
        className="field"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Not told yet</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}
