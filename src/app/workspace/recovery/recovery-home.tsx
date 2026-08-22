"use client";

import { useEffect, useId, useState } from "react";
import {
  commitmentPurposes,
  type CommitmentSummaryDto,
  type DecisionCardDto,
  type DecisionOutcomeDto,
  type DecisionReviewSnooze,
  type HomeProjectionDto,
  type ProjectionTotalDto,
  type PutCommitmentContextRequest,
  type PutDecisionRequest,
  type QuietNextChargeDto,
  type ReceiptInboxStatusDto,
  type UpcomingItemDto,
} from "@/lib/recovery/contracts";
import { hasCitedRecurringSpendPicture } from "@/lib/recovery/domain";
import {
  chargeWhenLine,
  customerPhrases,
  decisionOutcomeTone,
  firstResultBrief,
  shouldOfferKeepCurrent,
  shouldShowComingUp,
  shouldShowRecentChange,
} from "./present";
import {
  actionFromDecision,
  decisionArtefactText,
  decisionHookCopy,
  keepIsPrimary,
  paymentAskQuestion,
  reminderOffer,
  shouldOfferPaymentAsk,
} from "@/lib/recovery/wow-first-session";
import { RecoveryAutopilotHome } from "./recovery-autopilot-home";
import { RecoveryAttention } from "./recovery-attention";
import {
  changeKindLabels,
  decisionReviewSnoozeLabels,
  formatDay,
  purposeLabels,
} from "./labels";
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
  onDecide,
  onSaveContext,
  onReminderConsent,
  onPaymentAsk,
  receiptInbox,
  onVeto,
  pendingVetoId,
  pendingDecisionId,
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
  onDecide: (request: PutDecisionRequest) => void;
  onSaveContext: (commitmentId: string, request: PutCommitmentContextRequest) => void;
  onReminderConsent?: () => void;
  onPaymentAsk?: (answer: "yes" | "no") => void;
  receiptInbox: ReceiptInboxStatusDto | null;
  onVeto?: (candidateId: string) => void;
  pendingVetoId?: string | null;
  pendingDecisionId?: string | null;
  onCitedPictureRendered?: (workspaceId: string) => void;
}) {
  const [lastHook, setLastHook] = useState<{ title: string; body: string; artefact: string } | null>(null);
  const [paymentAnswer, setPaymentAnswer] = useState<"unasked" | "yes" | "no">("unasked");

  function rememberDecision(request: PutDecisionRequest) {
    const card = home.decisionQueue.find((item) => item.commitmentId === request.commitmentId);
    const action = request.action ?? actionFromDecision(request.decision);
    if (card && action) {
      const hook = decisionHookCopy({
        merchant: card.merchant,
        action,
        watchDate: card.dueDate ? formatDay(card.dueDate) : null,
      });
      setLastHook({
        title: hook.title,
        body: hook.body,
        artefact: decisionArtefactText({
          merchant: card.merchant,
          amountDisplay: card.charge.display,
          whenLine: chargeWhenLine(card.dueDate, card.daysAway, card.dueDate ? formatDay(card.dueDate) : null),
          action,
          excerpt: card.excerpt,
        }),
      });
    }
    onDecide(request);
  }

  const verifiedOutcomes = home.decisionOutcomes.filter((outcome) => (
    outcome.kind === "CONTINUED_AS_PLANNED" || outcome.kind === "CHARGE_AFTER_CANCEL_PLAN"
  )).length;
  const showPaymentAsk = paymentAnswer === "unasked"
    && shouldOfferPaymentAsk(home.decisionOutcomes.length, verifiedOutcomes);

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
        <ComingLater home={home} onOpenCommitment={onOpenCommitment} onSeeAllCommitments={onSeeAllCommitments} />
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
        pendingDecisionId={pendingDecisionId}
        lastHook={lastHook}
        onReview={onDismissFirstResult}
        onDecide={rememberDecision}
        onSaveContext={onSaveContext}
        onOpenCommitment={onOpenCommitment}
        onReminderConsent={onReminderConsent}
      />
    );
  }

  return (
    <div className="w-full max-w-3xl">
      <div className="stack-page">
        <CitedPictureActivation home={home} onCitedPictureRendered={onCitedPictureRendered} />
        <DecisionQueue
          home={home}
          pendingDecisionId={pendingDecisionId}
          lastHook={lastHook}
          onDecide={rememberDecision}
          onSaveContext={onSaveContext}
          onOpenCommitment={onOpenCommitment}
          onReminderConsent={onReminderConsent}
        />
        <DecisionOutcomes home={home} onOpenCommitment={onOpenCommitment} />
        {showPaymentAsk ? (
          <PaymentAsk
            onAnswer={(answer) => {
              setPaymentAnswer(answer);
              onPaymentAsk?.(answer);
            }}
          />
        ) : null}
        <ComingLater home={home} onOpenCommitment={onOpenCommitment} onSeeAllCommitments={onSeeAllCommitments} />
        {shouldShowRecentChange(home) ? (
          <RecentChange items={home.changed.state === "COMPARED" ? home.changed.items : []} onOpenCommitment={onOpenCommitment} />
        ) : null}
        {shouldOfferKeepCurrent(receiptInboxPubliclyAvailable, receiptInbox) ? (
          <p className="text-sm leading-6 text-(--muted)">
            <button type="button" onClick={onOpenSources} className="link-quiet">
              {customerPhrases.keepCurrent}
            </button>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SectionHeading({ id, children }: { id: string; children: string }) {
  return (
    <h3 id={id} className="font-display text-lg font-semibold tracking-tight text-(--ink)">
      {children}
    </h3>
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
    <section aria-label="Not enough history yet" className="w-full max-w-xl py-6">
      <h3 className="font-display text-2xl font-semibold text-(--ink)">Not enough history yet</h3>
      <p className="mt-3 text-sm leading-6 text-(--muted)">
        {home.coverage.evidenceCount === 1
          ? "We saved 1 bill. Add another from the same tool if you want to see a pattern."
          : `We saved ${home.coverage.evidenceCount.toLocaleString("en-IN")} bills, but no tool has appeared twice yet.`}
      </p>
      {home.recentObservations.length ? (
        <ul className="ledger-list mt-5 grid">
          {home.recentObservations.map((observation) => (
            <li key={observation.evidenceId}>
              <p className="ledger-line">
                <span className="ledger-name">{observation.merchant ?? "Merchant not published"}</span>
                {observation.amount ? (
                  <span className="ledger-meta">
                    <MoneyValue amount={observation.amount} className="text-(--ink)" />
                  </span>
                ) : null}
              </p>
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
  pendingDecisionId,
  lastHook,
  onReview,
  onDecide,
  onSaveContext,
  onOpenCommitment,
  onReminderConsent,
}: {
  home: HomeProjectionDto;
  commitments: readonly CommitmentSummaryDto[];
  pendingDecisionId?: string | null;
  lastHook: { title: string; body: string; artefact: string } | null;
  onReview: () => void;
  onDecide: (request: PutDecisionRequest) => void;
  onSaveContext: (commitmentId: string, request: PutCommitmentContextRequest) => void;
  onOpenCommitment: (commitmentId: string) => void;
  onReminderConsent?: () => void;
}) {
  const brief = firstResultBrief(home, commitments);
  const count = brief.commitmentCount || brief.items.length;
  const queue = home.decisionQueue;
  const next = home.nextQuietCharge;
  return (
    <section aria-label="Import results" className="w-full max-w-2xl py-4 sm:py-6">
      <p className="text-sm leading-6 text-(--muted)">
        {count === 1 ? "1 software bill is on the table." : `${count.toLocaleString("en-IN")} software bills are on the table.`}
      </p>
      {lastHook ? <DecisionHook hook={lastHook} onReminderConsent={onReminderConsent} /> : null}
      {queue.length ? (
        <>
          <h3 className="mt-2 font-display text-2xl font-semibold tracking-tight text-(--ink) sm:text-3xl">
            {queue.length === 1
              ? "Decide this before the next charge"
              : `${queue.length.toLocaleString("en-IN")} need a decision before the next charge`}
          </h3>
          <div className="mt-6 grid gap-3">
            {queue.map((card, index) => (
              <DecisionCard
                key={card.commitmentId}
                card={card}
                prominent={index === 0}
                pending={pendingDecisionId === card.commitmentId}
                onDecide={onDecide}
                onSaveContext={onSaveContext}
                onOpenCommitment={onOpenCommitment}
              />
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-(--muted)">{customerPhrases.decisionBoundary}</p>
        </>
      ) : lastHook ? (
        next ? <NextChargeLine next={next} className="mt-5" /> : null
      ) : (
        <>
          <h3 className="mt-2 font-display text-2xl font-semibold tracking-tight text-(--ink) sm:text-3xl">
            No decision is due yet.
          </h3>
          {next ? <NextChargeLine next={next} className="mt-5" /> : null}
        </>
      )}
      <button type="button" onClick={onReview} className="btn btn-ghost mt-7">
        {customerPhrases.reviewResults}
      </button>
    </section>
  );
}

function CitedPictureActivation({
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
  return null;
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

function NextChargeLine({ next, className = "" }: { next: QuietNextChargeDto; className?: string }) {
  return (
    <p className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 ${className}`}>
      <span className="font-data text-xs text-(--muted)">Next</span>
      <span className="font-display text-base font-semibold text-(--ink)">{next.merchant}</span>
      <MoneyValue amount={next.amount} className="text-sm text-(--ink-soft)" />
      <span className="font-data text-xs text-(--muted)">{formatDay(next.date)}</span>
    </p>
  );
}

function DecisionQueue({
  home,
  pendingDecisionId,
  lastHook,
  onDecide,
  onSaveContext,
  onOpenCommitment,
  onReminderConsent,
}: {
  home: HomeProjectionDto;
  pendingDecisionId?: string | null;
  lastHook: { title: string; body: string; artefact: string } | null;
  onDecide: (request: PutDecisionRequest) => void;
  onSaveContext: (commitmentId: string, request: PutCommitmentContextRequest) => void;
  onOpenCommitment: (commitmentId: string) => void;
  onReminderConsent?: () => void;
}) {
  const queue = home.decisionQueue;
  const next = home.nextQuietCharge;
  const comingUp = shouldShowComingUp(home);
  const watching = home.decisionOutcomes.some((outcome) => outcome.kind === "WATCHING") || lastHook !== null;
  if (!queue.length) {
    return (
      <section aria-labelledby="recovery-decisions">
        {lastHook ? <DecisionHook hook={lastHook} onReminderConsent={onReminderConsent} /> : null}
        <h3 id="recovery-decisions" className="font-display text-2xl font-semibold tracking-tight text-(--ink)">
          {watching ? customerPhrases.watchingHomeTitle : customerPhrases.quietHomeTitle}
        </h3>
        <p className="mt-2 text-sm leading-6 text-(--muted)">
          {watching
            ? customerPhrases.watchingHomeBody
            : comingUp || next ? customerPhrases.quietHomeBody : customerPhrases.quietHomeNothingExpected}
        </p>
        {next && !comingUp ? <NextChargeLine next={next} className="mt-4" /> : null}
      </section>
    );
  }
  return (
    <section aria-labelledby="recovery-decisions" className="stack-section">
      {lastHook ? <DecisionHook hook={lastHook} onReminderConsent={onReminderConsent} /> : null}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <SectionHeading id="recovery-decisions">Decisions due soon</SectionHeading>
        {queue.length > 1 ? (
          <p className="font-data text-xs text-(--muted)">{`${queue.length.toLocaleString("en-IN")} charges are close`}</p>
        ) : null}
      </div>
      <div className="grid gap-3">
        {queue.map((card, index) => (
          <DecisionCard
            key={card.commitmentId}
            card={card}
            prominent={index === 0}
            pending={pendingDecisionId === card.commitmentId}
            onDecide={onDecide}
            onSaveContext={onSaveContext}
            onOpenCommitment={onOpenCommitment}
          />
        ))}
      </div>
      <p className="text-xs leading-5 text-(--muted)">{customerPhrases.decisionBoundary}</p>
    </section>
  );
}

const reviewSnoozes = ["TOMORROW", "THREE_DAYS_BEFORE", "ONE_DAY_BEFORE"] as const satisfies readonly DecisionReviewSnooze[];

function DecisionCard({
  card,
  prominent,
  pending,
  onDecide,
  onSaveContext,
  onOpenCommitment,
}: {
  card: DecisionCardDto;
  prominent: boolean;
  pending: boolean;
  onDecide: (request: PutDecisionRequest) => void;
  onSaveContext: (commitmentId: string, request: PutCommitmentContextRequest) => void;
  onOpenCommitment: (commitmentId: string) => void;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewPanelId = useId();
  const purposeId = useId();
  const keepPrimary = keepIsPrimary(card.reasonKeys);
  const sentence = card.sentence?.trim() || `${card.merchant} charges ${card.charge.display}.`;
  const quote = card.excerpt?.trim() || null;
  return (
    <article className="decision" data-lead={prominent}>
      <div className="min-w-0">
        <p className="decision-cue">{card.headline}</p>
        <h4 className="decision-sentence">{sentence}</h4>
      </div>

      {quote ? (
        <div className="decision-evidence">
          <p className="eyebrow eyebrow-xs">{customerPhrases.citedEvidence}</p>
          <blockquote className="decision-quote">“{quote}”</blockquote>
          <button type="button" onClick={() => onOpenCommitment(card.commitmentId)} className="link-quiet mt-1">
            {customerPhrases.seeCitedReceipt}
          </button>
        </div>
      ) : (
        <div className="decision-evidence">
          <button type="button" onClick={() => onOpenCommitment(card.commitmentId)} className="link-quiet">
            {customerPhrases.seeCitedReceipt}
          </button>
        </div>
      )}

      {card.reasons.length ? (
        <div>
          <p className="eyebrow eyebrow-xs">{customerPhrases.whyThisNeedsAttention}</p>
          <ul className="reason-list mt-2">
            {card.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {card.askPurpose ? (
        <div className="sm:max-w-xs">
          <label htmlFor={purposeId} className="field-label">What is this for?</label>
          <select
            id={purposeId}
            className="field"
            defaultValue=""
            disabled={pending}
            onChange={(event) => {
              const value = event.target.value;
              if (commitmentPurposes.includes(value as (typeof commitmentPurposes)[number])) {
                onSaveContext(card.commitmentId, { purpose: value as (typeof commitmentPurposes)[number] });
              }
            }}
          >
            <option value="" disabled>Choose a purpose</option>
            {commitmentPurposes.map((value) => (
              <option key={value} value={value}>{purposeLabels[value]}</option>
            ))}
          </select>
        </div>
      ) : null}

      <div>
        <div className="decision-actions">
          <div role="group" aria-label="Your choice" className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => onDecide({ commitmentId: card.commitmentId, decision: "KEEP", action: "KEEP" })}
              className={`btn btn-sm ${keepPrimary ? "btn-primary" : "btn-ghost"}`}
            >
              Keep
            </button>
            <button
              type="button"
              disabled={pending}
              aria-expanded={reviewOpen}
              aria-controls={reviewPanelId}
              onClick={() => setReviewOpen((open) => !open)}
              className={`btn btn-sm ${keepPrimary ? "btn-ghost" : "btn-primary"}`}
            >
              Review later
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => onDecide({ commitmentId: card.commitmentId, decision: "CANCEL", action: "PLAN_TO_CANCEL" })}
              className="btn btn-sm btn-quiet-danger"
            >
              Plan to cancel
            </button>
          </div>
        </div>
        <div id={reviewPanelId} hidden={!reviewOpen}>
          {reviewOpen ? (
            <div className="settle mt-3 flex flex-wrap items-center gap-2">
              <span className="font-data text-xs text-(--muted)">{customerPhrases.reviewWhen}</span>
              {reviewSnoozes.map((snooze) => (
                <button
                  key={snooze}
                  type="button"
                  disabled={pending}
                  onClick={() => onDecide({
                    commitmentId: card.commitmentId,
                    decision: "MONITOR",
                    action: "REVIEW_LATER",
                    reviewSnooze: snooze,
                  })}
                  className="btn btn-sm btn-ghost"
                >
                  {decisionReviewSnoozeLabels[snooze]}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function DecisionOutcomes({
  home,
  onOpenCommitment,
}: {
  home: HomeProjectionDto;
  onOpenCommitment: (commitmentId: string) => void;
}) {
  if (!home.decisionOutcomes.length) return null;
  return (
    <section aria-labelledby="recovery-outcomes" className="stack-section">
      <SectionHeading id="recovery-outcomes">What happened</SectionHeading>
      <ul className="grid gap-2">
        {home.decisionOutcomes.map((outcome) => (
          <OutcomeCard key={`${outcome.commitmentId}-${outcome.kind}-${outcome.date ?? "none"}`} outcome={outcome} onOpenCommitment={onOpenCommitment} />
        ))}
      </ul>
    </section>
  );
}

function OutcomeCard({
  outcome,
  onOpenCommitment,
}: {
  outcome: DecisionOutcomeDto;
  onOpenCommitment: (commitmentId: string) => void;
}) {
  const tone = decisionOutcomeTone(outcome.kind);
  // The workspace names the merchant inside the headline only when the charge
  // contradicts a recorded intent. Every other row would be anonymous without this.
  const headlineNamesMerchant = outcome.headline.startsWith(outcome.merchant);
  return (
    <li className={`outcome outcome-${tone}`}>
      {headlineNamesMerchant ? null : (
        <p className="font-display text-sm font-semibold text-(--ink-soft)">{outcome.merchant}</p>
      )}
      <p className="outcome-title">{outcome.headline}</p>
      <p className="text-sm leading-6 text-(--muted)">{outcome.detail}</p>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {outcome.amount ? <MoneyValue amount={outcome.amount} className="text-sm text-(--ink)" /> : null}
        {outcome.date ? <span className="font-data text-xs text-(--muted)">{formatDay(outcome.date)}</span> : null}
        <button type="button" onClick={() => onOpenCommitment(outcome.commitmentId)} className="link-quiet">
          {customerPhrases.seeWhy}
        </button>
      </p>
    </li>
  );
}

function ComingLater({
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
    <section aria-labelledby="recovery-next" className="stack-section">
      <SectionHeading id="recovery-next">Coming later</SectionHeading>
      <ul className="ledger-list grid">
        {home.next.map((item) => (
          <UpcomingRow key={`${item.commitmentId}-${item.date}`} item={item} onOpenCommitment={onOpenCommitment} />
        ))}
      </ul>
      <div>
        <button type="button" onClick={onSeeAllCommitments} className="btn btn-sm btn-ghost">
          {customerPhrases.seeAllCommitments}
        </button>
      </div>
    </section>
  );
}

function DecisionHook({
  hook,
  onReminderConsent,
}: {
  hook: { title: string; body: string; artefact: string };
  onReminderConsent?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [reminderOn, setReminderOn] = useState(false);
  async function copyArtefact() {
    try {
      await navigator.clipboard.writeText(hook.artefact);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <aside className="decision-hook mb-6" aria-live="polite">
      <h3 className="decision-hook-title">{hook.title}</h3>
      <p className="mt-2 text-base leading-7 text-(--ink-soft)">{hook.body}</p>
      <p className="mt-2 text-xs leading-5 text-(--muted)">{customerPhrases.rememberedThisCycle}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void copyArtefact()}>
          {copied ? customerPhrases.copiedForCofounder : customerPhrases.copyForCofounder}
        </button>
        <label className="flex items-center gap-2 text-sm leading-6 text-(--ink-soft)">
          <input
            type="checkbox"
            checked={reminderOn}
            onChange={(event) => {
              setReminderOn(event.target.checked);
              if (event.target.checked) onReminderConsent?.();
            }}
          />
          {reminderOffer}
        </label>
      </div>
    </aside>
  );
}

function PaymentAsk({ onAnswer }: { onAnswer: (answer: "yes" | "no") => void }) {
  return (
    <section className="stack-section" aria-labelledby="payment-ask">
      <h3 id="payment-ask" className="font-display text-lg font-semibold tracking-tight text-(--ink)">
        {paymentAskQuestion}
      </h3>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => onAnswer("yes")}>Yes</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onAnswer("no")}>Not yet</button>
      </div>
    </section>
  );
}

function UpcomingRow({ item, onOpenCommitment }: { item: UpcomingItemDto; onOpenCommitment: (commitmentId: string) => void }) {
  return (
    <li>
      <button type="button" onClick={() => onOpenCommitment(item.commitmentId)} className="ledger-line ledger-row px-2">
        <span className="ledger-name">{item.merchant}</span>
        <span className="ledger-meta">
          <MoneyValue amount={item.amount} className="text-(--ink-soft)" />
          <span className="ledger-date font-data text-xs">{formatDay(item.date)}</span>
        </span>
      </button>
    </li>
  );
}

function RecentChange({
  items,
  onOpenCommitment,
}: {
  items: readonly import("@/lib/recovery/contracts").ChangeItemDto[];
  onOpenCommitment: (commitmentId: string) => void;
}) {
  return (
    <section aria-labelledby="recovery-changed" className="stack-section">
      <SectionHeading id="recovery-changed">Recent change</SectionHeading>
      <ul className="ledger-list grid">
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => onOpenCommitment(item.commitmentId)} className="ledger-line ledger-row px-2">
              <span className="ledger-name">{item.merchant}</span>
              <span className="ledger-meta">{changeKindLabels[item.kind]}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
