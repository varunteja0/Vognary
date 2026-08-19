"use client";

import { useEffect } from "react";
import type {
  AttentionItemDto,
  ChangeItemDto,
  CommitmentSummaryDto,
  HomeProjectionDto,
  PossibleOverlapGroupDto,
  ProjectionTotalDto,
  ReceiptInboxStatusDto,
  UpcomingItemDto,
} from "@/lib/recovery/contracts";
import { hasCitedRecurringSpendPicture } from "@/lib/recovery/domain";
import {
  cadenceShortLabels,
  customerPhrases,
  firstResultBrief,
  homeAttentionItems,
  homeHasAttention,
  shouldOfferKeepCurrent,
  shouldShowComingUp,
  shouldShowRecentChange,
} from "./present";
import { RecoveryAutopilotHome } from "./recovery-autopilot-home";
import { RecoveryAttention } from "./recovery-attention";
import { attentionReasonLabels, changeKindLabels, formatDay } from "./labels";
import { MoneyValue } from "./recovery-states";

export function RecoveryHome({
  home,
  commitments,
  commitmentTotal,
  showFirstResult,
  receiptInboxPubliclyAvailable,
  onOpenCommitment,
  onAddEvidence,
  onOpenSources,
  onSeeAllCommitments,
  onWorkspaceMutated,
  onDismissFirstResult,
  receiptInbox,
  onVeto,
  pendingVetoId,
  onCitedPictureRendered,
}: {
  home: HomeProjectionDto;
  commitments: readonly CommitmentSummaryDto[];
  commitmentTotal: number;
  showFirstResult: boolean;
  receiptInboxPubliclyAvailable: boolean;
  onOpenCommitment: (commitmentId: string) => void;
  onAddEvidence: () => void;
  onOpenSources: () => void;
  onSeeAllCommitments: () => void;
  onWorkspaceMutated?: () => void;
  onDismissFirstResult: () => void;
  receiptInbox: ReceiptInboxStatusDto | null;
  onVeto?: (candidateId: string) => void;
  pendingVetoId?: string | null;
  onCitedPictureRendered?: (workspaceId: string) => void;
}) {
  if (home.autopilot?.mandate?.status === "ACTIVE") {
    return (
      <div className="grid gap-6">
        <RecoveryAutopilotHome
          autopilot={home.autopilot}
          onAddEvidence={onAddEvidence}
          onVeto={onVeto ?? (() => undefined)}
          pendingVetoId={pendingVetoId ?? null}
        />
        <RecoveryAttention
          embedded
          onOpenCommitment={onOpenCommitment}
          onOpenSources={onOpenSources}
          onWorkspaceMutated={onWorkspaceMutated}
        />
        <ComingUp home={home} onOpenCommitment={onOpenCommitment} onSeeAllCommitments={onSeeAllCommitments} />
        <SpendHero home={home} onCitedPictureRendered={onCitedPictureRendered} />
      </div>
    );
  }

  if (home.coverage.evidenceCount > 0 && commitmentTotal === 0) {
    return <FirstObservationHome home={home} onAddEvidence={onAddEvidence} />;
  }

  if (!home.coverage.evidenceCount) {
    return <EmptyRecoveryHome onAddEvidence={onAddEvidence} />;
  }

  if (showFirstResult) {
    return (
      <FirstResultHome
        home={home}
        commitments={commitments}
        onReview={onDismissFirstResult}
      />
    );
  }

  return (
    <div className="stack-page">
      <SpendHero home={home} onCitedPictureRendered={onCitedPictureRendered} />
      <NeedsAttention
        home={home}
        onOpenCommitment={onOpenCommitment}
        onOpenSources={onOpenSources}
        onWorkspaceMutated={onWorkspaceMutated}
      />
      <ComingUp home={home} onOpenCommitment={onOpenCommitment} onSeeAllCommitments={onSeeAllCommitments} />
      {shouldShowRecentChange(home) ? (
        <RecentChange items={home.changed.state === "COMPARED" ? home.changed.items : []} onOpenCommitment={onOpenCommitment} />
      ) : null}
      {shouldOfferKeepCurrent(receiptInboxPubliclyAvailable, receiptInbox) ? (
        <p className="text-sm leading-6 text-(--muted)">
          <button type="button" onClick={onOpenSources} className="text-(--ink-soft) underline underline-offset-4">
            {customerPhrases.keepCurrent}
          </button>
        </p>
      ) : null}
    </div>
  );
}

function EmptyRecoveryHome({ onAddEvidence }: { onAddEvidence: () => void }) {
  return (
    <section aria-label="Get started" className="mx-auto max-w-xl py-8 text-center sm:py-14">
      <h3 className="font-display text-3xl font-semibold tracking-tight text-(--ink)">{customerPhrases.emptyHomeTitle}</h3>
      <p className="mt-4 text-base leading-7 text-(--muted)">{customerPhrases.emptyHomeBody}</p>
      <button type="button" onClick={onAddEvidence} className="btn btn-primary btn-lg mt-8">
        {customerPhrases.addBills}
      </button>
      <p className="mt-4 text-sm text-(--muted)">{customerPhrases.noMailbox}</p>
    </section>
  );
}

