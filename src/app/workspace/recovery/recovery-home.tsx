"use client";

import type { AttentionItemDto, ChangeItemDto, HomeProjectionDto, ProjectionTotalDto, UpcomingItemDto } from "@/lib/recovery/contracts";
import {
  attentionReasonLabels,
  cadenceLabels,
  changeKindLabels,
  commitmentStatusLabels,
  coverageLabels,
  coverageMeanings,
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
      <TotalsStrip monthly={home.monthlyTotals} next30={home.next30DayTotals} generatedAt={home.generatedAt} />

      <section aria-labelledby="recovery-needs-me" className="panel p-4 sm:p-5">
        <h3 id="recovery-needs-me" className="folio" data-folio="01">WHAT NEEDS ME?</h3>
        <div className="mt-4 grid gap-3">
          {home.needsMe.length ? (
            home.needsMe.map((item) => <AttentionRow key={item.id} item={item} onOpenCommitment={onOpenCommitment} onInspectEvidence={onInspectEvidence} />)
          ) : (
            <StateBlock
              eyebrow="Nothing waiting"
              title="Nothing is waiting on a decision from you"
              detail="This is true only for the evidence you have submitted. It is not a statement about money the workspace has never seen."
            >
              <button type="button" onClick={onAddEvidence} className="btn btn-sm btn-ghost">Add more evidence</button>
            </StateBlock>
          )}
        </div>
      </section>

      <section aria-labelledby="recovery-changed" className="panel p-4 sm:p-5">
        <h3 id="recovery-changed" className="folio" data-folio="02">WHAT CHANGED?</h3>
        <div className="mt-4 grid gap-3">
          {home.changed.state === "NO_PRIOR_BASELINE" ? (
            <StateBlock
              eyebrow="No prior baseline"
              title="There is nothing earlier to compare this against"
              detail={`This is the first saved version of your workspace (version ${home.changed.toVersion}). Vognary will not invent a "before", so nothing is reported as changed. Submit evidence again later and the difference will be shown here.`}
            />
          ) : home.changed.items.length ? (
            <>
              <p className="font-data text-xs text-(--muted)">
                Compared version {home.changed.fromVersion} against version {home.changed.toVersion}.
              </p>
              {home.changed.items.map((item) => <ChangeRow key={item.id} item={item} onOpenCommitment={onOpenCommitment} onInspectEvidence={onInspectEvidence} />)}
            </>
          ) : (
            <StateBlock
              eyebrow="Compared"
              title="Nothing changed between these two versions"
              detail={`Version ${home.changed.fromVersion} and version ${home.changed.toVersion} describe the same commitments.`}
            />
          )}
        </div>
      </section>

      <section aria-labelledby="recovery-next" className="panel p-4 sm:p-5">
        <h3 id="recovery-next" className="folio" data-folio="03">WHAT HAPPENS NEXT?</h3>
        <div className="mt-4 grid gap-3">
          {home.next.length ? (
            home.next.map((item) => <UpcomingRow key={`${item.commitmentId}-${item.date}`} item={item} onOpenCommitment={onOpenCommitment} onInspectEvidence={onInspectEvidence} />)
          ) : (
            <StateBlock
              eyebrow="Nothing dated"
              title="No dated event is expected from your evidence"
              detail="The workspace publishes an upcoming event only when the evidence you submitted carries a date it can stand behind."
            />
          )}
        </div>
      </section>

      <section aria-labelledby="recovery-coverage" className="panel p-4 sm:p-5">
        <h3 id="recovery-coverage" className="folio" data-folio="04">COVERAGE</h3>
        <div className="mt-4 grid gap-3">
          <div className="inset p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className={home.coverage.state === "CURRENT" ? "pill pill-ready" : home.coverage.state === "NO_EVIDENCE" ? "pill pill-blocked" : "pill pill-partial"}>
                {coverageLabels[home.coverage.state]}
              </span>
              <span className="font-data text-xs text-(--muted)">
                {home.coverage.sourceCount} source{home.coverage.sourceCount === 1 ? "" : "s"} · {home.coverage.evidenceCount} evidence item{home.coverage.evidenceCount === 1 ? "" : "s"}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-(--ink-soft)">{coverageMeanings[home.coverage.state]}</p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-3">
              <CoverageFact label="Covers from" value={home.coverage.coverageStart ? formatDay(home.coverage.coverageStart) : "Not published"} />
              <CoverageFact label="Covers to" value={home.coverage.coverageEnd ? formatDay(home.coverage.coverageEnd) : "Not published"} />
              <CoverageFact label="Newest evidence" value={home.coverage.lastEvidenceAt ? formatMoment(home.coverage.lastEvidenceAt) : "None yet"} />
            </dl>
          </div>
          <div className="inset p-4">
            <p className="eyebrow eyebrow-xs">What this does not cover</p>
            {home.coverage.limitations.length ? (
              <ul className="mt-2 grid gap-1.5">
                {home.coverage.limitations.map((limitation) => (
                  <li key={limitation} className="text-sm leading-6 text-(--ink-soft)">· {limitation}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm leading-6 text-(--muted)">The workspace published no limitations for this coverage.</p>
            )}
            <button type="button" onClick={onAddEvidence} className="btn btn-sm btn-primary mt-4">Widen coverage with more evidence</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function TotalsStrip({ monthly, next30, generatedAt }: { monthly: readonly ProjectionTotalDto[]; next30: readonly ProjectionTotalDto[]; generatedAt: string }) {
  return (
    <section aria-label="Recurring money the workspace can prove" className="panel p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="eyebrow eyebrow-xs">Server totals · rendered exactly as published</p>
        <p className="font-data text-xs text-(--muted)">Generated {formatMoment(generatedAt)}</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <TotalsGroup label="Monthly" totals={monthly} />
        <TotalsGroup label="Next 30 days" totals={next30} />
      </div>
    </section>
  );
}

function TotalsGroup({ label, totals }: { label: string; totals: readonly ProjectionTotalDto[] }) {
  return (
    <div className="inset p-4">
      <p className="eyebrow eyebrow-xs">{label}</p>
      {totals.length ? (
        <ul className="mt-2 grid gap-2">
          {totals.map((total) => (
            <li key={`${label}-${total.amount.currency}`}>
              <MoneyValue amount={total.amount} className="text-xl font-semibold text-(--ink)" />
              <p className="mt-1 font-data text-xs text-(--muted)">
                {total.amount.currency} · backed by {total.commitmentIds.length} commitment{total.commitmentIds.length === 1 ? "" : "s"} and {total.evidenceIds.length} evidence item{total.evidenceIds.length === 1 ? "" : "s"}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm leading-6 text-(--muted)">No total was published. Currencies are never combined into one number.</p>
      )}
    </div>
  );
}

function CoverageFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow eyebrow-xs">{label}</dt>
      <dd className="font-data mt-1 text-sm text-(--ink)">{value}</dd>
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
