"use client";

import { useEffect, useState } from "react";
import type { AttentionItemDto, ChangeItemDto, HomeProjectionDto, ProjectionTotalDto, ReceiptInboxStatusDto, UpcomingItemDto } from "@/lib/recovery/contracts";
import { hasCitedRecurringSpendPicture } from "@/lib/recovery/domain";
import { renderRecoveryShareText } from "@/lib/recovery/share-report";
import { RecoveryAutopilotHome } from "./recovery-autopilot-home";
import { RecoveryAttention } from "./recovery-attention";
import {
  attentionReasonLabels,
  cadenceLabels,
  changeKindLabels,
  commitmentStatusLabels,
  decisionLabels,
  formatDay,
  formatMoment,
  coverageLabels,
  coverageMeanings,
  projectionAmountProvenanceLabels,
  priorityLabels,
  confidenceTruthLayerLabels,
} from "./labels";
import { ConfidenceBadge, MoneyValue, StateBlock } from "./recovery-states";

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
  onOpenSources,
  onWorkspaceMutated,
  receiptInbox,
  onVeto,
  pendingVetoId,
  onCitedPictureRendered,
}: {
  home: HomeProjectionDto;
  commitmentTotal: number;
  receiptInboxPubliclyAvailable: boolean;
  onOpenCommitment: (commitmentId: string) => void;
  onInspectEvidence: InspectEvidence;
  onAddEvidence: () => void;
  onOpenSources: () => void;
  onWorkspaceMutated?: () => void;
  receiptInbox: ReceiptInboxStatusDto | null;
  onVeto?: (candidateId: string) => void;
  pendingVetoId?: string | null;
  onCitedPictureRendered?: (workspaceId: string) => void;
}) {
  const [shareStatus, setShareStatus] = useState("");

  async function copyShareText() {
    try {
      await navigator.clipboard.writeText(renderRecoveryShareText(home));
      setShareStatus("Summary copied.");
    } catch {
      setShareStatus("Could not copy automatically. Try again from a browser that allows clipboard access.");
    }
  }

  if (home.autopilot?.mandate?.status === "ACTIVE") {
    return (
      <div className="grid gap-5">
        <RecoveryAutopilotHome
          autopilot={home.autopilot}
          onAddEvidence={onAddEvidence}
          onVeto={onVeto ?? (() => undefined)}
          pendingVetoId={pendingVetoId ?? null}
        />
        <RecoveryAttention
          onOpenCommitment={onOpenCommitment}
          onOpenSources={onOpenSources}
          onWorkspaceMutated={onWorkspaceMutated}
        />
        <UpcomingTimeline home={home} compact onOpenCommitment={onOpenCommitment} onInspectEvidence={onInspectEvidence} />
        <RecoveryFirstValueMetrics home={home} compact onCitedPictureRendered={onCitedPictureRendered} />
        <RecoveryProjectionDetails home={home} />
      </div>
    );
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
      receiptInboxPubliclyAvailable={receiptInboxPubliclyAvailable}
      onAddEvidence={onAddEvidence}
      onOpenSources={onOpenSources}
    />;
  }

  return (
    <div className="grid gap-5">
      <WhatWeFound home={home} />

      <PossibleOverlapQueue home={home} onOpenCommitment={onOpenCommitment} />

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
                title="Your commitments look the same"
                detail="No amount, date, frequency, or recurring status changed in the latest receipts."
              />
            )}
          </div>
        </section>
      ) : null}

      <RecoveryAttention
        onOpenCommitment={onOpenCommitment}
        onOpenSources={onOpenSources}
        onWorkspaceMutated={onWorkspaceMutated}
      />

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

      <UpcomingTimeline home={home} onOpenCommitment={onOpenCommitment} onInspectEvidence={onInspectEvidence} />

      <RecoveryFirstValueMetrics home={home} onCitedPictureRendered={onCitedPictureRendered} />

      <RecoveryProjectionDetails home={home} />

      <KeepCurrentOffer
        receiptInboxPubliclyAvailable={receiptInboxPubliclyAvailable}
        receiptInbox={receiptInbox}
        onOpenSources={onOpenSources}
      />

      <section aria-labelledby="recovery-receipts" className="grid gap-3 border-t border-line px-1 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 id="recovery-receipts" className="font-display text-base font-semibold text-(--ink)">Receipts checked</h3>
            <p className="mt-1 font-data text-xs text-(--muted)">
              {`${home.coverage.evidenceCount} item${home.coverage.evidenceCount === 1 ? "" : "s"} from ${home.coverage.sourceCount} source${home.coverage.sourceCount === 1 ? "" : "s"} · latest ${home.coverage.lastEvidenceAt ? formatMoment(home.coverage.lastEvidenceAt) : "date unavailable"}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void copyShareText()} className="btn btn-sm btn-primary">Copy summary</button>
            <button type="button" onClick={onAddEvidence} className="btn btn-sm btn-ghost">Add receipts</button>
          </div>
        </div>
        <p className="text-xs leading-5 text-(--muted)">This is a floor from receipts checked, not every software bill.</p>
        <p role="status" aria-live="polite" className="min-h-5 text-xs text-(--muted)">{shareStatus}</p>
      </section>
    </div>
  );
}

const receiptsAlreadyHaveStory = "Start with the billing receipts you already have. Vognary will reconstruct your current commitments, upcoming renewals and changes from the evidence. Cadence and renewal dates appear only when the receipts support them. No mailbox access. No global forwarding. You choose the evidence Vognary analyzes.";

function RecoveryFirstValueMetrics({
  home,
  compact = false,
  onCitedPictureRendered,
}: {
  home: HomeProjectionDto;
  compact?: boolean;
  onCitedPictureRendered?: (workspaceId: string) => void;
}) {
  const hasPicture = hasCitedRecurringSpendPicture(home);

  useEffect(() => {
    if (!hasPicture) return;
    onCitedPictureRendered?.(home.workspace.id);
  }, [hasPicture, home.workspace.id, onCitedPictureRendered]);

  return (
    <section aria-labelledby={compact ? undefined : "recovery-committed"} aria-label={compact ? "Currently committed" : undefined} className={compact ? "panel p-3 sm:p-4" : "panel p-4 sm:p-5"}>
      {compact ? null : <h3 id="recovery-committed" className="font-display text-xl font-semibold text-(--ink)">Currently committed</h3>}
      <div className={compact ? undefined : "mt-4"}>
      <TotalBlock
        label="Monthly recurring amount"
        totals={home.monthlyTotals}
        empty={home.uncertainDuplicateCommitmentCount > 0
          ? "Monthly total is not published while some commitments may be listed twice."
          : "No recurring amount yet"}
        compact={compact}
      />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <CountBlock label="Active commitments" count={home.activeCommitmentCount} compact={compact} />
        <CountBlock label="Needs review" count={home.reviewItemCount} compact={compact} />
      </div>
      {home.unknownCadenceCommitmentCount > 0 ? (
        <p className="mt-4 text-xs leading-5 text-(--muted)">
          {home.unknownCadenceCommitmentCount} {home.unknownCadenceCommitmentCount === 1 ? "commitment has" : "commitments have"} no established cadence, so {home.unknownCadenceCommitmentCount === 1 ? "it is" : "they are"} excluded from monthly and annual totals. Any dated debit still appears in Next 30 days.
        </p>
      ) : null}
      {home.uncertainDuplicateCommitmentCount > 0 ? (
        <p className="mt-2 text-xs leading-5 text-(--muted)">
          {home.uncertainDuplicateCommitmentCount === 1
            ? "1 commitment may be listed twice, so it is omitted from monthly, next-30-day, and annual totals until you tell us whether those rows are the same."
            : `${home.uncertainDuplicateCommitmentCount} commitments may be listed twice, so they are omitted from monthly, next-30-day, and annual totals until you tell us whether those rows are the same.`}
        </p>
      ) : null}
      {home.confidenceLayers.length ? (
        <ul className="mt-4 grid gap-2" aria-label="Certainty of monthly totals">
          {home.confidenceLayers.map((layer) => (
            <li key={layer.layer} className="flex flex-wrap items-baseline justify-between gap-2 text-sm leading-6">
              <span className="text-(--ink-soft)">
                {confidenceTruthLayerLabels[layer.layer]}
                <span className="font-data text-xs text-(--muted)"> · {layer.commitmentCount}</span>
              </span>
              <span className="font-data tnum text-(--ink)">
                {layer.totals.length
                  ? layer.totals.map((total) => `${total.amount.display} ${total.amount.currency}`).join(" · ")
                  : "No amount"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {home.coverage.state !== "CURRENT" ? (
        <p className="mt-2 text-xs leading-5 text-(--muted)" data-coverage-state={home.coverage.state}>
          {coverageLabels[home.coverage.state]}. {coverageMeanings[home.coverage.state]}
          {home.coverage.limitations[0] ? ` ${home.coverage.limitations[0]}` : ""}
        </p>
      ) : null}
    </section>
  );
}

function RecoveryProjectionDetails({ home }: { home: HomeProjectionDto }) {
  const omittedAnnualized = home.monthlyTotals.some(
    (total) => !home.annualizedEstimateTotals.some((annualized) => annualized.amount.currency === total.amount.currency),
  );
  return (
    <section aria-label="Recurring money details" className="panel p-4 sm:p-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <TotalBlock
          label="Next 30 days"
          totals={home.next30DayTotals}
          empty={home.uncertainDuplicateCommitmentCount > 0
            ? "Next-30-day total is not published while some commitments may be listed twice."
            : "Nothing expected in the next 30 days"}
        />
        <TotalBlock
          label="Annualized estimate"
          totals={home.annualizedEstimateTotals}
          empty={home.uncertainDuplicateCommitmentCount > 0
            ? "Annualized estimate is not published while some commitments may be listed twice."
            : "No annualized estimate yet"}
        />
      </div>
      {omittedAnnualized ? (
        <p className="mt-4 text-xs leading-5 text-(--muted)">
          An annualized estimate is not published when 12 × the cited monthly equivalent exceeds what Vognary can display.
        </p>
      ) : home.annualizedEstimateTotals.length ? (
        <p className="mt-4 text-xs leading-5 text-(--muted)">
          {home.annualizedEstimateTotals.some((total) => total.provenance === "USER_CORRECTED")
            ? "Annualized estimate is 12 × the cited monthly equivalent, including a saved correction. It is not a historical yearly total."
            : "Annualized estimate is 12 × the cited monthly equivalent from receipts. It is not a historical yearly total."}
        </p>
      ) : null}
      {home.monthlyTotals.length > 1 || home.annualizedEstimateTotals.length > 1 || home.next30DayTotals.length > 1 ? (
        <p className="mt-2 text-xs leading-5 text-(--muted)">
          Currencies stay separate because Vognary does not invent an exchange rate.
        </p>
      ) : null}
    </section>
  );
}

function UpcomingTimeline({
  home,
  compact = false,
  onOpenCommitment,
  onInspectEvidence,
}: {
  home: HomeProjectionDto;
  compact?: boolean;
  onOpenCommitment: (commitmentId: string) => void;
  onInspectEvidence: InspectEvidence;
}) {
  return (
    <section aria-labelledby="recovery-next" className={compact ? "panel p-3 sm:p-4" : "panel p-4 sm:p-5"}>
      <h3 id="recovery-next" className={`font-display font-semibold text-(--ink) ${compact ? "text-lg" : "text-xl"}`}>Coming up</h3>
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
  );
}

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
        When the next matching billing email arrives, Vognary can test a cadence. You can also add a matching receipt as a fallback. A matching charge can unlock cadence, monthly spend, an expected date, and a decision without inventing recurrence.
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
      <p className="mt-4 text-xs leading-5 text-(--muted)">This is a floor from receipts checked, not every software bill.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" onClick={onAddEvidence} className="btn btn-primary btn-lg">Add a matching receipt</button>
        <button type="button" onClick={onCopyShareText} className="btn btn-ghost">Copy summary</button>
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

function WhatWeFound({ home }: { home: HomeProjectionDto }) {
  const comparedItems = home.changed.state === "COMPARED" ? home.changed.items : [];
  const priceChanges = comparedItems.filter((item) => item.kind === "AMOUNT").length;
  const facts: string[] = [];
  if (home.activeCommitmentCount > 0) {
    facts.push(`${home.activeCommitmentCount.toLocaleString("en-IN")} commitment${home.activeCommitmentCount === 1 ? "" : "s"} found`);
  }
  for (const total of home.monthlyTotals) {
    facts.push(`${total.amount.display}/month currently identified`);
  }
  if (priceChanges > 0) {
    facts.push(`${priceChanges.toLocaleString("en-IN")} price change${priceChanges === 1 ? "" : "s"}`);
  }
  if (home.next.length > 0) {
    facts.push(`${home.next.length.toLocaleString("en-IN")} upcoming expected commitment${home.next.length === 1 ? "" : "s"}`);
  }
  if (home.reviewItemCount > 0) {
    facts.push(`${home.reviewItemCount.toLocaleString("en-IN")} item${home.reviewItemCount === 1 ? "" : "s"} ${home.reviewItemCount === 1 ? "needs" : "need"} review`);
  }
  if (home.uncertainDuplicateCommitmentCount > 0) {
    facts.push(
      home.uncertainDuplicateCommitmentCount === 1
        ? "1 item may be listed twice"
        : `${home.uncertainDuplicateCommitmentCount.toLocaleString("en-IN")} items may be listed twice`,
    );
  }
  for (const group of home.possibleOverlaps) {
    facts.push(`${group.merchants.length.toLocaleString("en-IN")} tools may overlap (${group.label})`);
  }
  if (!facts.length) return null;
  return (
    <section aria-labelledby="what-we-found" className="panel border-ochre p-4 sm:p-5">
      <p className="eyebrow eyebrow-xs text-ochre">From your evidence</p>
      <h3 id="what-we-found" className="mt-2 font-display text-xl font-semibold text-(--ink)">What we found</h3>
      <ul className="mt-4 grid gap-2">
        {facts.map((fact) => (
          <li key={fact} className="font-display text-base font-semibold text-(--ink)">{fact}</li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-5 text-(--muted)">Every figure is from stored evidence. Unknown remains unknown.</p>
    </section>
  );
}

function KeepCurrentOffer({
  receiptInboxPubliclyAvailable,
  receiptInbox,
  onOpenSources,
}: {
  receiptInboxPubliclyAvailable: boolean;
  receiptInbox: ReceiptInboxStatusDto | null;
  onOpenSources: () => void;
}) {
  if (!receiptInboxPubliclyAvailable) return null;
  if (receiptInbox?.forwardingVerifiedAt && receiptInbox.setupCompletedAt) return null;
  return (
    <section aria-labelledby="keep-current" className="panel p-4 sm:p-5">
      <p className="eyebrow eyebrow-xs text-ochre">After you have seen this</p>
      <h3 id="keep-current" className="mt-2 font-display text-xl font-semibold text-(--ink)">Keep this current</h3>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">
        Set up a private Vognary billing address and one billing-only forwarding filter so matching mail can keep arriving. Vognary does not read the mailbox and does not capture every bill. Coverage depends on the rule you create.
      </p>
      <button type="button" onClick={onOpenSources} className="btn btn-primary mt-4">Keep Vognary current</button>
    </section>
  );
}

function PossibleOverlapQueue({
  home,
  onOpenCommitment,
}: {
  home: HomeProjectionDto;
  onOpenCommitment: (commitmentId: string) => void;
}) {
  if (!home.possibleOverlaps.length) return null;
  return (
    <section aria-labelledby="recovery-decisions" className="panel border-ochre p-4 sm:p-5">
      <p className="eyebrow eyebrow-xs text-ochre">Software decisions</p>
      <h3 id="recovery-decisions" className="mt-2 font-display text-xl font-semibold text-(--ink)">Decisions worth reviewing</h3>
      <div className="mt-4 grid gap-3">
        {home.possibleOverlaps.map((group) => (
          <article key={group.family} className="inset p-4">
            <p className="font-data text-xs uppercase tracking-[0.14em] text-ochre">Possible overlap</p>
            <h4 className="mt-2 font-display text-base font-semibold text-(--ink)">{group.label}</h4>
            <p className="mt-1 text-sm leading-6 text-(--ink-soft)">
              {group.merchants.join(", ")}
              {group.yearlyTotals[0]
                ? ` — ${group.yearlyTotals.map((total) => total.amount.display).join(" and ")}/year across ${group.merchants.length.toLocaleString("en-IN")} tools.`
                : "."}
            </p>
            <p className="mt-2 text-sm leading-6 text-(--muted)">
              {group.missingPurposeCount > 0
                ? "These tools share a category. That does not mean they are interchangeable. Tell Vognary what each is used for before deciding."
                : group.sharedPurpose
                  ? "You told Vognary more than one of these is used for the same job. Review whether both are still needed."
                  : "You told Vognary what each is used for. Keep or review each tool from its commitment."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {group.items.map((item) => (
                <button
                  key={item.commitmentId}
                  type="button"
                  onClick={() => onOpenCommitment(item.commitmentId)}
                  className="btn btn-sm btn-ghost"
                >
                  Open {item.merchant}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function EmptyRecoveryHome({
  receiptInboxPubliclyAvailable,
  onAddEvidence,
  onOpenSources,
}: {
  receiptInboxPubliclyAvailable: boolean;
  onAddEvidence: () => void;
  onOpenSources: () => void;
}) {
  return (
    <section aria-label="Get your first result" className="panel p-5 sm:p-6">
      <p className="eyebrow eyebrow-xs text-ochre">First useful output</p>
      <h3 className="mt-3 font-display text-xl font-semibold text-(--ink) sm:text-2xl">Add a few recent software bills</h3>
      <p className="mt-2 max-w-xl text-sm leading-6 text-(--muted)">{receiptsAlreadyHaveStory}</p>
      <button type="button" onClick={onAddEvidence} className="btn btn-primary btn-lg mt-5">Add a few recent software bills</button>
      {receiptInboxPubliclyAvailable ? (
        <button type="button" onClick={onOpenSources} className="btn btn-sm btn-ghost mt-3">Keep Vognary current later</button>
      ) : null}
    </section>
  );
}

function TotalBlock({
  label,
  totals,
  empty,
  compact = false,
}: {
  label: string;
  totals: readonly ProjectionTotalDto[];
  empty: string;
  compact?: boolean;
}) {
  return (
    <div>
      <p className="eyebrow eyebrow-xs">{label}</p>
      {totals.length ? (
        <div className="mt-2 grid gap-2">
          {totals.map((total) => (
            <div key={total.amount.currency}>
              <MoneyValue
                amount={total.amount}
                className={`${compact ? "text-2xl" : "text-3xl"} font-semibold text-(--ink)`}
              />
              <p className="mt-1 text-xs leading-5 text-(--muted)">{projectionAmountProvenanceLabels[total.provenance]}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 font-data text-sm text-(--muted)">{empty}</p>
      )}
    </div>
  );
}

function CountBlock({ label, count, compact = false }: { label: string; count: number; compact?: boolean }) {
  return (
    <div>
      <p className="eyebrow eyebrow-xs">{label}</p>
      <p className={`mt-2 font-data ${compact ? "text-2xl" : "text-3xl"} font-semibold text-(--ink)`}>{count.toLocaleString("en-IN")}</p>
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
            ? "Not reminder eligible — you chose Keep for this commitment."
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
