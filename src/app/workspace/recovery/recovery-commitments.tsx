"use client";

import { useMemo, useState } from "react";
import {
  commitmentImportances,
  commitmentOwners,
  commitmentPurposes,
  type CorrectionDto,
  type CorrectionField,
  type EvidenceDto,
  type PutCommitmentContextRequest,
} from "@/lib/recovery/contracts";
import {
  cadenceLabels,
  correctionFieldLabels,
  decisionCycleActionLabels,
  decisionLabels,
  formatDay,
  formatMoment,
  importanceLabels,
  ownerLabels,
  purposeLabels,
  sourceLabels,
} from "./labels";
import {
  cadenceShortLabels,
  customerPhrases,
  customerStatusForCommitment,
  customerStatusLabels,
  findGroupForCommitment,
  groupCommitments,
  groupDecisionState,
  groupNeedsAttention,
  overlapIdsForWorkspace,
  presentExpectedObservation,
  representativeCommitment,
  type CommitmentGroup,
} from "./present";
import { CorrectionHistory, EvidenceRow } from "./recovery-evidence-panels";
import { FailureBlock, LoadingBlock, MoneyValue, StateBlock } from "./recovery-states";
import { type PendingMutation, type RecoveryState } from "./state";

export type CommitmentsHandlers = {
  onSelect: (commitmentId: string | null) => void;
  onDecideOnNow: (commitmentId: string) => void;
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

export function RecoveryCommitments({
  state,
  handlers,
  queueEmpty = false,
}: {
  state: RecoveryState;
  handlers: CommitmentsHandlers;
  queueEmpty?: boolean;
}) {
  const selected = state.selectedCommitmentId;
  const [filter, setFilter] = useState<"ALL" | "ATTENTION">("ALL");
  const overlapIds = state.home ? overlapIdsForWorkspace(state.home) : new Set<string>();
  const groups = useMemo(() => groupCommitments(state.commitments), [state.commitments]);
  const visibleGroups = filter === "ATTENTION"
    ? groups.filter((group) => groupNeedsAttention(group, overlapIds))
    : groups;
  const activeGroup = selected ? findGroupForCommitment(groups, selected) : null;

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
    <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start lg:gap-8">
      <section aria-label="Commitments" className={selected ? "hidden lg:block" : "block"}>
        {queueEmpty ? (
          <p className="mb-3 text-sm leading-6 text-(--muted)">{customerPhrases.billsQuietHint}</p>
        ) : null}
        <div className="segmented" role="group" aria-label="Filter commitments">
          <button type="button" data-active={filter === "ALL"} aria-pressed={filter === "ALL"} onClick={() => setFilter("ALL")}>All</button>
          <button type="button" data-active={filter === "ATTENTION"} aria-pressed={filter === "ATTENTION"} onClick={() => setFilter("ATTENTION")}>Needs attention</button>
        </div>
        {visibleGroups.length ? (
          <ul className="ledger-list mt-4 grid">
            {visibleGroups.map((group) => {
              const decisionState = groupDecisionState(group, state.home);
              const representative = representativeCommitment(group);
              const isActive = activeGroup?.key === group.key;
              return (
                <li key={group.key}>
                  <button
                    type="button"
                    onClick={() => handlers.onSelect(representative.id)}
                    data-active={isActive}
                    aria-current={isActive ? "true" : undefined}
                    className="ledger-row ledger-item"
                  >
                    <span className="ledger-item-name">{group.merchant}</span>
                    <span className="ledger-item-state" data-tone={decisionState.tone}>{decisionState.label}</span>
                    <span className="ledger-item-cost">
                      {representative.amount.display}{cadenceShortLabels[group.cadence]}
                      {group.commitments.length > 1 ? (
                        <span className="text-(--muted)">{` · ${group.commitments.length.toLocaleString("en-IN")} charges`}</span>
                      ) : null}
                    </span>
                    <span className="ledger-item-when">
                      {representative.nextExpectedDate ? formatDay(representative.nextExpectedDate) : "No date yet"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 text-sm leading-6 text-(--muted)">Nothing in this filter right now.</p>
        )}
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
        {selected && activeGroup ? (
          <>
            {activeGroup.commitments.length > 1 ? (
              <ChargePicker
                group={activeGroup}
                selectedId={selected}
                home={state.home}
                onSelect={handlers.onSelect}
              />
            ) : null}
            <CommitmentDetailPanel
              state={state}
              handlers={handlers}
              overlap={overlapIds.has(selected)}
            />
          </>
        ) : (
          <p className="px-1 text-sm leading-6 text-(--muted)">Choose a service to see cited charges and receipts.</p>
        )}
      </div>
    </div>
  );
}

function ChargePicker({
  group,
  selectedId,
  home,
  onSelect,
}: {
  group: CommitmentGroup;
  selectedId: string;
  home: RecoveryState["home"];
  onSelect: (commitmentId: string) => void;
}) {
  return (
    <div className="mb-4 grid gap-2">
      <p className="field-label mb-0">Which charge?</p>
      <ul className="segmented flex flex-wrap gap-1">
        {group.commitments.map((commitment) => {
          const when = commitment.nextExpectedDate ? formatDay(commitment.nextExpectedDate) : "No date yet";
          return (
            <li key={commitment.id}>
              <button
                type="button"
                data-active={commitment.id === selectedId}
                aria-pressed={commitment.id === selectedId}
                onClick={() => onSelect(commitment.id)}
                className="btn btn-sm btn-ghost"
              >
                {when}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs leading-5 text-(--muted)">
        {groupDecisionState(group, home).label} on the latest charge. Pick another date if this is not the bill you mean.
      </p>
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

  if (detailStatus.kind === "LOADING" && !detail) return <LoadingBlock label="Opening this charge…" />;
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
        title="This charge could not be opened"
        detail="Nothing is assumed about it. Go back to the list and try again."
      >
        <button type="button" onClick={() => handlers.onSelect(null)} className="btn btn-sm btn-ghost">Back to the list</button>
      </StateBlock>
    );
  }

  const status = customerStatusForCommitment(detail, overlap);
  const observation = presentExpectedObservation(detail.expectation);
  const inQueue = state.home?.decisionQueue.some((card) => card.commitmentId === detail.id) === true;
  const statusLabel = detail.cycle
    ? `${decisionCycleActionLabels[detail.cycle.action]}${
        detail.cycle.action === "REVIEW_LATER" && detail.cycle.reviewAt ? ` until ${formatDay(detail.cycle.reviewAt)}` : ""
      } · due ${formatDay(detail.cycle.dueDate)}`
    : customerStatusLabels[status];

  return (
    <article aria-labelledby="recovery-commitment-heading" className="grid max-w-2xl gap-5">
      <header>
        <div className="lg:hidden">
          <button type="button" onClick={() => handlers.onSelect(null)} className="btn btn-sm btn-ghost">← Back</button>
        </div>
        <h3 id="recovery-commitment-heading" className="mt-3 font-display text-3xl font-semibold text-(--ink) lg:mt-0">
          {detail.merchant}
        </h3>
        <p className="mt-2 font-data text-xl text-(--ink)">
          {detail.amount.display}
          <span className="text-base text-(--ink-soft)">{cadenceShortLabels[detail.cadence] || ` · ${cadenceLabels[detail.cadence]}`}</span>
        </p>
        <p className="mt-3 text-sm leading-6 text-(--ink-soft)">
          {detail.nextExpectedDate ? `Next expected ${formatDay(detail.nextExpectedDate)}.` : "Next charge date is not known yet."}
          {" "}
          {statusLabel}.
        </p>
        {observation ? (
          <div className="mt-2 max-w-prose">
            <p className="eyebrow eyebrow-xs">Why</p>
            <p className="mt-1 text-sm leading-6 text-(--muted)">
              {observation.sentence}
              {observation.detail ? ` ${observation.detail}` : ""}
            </p>
          </div>
        ) : null}
      </header>

      <section aria-labelledby="recovery-ledger-action-heading">
        <h4 id="recovery-ledger-action-heading" className="sr-only">Ledger action</h4>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-data text-xs uppercase tracking-wide text-(--muted)">{statusLabel}</span>
          {inQueue ? (
            <div>
              <button
                type="button"
                onClick={() => handlers.onDecideOnNow(detail.id)}
                className="btn btn-sm btn-primary"
              >
                {customerPhrases.decideOnNow}
              </button>
              <p className="mt-2 text-xs leading-5 text-(--muted)">Planning to cancel records your intent. Vognary does not cancel the service.</p>
            </div>
          ) : (
            <p className="text-sm leading-6 text-(--muted)">{customerPhrases.noActionNeeded}</p>
          )}
        </div>
        {detail.decision ? (
          <p className="mt-2 font-data text-xs text-(--muted)">
            Saved {decisionLabels[detail.decision.value]} on {formatMoment(detail.decision.decidedAt)}.
          </p>
        ) : null}
      </section>

      {detail.evidence.items[0] ? (
        <div className="grid gap-2">
          <p className="eyebrow eyebrow-xs">{customerPhrases.citedEvidence}</p>
          <ul>
            <EvidenceRow
              evidence={detail.evidence.items[0]}
              buttonId={`recovery-evidence-${detail.evidence.items[0].id}`}
              onInspect={() => handlers.onInspectEvidence(detail.evidence.items[0]!, `recovery-evidence-${detail.evidence.items[0]!.id}`)}
            />
          </ul>
          {detail.evidence.items.length > 1 || detail.evidence.nextCursor ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-sm font-medium text-(--ink-soft)">{customerPhrases.seeTheReceipt}</summary>
              <ul className="mt-3 grid gap-3">
                {detail.evidence.items.slice(1).map((evidence) => (
                  <EvidenceRow
                    key={evidence.id}
                    evidence={evidence}
                    buttonId={`recovery-evidence-${evidence.id}`}
                    onInspect={() => handlers.onInspectEvidence(evidence, `recovery-evidence-${evidence.id}`)}
                  />
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                {state.detailEvidenceCursor ? (
                  <button type="button" onClick={() => handlers.onEvidencePage(null)} className="btn btn-sm btn-ghost">Earlier receipts</button>
                ) : null}
                {detail.evidence.nextCursor ? (
                  <button type="button" onClick={() => handlers.onEvidencePage(detail.evidence.nextCursor)} className="btn btn-sm btn-ghost">More receipts</button>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}

      <details>
        <summary className="cursor-pointer text-sm font-medium text-(--ink-soft)">More about this bill</summary>
        <div className="mt-4 grid gap-5">
          {detail.overlap ? (
            <p className="text-sm leading-6 text-(--ink-soft)">
              Possible overlap with {detail.overlap.merchants.filter((name) => name !== detail.merchant).join(", ") || detail.overlap.label}.
            </p>
          ) : null}
          {detail.decisionHistory.length ? (
            <div>
              <p className="eyebrow eyebrow-xs">What you decided</p>
              <ol className="timeline mt-3">
                {detail.decisionHistory.map((item, index) => (
                  <li key={`${item.dueDate}-${item.decidedAt}`} data-current={index === detail.decisionHistory.length - 1}>
                    <p className="timeline-when">{formatDay(item.dueDate)}</p>
                    <p className="timeline-what">{decisionCycleActionLabels[item.action]}</p>
                    {item.verificationHeadline ? <p className="timeline-note">{item.verificationHeadline}</p> : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          <div>
            <p className="eyebrow eyebrow-xs">Amounts seen</p>
            {detail.memory.length ? (
              <ol className="ledger-list mt-2 grid">
                {detail.memory.map((point) => (
                  <li key={point.evidenceId}>
                    <p className="ledger-line">
                      <span className="font-data text-sm text-(--ink-soft)">{formatDay(point.date)}</span>
                      <span className="ledger-meta">
                        <MoneyValue amount={point.amount} provenance={{ kind: "cited", source: "Receipt" }} size="data" />
                        <span className="ledger-date font-data text-xs">{sourceLabels[point.sourceType]}</span>
                      </span>
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-sm leading-6 text-(--muted)">No dated amounts yet.</p>
            )}
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-medium text-(--ink-soft)">Label this bill</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {detail.overlap || detail.context?.purpose ? (
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
              ) : null}
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
          </details>
        </div>
      </details>

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
