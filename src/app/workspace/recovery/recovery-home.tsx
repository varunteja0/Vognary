"use client";

import { useState } from "react";
import type { AttentionItemDto, ChangeItemDto, HomeProjectionDto, ProjectionTotalDto, ReceiptInboxStatusDto, UpcomingItemDto } from "@/lib/recovery/contracts";
import { renderRecoveryShareText } from "@/lib/recovery/share-report";
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
import type { LoadState } from "./state";

// Home renders the server's home projection verbatim, in the server's order.
// It performs no ranking, totalling, or recurrence reasoning of its own.

type InspectEvidence = (commitmentId: string | null, evidenceId: string, buttonId: string) => void;

export function RecoveryHome({
  home,
  commitmentTotal,
  receiptInboxPubliclyAvailable,
  onOpenCommitment,
  onInspectEvidence,
  onAddEvidence,
  receiptInbox,
  sourceStatus,
  pendingSourceAction,
  onProvisionReceiptInbox,
}: {
  home: HomeProjectionDto;
  commitmentTotal: number;
  receiptInboxPubliclyAvailable: boolean;
  onOpenCommitment: (commitmentId: string) => void;
  onInspectEvidence: InspectEvidence;
  onAddEvidence: () => void;
  receiptInbox: ReceiptInboxStatusDto | null;
  sourceStatus: LoadState;
  pendingSourceAction: "PROVISION" | "ROTATE" | "REVOKE" | null;
  onProvisionReceiptInbox: () => void;
}) {
  const [shareStatus, setShareStatus] = useState("");

  async function copyShareText() {
    try {
      await navigator.clipboard.writeText(renderRecoveryShareText(home));
      setShareStatus("WhatsApp summary copied.");
    } catch {
      setShareStatus("Could not copy automatically. Try again from a browser that allows clipboard access.");
    }
  }

  if (home.coverage.evidenceCount > 0 && commitmentTotal === 0) {
    return <FirstObservationHome
      home={home}
      onAddEvidence={onAddEvidence}
      onInspectEvidence={onInspectEvidence}
      onCopyShareText={() => void copyShareText()}
      shareStatus={shareStatus}
    />;
  }

  if (!home.coverage.evidenceCount) {
    return <EmptyRecoveryHome
      receiptInbox={receiptInbox}
      receiptInboxPubliclyAvailable={receiptInboxPubliclyAvailable}
      sourceStatus={sourceStatus}
      pendingSourceAction={pendingSourceAction}
      onProvisionReceiptInbox={onProvisionReceiptInbox}
      onAddEvidence={onAddEvidence}
    />;
  }

  return (
    <div className="grid gap-5">
      {home.monthlyTotals.length || home.next30DayTotals.length ? (
        <section aria-label="Software spend" className="panel p-4 sm:p-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <TotalBlock label="Monthly software spend" totals={home.monthlyTotals} empty="No recurring amount yet" />
            <TotalBlock label="Next 30 days" totals={home.next30DayTotals} empty="Nothing expected in the next 30 days" />
          </div>
          {home.monthlyTotals.length > 1 || home.next30DayTotals.length > 1 ? (
            <p className="mt-4 text-xs leading-5 text-(--muted)">
              Currencies stay separate because Vognary does not invent an exchange rate.
            </p>
          ) : null}
        </section>
      ) : null}

      {home.changed.state === "COMPARED" ? (
        <section aria-labelledby="recovery-changed" className="panel border-ochre p-4 sm:p-5">
          <p className="eyebrow eyebrow-xs text-ochre">New evidence compared</p>
          <h3 id="recovery-changed" className="mt-2 font-display text-xl font-semibold text-(--ink)">Since your last visit</h3>
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
      ) : (
        <section aria-label="Keep this review current" className="border-y border-line px-1 py-4">
          <p className="text-sm leading-6 text-(--ink-soft)">
            <strong>Sheets go stale when new charges land.</strong> Add later receipts and Vognary will show what amount, date, or recurring status changed, with the new evidence beside it.
          </p>
        </section>
      )}

      <section aria-labelledby="recovery-needs-me" className="panel p-4 sm:p-5">
        <h3 id="recovery-needs-me" className="font-display text-xl font-semibold text-(--ink)">Needs attention</h3>
        <div className="mt-4 grid gap-3">
          {home.needsMe.length ? (
            home.needsMe.map((item) => <AttentionRow key={item.id} item={item} onOpenCommitment={onOpenCommitment} onInspectEvidence={onInspectEvidence} />)
          ) : (
            <StateBlock
              eyebrow="Up to date"
              title="Nothing needs attention right now"
              detail="Based on the receipts Vognary has checked, there is no decision waiting for you."
            >
              <button type="button" onClick={onAddEvidence} className="btn btn-sm btn-primary">Add receipts</button>
            </StateBlock>
          )}
        </div>
      </section>

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

      <section aria-labelledby="recovery-receipts" className="grid gap-3 border-t border-line px-1 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 id="recovery-receipts" className="font-display text-base font-semibold text-(--ink)">Receipts checked</h3>
            <p className="mt-1 font-data text-xs text-(--muted)">
              {`${home.coverage.evidenceCount} item${home.coverage.evidenceCount === 1 ? "" : "s"} from ${home.coverage.sourceCount} source${home.coverage.sourceCount === 1 ? "" : "s"} · latest ${home.coverage.lastEvidenceAt ? formatMoment(home.coverage.lastEvidenceAt) : "date unavailable"}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void copyShareText()} className="btn btn-sm btn-primary">Copy for WhatsApp</button>
            <button type="button" onClick={onAddEvidence} className="btn btn-sm btn-ghost">Add receipts</button>
          </div>
        </div>
        <p className="text-xs leading-5 text-(--muted)">This is a floor from receipts checked, not every debit in India.</p>
        <p role="status" aria-live="polite" className="min-h-5 text-xs text-(--muted)">{shareStatus}</p>
      </section>
    </div>
  );
}

const firstValueStory = "Start with the billing receipts you already have. Vognary shows what renews next when the receipts support it, what needs attention, and the receipt behind each claim.";

function FirstObservationHome({
  home,
  onAddEvidence,
  onInspectEvidence,
  onCopyShareText,
  shareStatus,
}: {
  home: HomeProjectionDto;
  onAddEvidence: () => void;
  onInspectEvidence: InspectEvidence;
  onCopyShareText: () => void;
  shareStatus: string;
}) {
  const evidenceCount = home.coverage.evidenceCount;
  return (
    <section aria-label="Build a recurring pattern" className="panel p-5 sm:p-6">
      <p className="eyebrow eyebrow-xs text-ochre">Seen once</p>
      <h3 className="mt-3 font-display text-xl font-semibold text-(--ink) sm:text-2xl">Not called recurring yet</h3>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-(--ink-soft)">
        {evidenceCount === 1
          ? "Vognary saved 1 receipt. One charge is evidence, not a pattern."
          : `Vognary saved ${evidenceCount.toLocaleString("en-IN")} receipts, but no service has appeared twice yet.`}
      </p>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">
        Add another receipt from the same service. A matching charge can unlock cadence, monthly spend, an expected date, and a decision without inventing recurrence.
      </p>
      {home.recentObservations.length ? (
        <div className="mt-5">
          <h4 className="font-display text-base font-semibold text-(--ink)">Saved proof</h4>
          <div className="mt-2 grid gap-2">
            {home.recentObservations.map((observation) => (
              <SavedObservationRow key={observation.evidenceId} observation={observation} onInspectEvidence={onInspectEvidence} />
            ))}
          </div>
        </div>
      ) : null}
      <p className="mt-4 text-xs leading-5 text-(--muted)">This is a floor from receipts checked, not every debit in India.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" onClick={onAddEvidence} className="btn btn-primary btn-lg">Add a matching receipt</button>
        <button type="button" onClick={onCopyShareText} className="btn btn-ghost">Copy for WhatsApp</button>
      </div>
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-xs text-(--muted)">{shareStatus}</p>
    </section>
  );
}

function SavedObservationRow({
  observation,
  onInspectEvidence,
}: {
  observation: HomeProjectionDto["recentObservations"][number];
  onInspectEvidence: InspectEvidence;
}) {
  const evidenceButtonId = `home-observation-evidence-${observation.evidenceId}`;
  return (
    <article className="inset p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-display text-base font-semibold text-(--ink)">{observation.merchant ?? "Merchant not published"}</p>
        {observation.amount ? <MoneyValue amount={observation.amount} className="text-base font-semibold text-(--ink)" /> : <span className="text-xs text-(--muted)">Amount not published</span>}
      </div>
      <p className="mt-1 font-data text-xs text-(--muted)">{observation.date ? formatDay(observation.date) : "Charge date not published"}</p>
      <button
        type="button"
        id={evidenceButtonId}
        onClick={() => onInspectEvidence(null, observation.evidenceId, evidenceButtonId)}
        className="btn btn-sm btn-ghost mt-3"
      >
        Inspect exact evidence
      </button>
    </article>
  );
}

function EmptyRecoveryHome({
  receiptInbox,
  receiptInboxPubliclyAvailable,
  sourceStatus,
  pendingSourceAction,
  onProvisionReceiptInbox,
  onAddEvidence,
}: {
  receiptInbox: ReceiptInboxStatusDto | null;
  receiptInboxPubliclyAvailable: boolean;
  sourceStatus: LoadState;
  pendingSourceAction: "PROVISION" | "ROTATE" | "REVOKE" | null;
  onProvisionReceiptInbox: () => void;
  onAddEvidence: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const alias = receiptInbox?.alias ?? null;

  async function copyAddress() {
    if (!alias) return;
    try {
      await navigator.clipboard.writeText(alias.address);
      setCopyStatus("Address copied.");
    } catch {
      setCopyStatus("Could not copy automatically. Select the address and copy it.");
    }
  }

  if (!receiptInboxPubliclyAvailable) {
    return (
      <section aria-label="Get your first result" className="panel p-5 sm:p-6">
        <p className="eyebrow eyebrow-xs text-ochre">Manual evidence only</p>
        <h3 className="mt-3 font-display text-xl font-semibold text-(--ink) sm:text-2xl">Add receipts to see what renews next</h3>
        <p className="mt-2 max-w-xl text-sm leading-6 text-(--muted)">{firstValueStory}</p>
        <button type="button" onClick={onAddEvidence} className="btn btn-primary btn-lg mt-5">Add receipts manually</button>
      </section>
    );
  }

  if (alias) {
    return (
      <section aria-label="Get your first result" className="panel p-5 sm:p-6">
        <p className="eyebrow eyebrow-xs text-ochre">Recommended first step</p>
        <h3 className="mt-3 font-display text-xl font-semibold text-(--ink) sm:text-2xl">Your Vognary receipt address</h3>
        <p className="mt-2 max-w-xl text-sm leading-6 text-(--muted)">{firstValueStory}</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input aria-label="Your Vognary receipt address" className="field field-mono min-w-0" value={alias.address} readOnly />
          <button type="button" onClick={() => void copyAddress()} className="btn btn-primary shrink-0">Copy address</button>
        </div>
        <p role="status" aria-live="polite" className="mt-2 min-h-5 text-xs text-(--muted)">{copyStatus}</p>
        <button type="button" onClick={onAddEvidence} className="btn btn-sm btn-ghost mt-3">Add receipts manually</button>
      </section>
    );
  }

  if (sourceStatus.kind === "IDLE" || sourceStatus.kind === "LOADING") {
    return (
      <StateBlock
        eyebrow="Preparing your first source"
        title="Opening your receipt options…"
        detail="Vognary is checking whether this deployment can create your private receipt address."
      />
    );
  }

  const canProvision = receiptInbox?.state === "NOT_PROVISIONED" || receiptInbox?.state === "REVOKED";
  if (canProvision) {
    return (
      <section aria-label="Get your first result" className="panel p-5 sm:p-6">
        <p className="eyebrow eyebrow-xs text-ochre">Recommended first step</p>
        <h3 className="mt-3 font-display text-xl font-semibold text-(--ink) sm:text-2xl">Get your private receipt address</h3>
        <p className="mt-2 max-w-xl text-sm leading-6 text-(--muted)">
          {firstValueStory} Vognary never accesses or scans your inbox.
        </p>
        <button type="button" onClick={onProvisionReceiptInbox} disabled={pendingSourceAction !== null} className="btn btn-primary btn-lg mt-5">
          {pendingSourceAction === "PROVISION" ? "Setting up address…" : "Set up receipt address"}
        </button>
        <button type="button" onClick={onAddEvidence} className="btn btn-sm btn-ghost ml-0 mt-3 sm:ml-2">Add receipts manually</button>
      </section>
    );
  }

  return (
    <section aria-label="Get your first result" className="panel p-5 sm:p-6">
      <h3 className="font-display text-xl font-semibold text-(--ink) sm:text-2xl">Add receipts to see what renews next</h3>
      <p className="mt-2 max-w-xl text-sm leading-6 text-(--muted)">
        {firstValueStory}
      </p>
      {sourceStatus.kind === "FAILED" ? (
        <p className="mt-2 text-xs leading-5 text-ochre">The receipt address could not be opened. Manual evidence still works.</p>
      ) : null}
      <button type="button" onClick={onAddEvidence} className="btn btn-primary btn-lg mt-5">Add receipts manually</button>
    </section>
  );
}

function TotalBlock({ label, totals, empty }: { label: string; totals: readonly ProjectionTotalDto[]; empty: string }) {
  return (
    <div>
      <p className="eyebrow eyebrow-xs">{label}</p>
      {totals.length ? (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
          {totals.map((total) => (
            <MoneyValue key={total.amount.currency} amount={total.amount} className="text-3xl font-semibold text-(--ink)" />
          ))}
        </div>
      ) : (
        <p className="mt-2 font-data text-sm text-(--muted)">{empty}</p>
      )}
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
      <p className="mt-2 font-data text-xs text-(--muted)">
        {item.reminderEligible
          ? "Eligible for an opt-in reminder. Turn reminders on in Account to schedule an email."
          : item.decision?.value === "KEEP"
            ? "Not reminder eligible — you chose Keep for this subscription."
            : "Not reminder eligible — the evidence behind this date is not strong enough yet."}
      </p>
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
