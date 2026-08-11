"use client";

import type { AttentionItemDto, ChangeItemDto, HomeProjectionDto, UpcomingItemDto } from "@/lib/recovery/contracts";
import {
  attentionReasonLabels,
  cadenceLabels,
  changeKindLabels,
  commitmentStatusLabels,
  decisionLabels,
  formatDay,
  formatMoment,
  priorityLabels,
} from "./labels";
import { ConfidenceBadge, MoneyValue, StateBlock } from "./recovery-states";

// Home renders the server's home projection verbatim, in the server's order.
// It performs no ranking, totalling, or recurrence reasoning of its own.

type InspectEvidence = (commitmentId: string, evidenceId: string, buttonId: string) => void;

export function RecoveryHome({
  home,
  onOpenCommitment,
  onInspectEvidence,
  onAddEvidence,
}: {
  home: HomeProjectionDto;
  onOpenCommitment: (commitmentId: string) => void;
  onInspectEvidence: InspectEvidence;
  onAddEvidence: () => void;
}) {
  return (
    <div className="grid gap-5">
      <section aria-labelledby="recovery-needs-me" className="panel p-4 sm:p-5">
        <h3 id="recovery-needs-me" className="font-display text-xl font-semibold text-(--ink)">Needs attention</h3>
        <div className="mt-4 grid gap-3">
          {home.needsMe.length ? (
            home.needsMe.map((item) => <AttentionRow key={item.id} item={item} onOpenCommitment={onOpenCommitment} onInspectEvidence={onInspectEvidence} />)
          ) : (
            <StateBlock
              eyebrow={home.coverage.evidenceCount ? "Up to date" : "No receipts yet"}
              title={home.coverage.evidenceCount ? "Nothing needs attention right now" : "No software renewals yet"}
              detail={home.coverage.evidenceCount
                ? "Based on the receipts Vognary has checked, there is no decision waiting for you."
                : "Add recent software receipts and Vognary will show only the renewals it can support."}
            >
              <button type="button" onClick={onAddEvidence} className="btn btn-sm btn-primary">Add receipts</button>
            </StateBlock>
          )}
        </div>
      </section>

      {home.changed.state === "COMPARED" ? (
        <section aria-labelledby="recovery-changed" className="panel p-4 sm:p-5">
          <h3 id="recovery-changed" className="font-display text-xl font-semibold text-(--ink)">Since your last visit</h3>
          <div className="mt-4 grid gap-3">
            {home.changed.items.length ? (
              home.changed.items.map((item) => <ChangeRow key={item.id} item={item} onOpenCommitment={onOpenCommitment} onInspectEvidence={onInspectEvidence} />)
            ) : (
              <StateBlock
                eyebrow="No changes"
                title="Your subscriptions look the same"
                detail="No amount, date, frequency, or recurring status changed in the latest receipts."
              />
            )}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="recovery-next" className="panel p-4 sm:p-5">
        <h3 id="recovery-next" className="font-display text-xl font-semibold text-(--ink)">Coming up</h3>
        <div className="mt-4 grid gap-3">
          {home.next.length ? (
            home.next.map((item) => <UpcomingRow key={`${item.commitmentId}-${item.date}`} item={item} onOpenCommitment={onOpenCommitment} onInspectEvidence={onInspectEvidence} />)
          ) : (
            <StateBlock
              eyebrow="No expected dates"
              title="Nothing is scheduled from your receipts"
              detail="Vognary shows an expected charge only when a receipt supports a date."
            />
          )}
        </div>
      </section>

      <section aria-labelledby="recovery-receipts" className="flex flex-wrap items-center justify-between gap-4 border-t border-line px-1 pt-5">
        <div>
          <h3 id="recovery-receipts" className="font-display text-base font-semibold text-(--ink)">Receipts checked</h3>
          <p className="mt-1 font-data text-xs text-(--muted)">
            {home.coverage.evidenceCount
              ? `${home.coverage.evidenceCount} item${home.coverage.evidenceCount === 1 ? "" : "s"} from ${home.coverage.sourceCount} source${home.coverage.sourceCount === 1 ? "" : "s"} · latest ${home.coverage.lastEvidenceAt ? formatMoment(home.coverage.lastEvidenceAt) : "date unavailable"}`
              : "No receipts have been checked yet."}
          </p>
        </div>
        <button type="button" onClick={onAddEvidence} className="btn btn-sm btn-ghost">Add receipts</button>
      </section>
    </div>
  );
}

function AttentionRow({ item, onOpenCommitment, onInspectEvidence }: { item: AttentionItemDto; onOpenCommitment: (commitmentId: string) => void; onInspectEvidence: InspectEvidence }) {
  const evidenceButtonId = `home-needs-evidence-${item.id}`;
  return (
    <article className="inset p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={item.priority === "HIGH" ? "pill pill-blocked" : item.priority === "MEDIUM" ? "pill pill-partial" : "pill pill-planned"}>{priorityLabels[item.priority]}</span>
        <span className="font-data text-xs text-(--muted)">{attentionReasonLabels[item.reason]}</span>
      </div>
      <h4 className="mt-2 font-display text-base font-semibold text-(--ink)">{item.title}</h4>
      <p className="mt-1 text-sm leading-6 text-(--ink-soft)">{item.detail}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-data text-xs text-(--muted)">
        {item.amount ? <MoneyValue amount={item.amount} className="text-sm text-(--ink)" /> : <span>No amount published</span>}
        <span>{item.dueDate ? `Due ${formatDay(item.dueDate)}` : "No due date published"}</span>
        <span>{item.evidenceIds.length} evidence item{item.evidenceIds.length === 1 ? "" : "s"} behind this</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" id={evidenceButtonId} onClick={() => onInspectEvidence(item.commitmentId, item.evidenceIds[0], evidenceButtonId)} className="btn btn-sm btn-primary">Inspect exact evidence</button>
        <button type="button" onClick={() => onOpenCommitment(item.commitmentId)} className="btn btn-sm btn-ghost">Open commitment</button>
      </div>
    </article>
  );
}

function ChangeRow({ item, onOpenCommitment, onInspectEvidence }: { item: ChangeItemDto; onOpenCommitment: (commitmentId: string) => void; onInspectEvidence: InspectEvidence }) {
  const evidenceCount = item.provenance.evidenceIds.length;
  const provenance = item.provenance.kind === "EVIDENCE"
    ? `${evidenceCount} new evidence item${evidenceCount === 1 ? "" : "s"} caused this comparison`
    : item.provenance.kind === "CORRECTION"
      ? "Caused by a saved user correction, not by old evidence"
      : "Caused by reversing a saved correction, not by old evidence";
  const evidenceId = item.provenance.kind === "EVIDENCE" ? item.provenance.evidenceIds[0] : null;
  const evidenceButtonId = `home-change-evidence-${item.id}`;
  return (
    <article className="inset p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display text-base font-semibold text-(--ink)">{item.merchant}</p>
        <span className="pill pill-partial">{changeKindLabels[item.kind]}</span>
      </div>
      <div className="mt-2 text-sm leading-6 text-(--ink-soft)">{describeChange(item)}</div>
      <p className="mt-2 font-data text-xs text-(--muted)">
        Detected {formatMoment(item.detectedAt)} · {provenance}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {evidenceId ? (
          <button type="button" id={evidenceButtonId} onClick={() => onInspectEvidence(item.commitmentId, evidenceId, evidenceButtonId)} className="btn btn-sm btn-primary">Inspect exact evidence</button>
        ) : null}
        <button type="button" onClick={() => onOpenCommitment(item.commitmentId)} className="btn btn-sm btn-ghost">Open commitment history</button>
      </div>
    </article>
  );
}

function describeChange(item: ChangeItemDto) {
  switch (item.kind) {
    case "ADDED":
      return (
        <span>
          New commitment: <MoneyValue amount={item.after.amount} className="text-(--ink)" /> · {cadenceLabels[item.after.cadence]} · {item.after.date ? formatDay(item.after.date) : "no date published"}
        </span>
      );
    case "MERCHANT":
      return <span>Merchant went from “{item.before}” to “{item.after}”.</span>;
    case "AMOUNT":
      return (
        <span>
          Amount went from <MoneyValue amount={item.before} className="text-(--ink)" /> to <MoneyValue amount={item.after} className="text-(--ink)" />.
        </span>
      );
    case "DATE":
      return <span>Expected date went from {item.before ? formatDay(item.before) : "no date"} to {item.after ? formatDay(item.after) : "no date"}.</span>;
    case "CADENCE":
      return <span>Cadence went from {cadenceLabels[item.before]} to {cadenceLabels[item.after]}.</span>;
    case "RECURRING_CLASSIFICATION":
      return <span>Classification went from {commitmentStatusLabels[item.before]} to {commitmentStatusLabels[item.after]}.</span>;
  }
}

function UpcomingRow({ item, onOpenCommitment, onInspectEvidence }: { item: UpcomingItemDto; onOpenCommitment: (commitmentId: string) => void; onInspectEvidence: InspectEvidence }) {
  const evidenceButtonId = `home-next-evidence-${item.commitmentId}-${item.date}`;
  return (
    <article className="inset p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-display text-base font-semibold text-(--ink)">{item.merchant}</p>
        <MoneyValue amount={item.amount} className="text-lg font-semibold text-(--ink)" />
      </div>
      <p className="mt-1 font-data text-xs text-(--muted)">{formatDay(item.date)} · {describeDaysAway(item.daysAway)}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ConfidenceBadge confidence={item.confidence} />
        <span className="font-data text-xs text-(--muted)">
          {item.decision ? `Your decision: ${decisionLabels[item.decision.value]}` : "You have not decided yet"}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" id={evidenceButtonId} onClick={() => onInspectEvidence(item.commitmentId, item.evidenceIds[0], evidenceButtonId)} className="btn btn-sm btn-primary">Inspect exact evidence</button>
        <button type="button" onClick={() => onOpenCommitment(item.commitmentId)} className="btn btn-sm btn-ghost">Open commitment</button>
      </div>
    </article>
  );
}

function describeDaysAway(daysAway: number) {
  if (daysAway === 0) return "today";
  if (daysAway === 1) return "tomorrow";
  if (daysAway < 0) return `${Math.abs(daysAway)} day${daysAway === -1 ? "" : "s"} ago`;
  return `in ${daysAway} days`;
}
