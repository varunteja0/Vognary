"use client";

import { cadences, type CommitmentDetailDto, type CorrectionDto, type EvidenceDto } from "@/lib/recovery/contracts";
import {
  cadenceLabels,
  commitmentStatusLabels,
  correctionFieldLabels,
  correctionStatusLabels,
  formatDay,
  formatMoment,
  formatObservedInstant,
  provenanceLabels,
  sourceLabels,
} from "./labels";
import type { CorrectionDraft } from "./state";
import { ConfidenceBadge, ConfidenceDetail, MoneyValue } from "./recovery-states";

const senderTrustLabels: Record<NonNullable<EvidenceDto["senderTrust"]>["tier"], string> = {
  VERIFIED_SENDER: "Verified by the receiving provider",
  KNOWN_SENDER: "Known sender",
  UNVERIFIED_SENDER: "Sender not verified",
  SUSPICIOUS_SENDER: "Sender authentication raised concerns",
};

// Evidence and correction surfaces. Every field shown here is copied from the
// server DTO; nothing is recomputed, reformatted as money, or filled in.

export function EvidenceRow({ evidence, buttonId, onInspect }: { evidence: EvidenceDto; buttonId: string; onInspect: () => void }) {
  return (
    <li className="inset p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-data text-xs text-(--muted)">
          {sourceLabels[evidence.source.type]} · {evidence.source.label}
        </p>
        {evidence.amount ? <MoneyValue amount={evidence.amount} className="text-sm font-semibold text-(--ink)" /> : <span className="font-data text-xs text-(--muted)">No amount published</span>}
      </div>
      <p className="mt-2 text-sm leading-6 text-(--ink-soft)">
        “{evidence.excerpt}”{evidence.excerptTruncated ? <span className="text-(--muted)"> (excerpt truncated by the workspace)</span> : null}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <ConfidenceBadge confidence={evidence.confidence} />
        <span className="font-data text-xs text-(--muted)">{evidence.date ? formatDay(evidence.date) : "No date published"}</span>
        <button type="button" id={buttonId} onClick={onInspect} className="btn btn-sm btn-ghost">See the receipt</button>
      </div>
    </li>
  );
}

export function EvidenceInspector({ evidence }: { evidence: EvidenceDto }) {
  const observedLabel = evidence.observedAt ? formatObservedInstant(evidence.observedAt, evidence.date) : null;
  return (
    <div className="grid gap-4">
      <Fact label="Observed fact (exact excerpt)">
        <p className="text-sm leading-6 text-(--ink)">“{evidence.excerpt}”</p>
        <p className="mt-2 font-data text-xs text-(--muted)">
          {evidence.excerptTruncated
            ? "The workspace truncated this excerpt to its published limit. It was not summarised or rewritten."
            : "This is the complete excerpt the workspace stored, unedited."}
        </p>
      </Fact>
      <div className="grid gap-4 sm:grid-cols-2">
        <Fact label="Source">
          <p className="text-sm leading-6 text-(--ink)">{sourceLabels[evidence.source.type]}</p>
          <p className="mt-1 font-data text-xs text-(--muted)">{evidence.source.label}</p>
          <p className="mt-1 font-data text-xs text-(--muted)">Ingested {formatMoment(evidence.source.ingestedAt)}</p>
          {evidence.source.coverageStart || evidence.source.coverageEnd ? (
            <p className="mt-1 font-data text-xs text-(--muted)">
              Source covers {evidence.source.coverageStart ? formatDay(evidence.source.coverageStart) : "the earliest stored date"} to {evidence.source.coverageEnd ? formatDay(evidence.source.coverageEnd) : "the latest stored date"}
            </p>
          ) : null}
        </Fact>
        <Fact label="Charge date">
          <p className="text-sm leading-6 text-(--ink)">{evidence.date ? formatDay(evidence.date) : "No date published"}</p>
          {observedLabel ? <p className="mt-1 font-data text-xs text-(--muted)">{observedLabel}</p> : null}
        </Fact>
        <Fact label="Amount and currency">
          {evidence.amount ? (
            <>
              <MoneyValue amount={evidence.amount} className="text-lg font-semibold text-(--ink)" />
              <p className="mt-1 font-data text-xs text-(--muted)">{evidence.amount.currency}</p>
            </>
          ) : (
            <p className="text-sm leading-6 text-(--muted)">No amount was published for this evidence.</p>
          )}
        </Fact>
        <Fact label="Provenance">
          <p className="text-sm leading-6 text-(--ink)">{provenanceLabels[evidence.provenance.kind]}</p>
          <p className="mt-1 font-data text-xs text-(--muted)">Immutable: this evidence can never be edited, only corrected above it.</p>
        </Fact>
        {evidence.senderTrust ? <SenderTrust evidence={evidence} /> : null}
      </div>
      <Fact label="Confidence and uncertainty">
        <ConfidenceDetail confidence={evidence.confidence} />
      </Fact>
    </div>
  );
}