function FirstObservationHome({
  home,
  onAddEvidence,
}: {
  home: HomeProjectionDto;
  onAddEvidence: () => void;
}) {
  return (
    <section aria-label="Not enough history yet" className="mx-auto max-w-xl py-6">
      <h3 className="font-display text-2xl font-semibold text-(--ink)">Not enough history yet</h3>
      <p className="mt-3 text-sm leading-6 text-(--muted)">
        {home.coverage.evidenceCount === 1
          ? "We saved 1 bill. Add another from the same tool if you want to see a pattern."
          : `We saved ${home.coverage.evidenceCount.toLocaleString("en-IN")} bills, but no tool has appeared twice yet.`}
      </p>
      {home.recentObservations.length ? (
        <ul className="mt-5 grid gap-3">
          {home.recentObservations.map((observation) => (
            <li key={observation.evidenceId} className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-display font-semibold text-(--ink)">{observation.merchant ?? "Merchant not published"}</span>
              {observation.amount ? <MoneyValue amount={observation.amount} className="text-sm font-semibold text-(--ink)" /> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" onClick={onAddEvidence} className="btn btn-primary mt-6">{customerPhrases.addBills}</button>
    </section>
  );
}

function FirstResultHome({
  home,
  commitments,
  onReview,
}: {
  home: HomeProjectionDto;
  commitments: readonly CommitmentSummaryDto[];
  onReview: () => void;
}) {
  const brief = firstResultBrief(home, commitments);
  const count = brief.commitmentCount || brief.items.length;
  return (
    <section aria-label="Import results" className="mx-auto max-w-xl py-6">
      <h3 className="font-display text-2xl font-semibold text-(--ink)">
        {count === 1 ? "We found 1 software commitment." : `We found ${count.toLocaleString("en-IN")} software commitments.`}
      </h3>
      <ul className="mt-6 grid gap-3">
        {brief.items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-display font-semibold text-(--ink)">{item.merchant}</span>
            <span className="font-data text-sm text-(--ink-soft)">
              {item.amount.display}{cadenceShortLabels[item.cadence]}
            </span>
          </li>
        ))}
      </ul>
      {brief.attentionCount > 0 ? (
        <p className="mt-5 text-sm leading-6 text-(--ink-soft)">
          {brief.attentionCount === 1 ? "1 item may need attention." : `${brief.attentionCount.toLocaleString("en-IN")} items may need attention.`}
        </p>
      ) : (
        <p className="mt-5 text-sm leading-6 text-(--muted)">{customerPhrases.caughtUp}</p>
      )}
      <button type="button" onClick={onReview} className="btn btn-primary btn-lg mt-6">
        {customerPhrases.reviewResults}
      </button>
    </section>
  );
}

function SpendHero({
  home,
  onCitedPictureRendered,
}: {
  home: HomeProjectionDto;
  onCitedPictureRendered?: (workspaceId: string) => void;
}) {
  const hasPicture = hasCitedRecurringSpendPicture(home);

  useEffect(() => {
    if (!hasPicture) return;
    onCitedPictureRendered?.(home.workspace.id);
  }, [hasPicture, home.workspace.id, onCitedPictureRendered]);

  return (
    <section aria-labelledby="home-spend">
      <p className="text-sm text-(--muted)">Software commitments</p>
      <h3 id="home-spend" className="mt-1 font-display text-3xl font-semibold tracking-tight text-(--ink)">
        <MonthlyLine totals={home.monthlyTotals} />
      </h3>
      <p className="mt-2 text-sm text-(--muted)">
        {home.activeCommitmentCount === 1
          ? "1 active tool"
          : `${home.activeCommitmentCount.toLocaleString("en-IN")} active tools`}
      </p>
    </section>
  );
}

function MonthlyLine({ totals }: { totals: readonly ProjectionTotalDto[] }) {
  if (!totals.length) return <span>No recurring amount yet</span>;
  return (
    <span>
      {totals.map((total, index) => (
        <span key={total.amount.currency}>
          {index > 0 ? " · " : null}
          <MoneyValue amount={total.amount} className="text-3xl font-semibold text-(--ink)" />
          <span className="text-xl font-normal text-(--ink-soft)"> / month</span>
        </span>
      ))}
    </span>
  );
}

function NeedsAttention({
  home,
  onOpenCommitment,
  onOpenSources,
  onWorkspaceMutated,
}: {
  home: HomeProjectionDto;
  onOpenCommitment: (commitmentId: string) => void;
  onOpenSources: () => void;
  onWorkspaceMutated?: () => void;
}) {
  const items = homeAttentionItems(home);
  const overlaps = home.possibleOverlaps;
  if (!homeHasAttention(home)) {
    return (
      <section aria-labelledby="recovery-needs-me">
        <h3 id="recovery-needs-me" className="sr-only">Needs attention</h3>
        <p className="text-sm leading-6 text-(--muted)">{customerPhrases.caughtUp}</p>
        <RecoveryAttention
          embedded
          onOpenCommitment={onOpenCommitment}
          onOpenSources={onOpenSources}
          onWorkspaceMutated={onWorkspaceMutated}
        />
      </section>
    );
  }
  return (
    <section aria-labelledby="recovery-needs-me" className="stack-section">
      <h3 id="recovery-needs-me" className="font-display text-xl font-semibold text-(--ink)">Needs attention</h3>
      {overlaps.map((group) => (
        <OverlapCard key={group.family} group={group} onOpenCommitment={onOpenCommitment} />
      ))}
      {items.map((item) => (
        <AttentionCard key={item.id} item={item} onOpenCommitment={onOpenCommitment} />
      ))}
      <RecoveryAttention
        embedded
        onOpenCommitment={onOpenCommitment}
        onOpenSources={onOpenSources}
        onWorkspaceMutated={onWorkspaceMutated}
      />
    </section>
  );
}

function AttentionCard({ item, onOpenCommitment }: { item: AttentionItemDto; onOpenCommitment: (commitmentId: string) => void }) {
  return (
    <article className="panel p-4">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-ochre">{attentionReasonLabels[item.reason]}</p>
      <h4 className="mt-2 font-display text-lg font-semibold text-(--ink)">{item.title.replace(/^Review /, "").replace(/^Confirm /, "")}</h4>
      <p className="mt-1 text-sm leading-6 text-(--ink-soft)">{item.detail}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-data text-xs text-(--muted)">
        {item.amount ? <MoneyValue amount={item.amount} className="text-sm text-(--ink)" /> : null}
        {item.dueDate ? <span>Renews {formatDay(item.dueDate)}</span> : null}
      </div>
      <button type="button" onClick={() => onOpenCommitment(item.commitmentId)} className="btn btn-sm btn-primary mt-4">
        Review
      </button>
    </article>
  );
}

function OverlapCard({
  group,
  onOpenCommitment,
}: {
  group: PossibleOverlapGroupDto;
  onOpenCommitment: (commitmentId: string) => void;
}) {
  return (
    <article className="panel p-4">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-ochre">Possible overlap</p>
      <h4 className="mt-2 font-display text-lg font-semibold text-(--ink)">{group.merchants.join(" + ")}</h4>
      <p className="mt-1 text-sm leading-6 text-(--ink-soft)">
        {group.yearlyTotals[0]
          ? `${group.yearlyTotals.map((total) => total.amount.display).join(" and ")} / year combined.`
          : "These tools may overlap. That does not mean they are interchangeable."}
      </p>
      <button type="button" onClick={() => onOpenCommitment(group.commitmentIds[0])} className="btn btn-sm btn-primary mt-4">
        Review
      </button>
    </article>
  );
}

function ComingUp({
  home,
  onOpenCommitment,
  onSeeAllCommitments,
}: {
  home: HomeProjectionDto;
  onOpenCommitment: (commitmentId: string) => void;
  onSeeAllCommitments: () => void;
}) {
  if (!shouldShowComingUp(home)) return null;
  return (
    <section aria-labelledby="recovery-next">
      <h3 id="recovery-next" className="font-display text-xl font-semibold text-(--ink)">Coming up</h3>
      <ul className="mt-4 grid gap-3">
        {home.next.map((item) => (
          <UpcomingRow key={`${item.commitmentId}-${item.date}`} item={item} onOpenCommitment={onOpenCommitment} />
        ))}
      </ul>
      <button type="button" onClick={onSeeAllCommitments} className="btn btn-sm btn-ghost mt-4">
        {customerPhrases.seeAllCommitments}
      </button>
    </section>
  );
}

function UpcomingRow({ item, onOpenCommitment }: { item: UpcomingItemDto; onOpenCommitment: (commitmentId: string) => void }) {
  return (
    <li>
      <button type="button" onClick={() => onOpenCommitment(item.commitmentId)} className="flex w-full flex-wrap items-baseline justify-between gap-2 py-1 text-left">
        <span className="font-display font-semibold text-(--ink)">{item.merchant}</span>
        <span className="font-data text-sm text-(--ink-soft)">
          {item.amount.display} · {formatDay(item.date)}
        </span>
      </button>
    </li>
  );
}

function RecentChange({
  items,
  onOpenCommitment,
}: {
  items: readonly ChangeItemDto[];
  onOpenCommitment: (commitmentId: string) => void;
}) {
  return (
    <section aria-labelledby="recovery-changed">
      <h3 id="recovery-changed" className="font-display text-xl font-semibold text-(--ink)">Recent change</h3>
      <ul className="mt-4 grid gap-3">
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => onOpenCommitment(item.commitmentId)} className="flex w-full flex-wrap items-baseline justify-between gap-2 py-1 text-left">
              <span className="font-display font-semibold text-(--ink)">{item.merchant}</span>
              <span className="text-sm text-(--ink-soft)">{changeKindLabels[item.kind]}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