function SenderTrust({ evidence }: { evidence: EvidenceDto }) {
  const senderTrust = evidence.senderTrust;
  if (!senderTrust) return null;
  return (
    <Fact label="Sender authentication">
      <p className="text-sm font-medium leading-6 text-(--ink)">{senderTrustLabels[senderTrust.tier]}</p>
      <p className="mt-1 font-data text-xs text-(--muted)">
        Sender domain: {senderTrust.fromDomain ?? "not established"}
      </p>
      <p className="mt-1 font-data text-xs text-(--muted)">
        Receiving authority: {senderTrust.trustedAuthority ?? "none trusted for this message"}
      </p>
      {senderTrust.reasons.length ? (
        <ul className="mt-2 grid gap-1 text-xs leading-5 text-(--muted)">
          {senderTrust.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      ) : null}
    </Fact>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="inset p-4">
      <p className="eyebrow eyebrow-xs">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function describeCorrection(correction: CorrectionDto): string {
  const patch = correction.patch;
  switch (patch.field) {
    case "MERCHANT":
      return `Merchant set to “${patch.value.merchant}”`;
    case "AMOUNT":
      return correction.authoritativeAmount
        ? `Amount set to ${correction.authoritativeAmount.display}`
        : "Amount correction display was not published by the workspace";
    case "NEXT_EXPECTED_DATE":
      return `Expected date set to ${formatDay(patch.value.date)}`;
    case "CADENCE":
      return `Cadence set to ${cadenceLabels[patch.value.cadence]}`;
    case "IS_RECURRING":
      return patch.value.isRecurring ? "Marked as recurring" : "Marked as not recurring";
  }
}

export function CorrectionHistory({
  corrections,
  onReverse,
  reversingId,
  disabled,
}: {
  corrections: readonly CorrectionDto[];
  onReverse: (correction: CorrectionDto) => void;
  reversingId: string | null;
  disabled: boolean;
}) {
  if (!corrections.length) {
    return <p className="text-sm leading-6 text-(--muted)">You have not corrected this commitment. Every value above came from your evidence.</p>;
  }
  return (
    <ol className="grid gap-3">
      {corrections.map((correction) => (
        <li key={correction.id} className="inset p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-(--ink)">{correctionFieldLabels[correction.patch.field]}</p>
            <span className={correction.status === "ACTIVE" ? "pill pill-ready" : correction.status === "REVERSED" ? "pill pill-blocked" : "pill pill-planned"}>
              {correctionStatusLabels[correction.status]}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-(--ink-soft)">{describeCorrection(correction)}</p>
          {correction.reason ? <p className="mt-1 text-sm leading-6 text-(--muted)">Your reason: {correction.reason}</p> : null}
          <p className="mt-2 font-data text-xs text-(--muted)">
            Recorded {formatMoment(correction.createdAt)}
            {correction.status === "REVERSED" ? ` · reversed ${formatMoment(correction.reversedAt)}` : ""}
            {correction.status === "SUPERSEDED" ? ` · superseded ${formatMoment(correction.supersededAt)}` : ""}
          </p>
          {correction.status === "ACTIVE" ? (
            <button
              type="button"
              onClick={() => onReverse(correction)}
              disabled={disabled}
              className="btn btn-sm btn-ghost mt-3"
            >
              {reversingId === correction.id ? "Reversing…" : "Reverse this correction"}
            </button>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function CorrectionForm({
  draft,
  detail,
  onChange,
  formId,
  onSubmit,
}: {
  draft: CorrectionDraft;
  detail: CommitmentDetailDto;
  onChange: (patch: Partial<CorrectionDraft>) => void;
  formId: string;
  onSubmit: () => void;
}) {
  return (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="grid gap-4"
    >
      {draft.field === "MERCHANT" ? (
        <label className="grid gap-1.5">
          <span className="field-label">Merchant as it should read</span>
          <input className="field" value={draft.merchant} onChange={(event) => onChange({ merchant: event.target.value })} autoComplete="off" />
          <span className="field-hint">The workspace currently shows “{detail.merchant}”.</span>
        </label>
      ) : null}

      {draft.field === "AMOUNT" ? (
        <label className="grid gap-1.5">
          <span className="field-label">Amount in {detail.amount.currency}</span>
          <input className="field" inputMode="decimal" value={draft.amountMinor} onChange={(event) => onChange({ amountMinor: event.target.value })} autoComplete="off" />
          <span className="field-hint">
            The workspace currently shows {detail.amount.display}. Enter the amount a founder would read on the receipt, not a converted unit.
          </span>
        </label>
      ) : null}

      {draft.field === "NEXT_EXPECTED_DATE" ? (
        <label className="grid gap-1.5">
          <span className="field-label">Date you actually expect this</span>
          <input className="field" type="date" value={draft.date} onChange={(event) => onChange({ date: event.target.value })} />
          <span className="field-hint">
            The workspace currently expects {detail.nextExpectedDate ? formatDay(detail.nextExpectedDate) : "no date at all"}.
          </span>
        </label>
      ) : null}

      {draft.field === "CADENCE" ? (
        <label className="grid gap-1.5">
          <span className="field-label">How often this actually repeats</span>
          <select className="field" value={draft.cadence} onChange={(event) => onChange({ cadence: event.target.value as CorrectionDraft["cadence"] })}>
            {cadences.map((cadence) => (
              <option key={cadence} value={cadence}>{cadenceLabels[cadence]}</option>
            ))}
          </select>
          <span className="field-hint">The workspace currently shows {cadenceLabels[detail.cadence]}.</span>
        </label>
      ) : null}

      {draft.field === "IS_RECURRING" ? (
        <fieldset className="grid gap-2">
          <legend className="field-label">Is this recurring at all?</legend>
          <label className="flex items-center gap-2 text-sm text-(--ink-soft)">
            <input type="radio" name="recovery-is-recurring" checked={draft.isRecurring} onChange={() => onChange({ isRecurring: true })} />
            Yes, it repeats
          </label>
          <label className="flex items-center gap-2 text-sm text-(--ink-soft)">
            <input type="radio" name="recovery-is-recurring" checked={!draft.isRecurring} onChange={() => onChange({ isRecurring: false })} />
            No, this was a one-off
          </label>
          <span className="field-hint">The workspace currently classifies this as {commitmentStatusLabels[detail.status]}.</span>
        </fieldset>
      ) : null}

      <label className="grid gap-1.5">
        <span className="field-label">Why (optional, kept with the correction)</span>
        <textarea className="field min-h-20" value={draft.reason} onChange={(event) => onChange({ reason: event.target.value })} />
      </label>

      <p className="text-xs leading-5 text-(--muted)">
        Your evidence is never edited. A correction is recorded on top of it and can be reversed at any time.
      </p>
    </form>
  );
}
