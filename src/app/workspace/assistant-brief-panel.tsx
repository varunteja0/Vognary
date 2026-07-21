"use client";

import { useMemo } from "react";
import { formatMoney, formatShortDate } from "@/lib/format";
import { primaryCurrency, type RecommendationType, type RecurringItem } from "@/lib/recurring-audit";
import { buildAssistantBrief, type BriefAnomaly, type BriefRenewal, type BriefSaving } from "@/lib/assistant-brief";

// The assistant brief, rendered — the lead answer to "what needs my attention?".
// It computes from the in-memory audit the client already holds (no round-trip),
// using the exact same pure engine the headless /brief endpoint uses, so what a
// person reads here and what a digest email sends can never disagree.
//
// This is the first component of the src/app/workspace/* decomposition: a small,
// fully-tokenised, self-contained panel that takes proven items in and renders
// prose out — no design literals, no data fetching, no monolith coupling.
export function AssistantBriefPanel({
  items,
  actions,
  onSelect,
}: {
  items: RecurringItem[];
  actions?: Record<string, RecommendationType>;
  onSelect?: (itemId: string) => void;
}) {
  const brief = useMemo(() => buildAssistantBrief({ recurringItems: items, actions }), [items, actions]);
  const hasSavings = brief.savings.length > 0;
  const hasRenewals = brief.renewals.next.length > 0;
  const hasAnomalies = brief.anomalies.length > 0;

  return (
    <section aria-label="Your brief" className="rounded-2xl border border-(--gold-line) bg-(--dossier-fill) p-5 sm:p-7">
      <p className="font-data text-[0.64rem] uppercase tracking-[0.16em] text-gold">Your brief</p>
      <h2 className="mt-2 font-display text-xl leading-snug text-(--ink) sm:text-2xl">{brief.headline.text}</h2>

      {hasSavings || hasRenewals || hasAnomalies ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {hasSavings ? (
            <BriefColumn
              title="Money you can free up"
              caption={brief.monthlySavings > 0 ? `${formatMoney(brief.monthlySavings, primaryCurrency)}/mo if you act on all of these` : "Foreign-currency commitments, kept separate"}
            >
              {brief.savings.map((saving) => (
                <SavingRow key={saving.itemId} saving={saving} onSelect={onSelect} />
              ))}
            </BriefColumn>
          ) : null}

          {hasRenewals ? (
            <BriefColumn
              title="Renews soon"
              caption={`${formatMoney(brief.renewals.dueNext7Days, primaryCurrency)} in the next 7 days`}
            >
              {brief.renewals.next.map((renewal) => (
                <RenewalRow key={`${renewal.itemId}-${renewal.date}`} renewal={renewal} onSelect={onSelect} />
              ))}
            </BriefColumn>
          ) : null}

          {hasAnomalies ? (
            <BriefColumn title="Changed under you" caption="Grounded in your own charge history">
              {brief.anomalies.map((anomaly) => (
                <AnomalyRow key={`${anomaly.itemId}-${anomaly.kind}`} anomaly={anomaly} onSelect={onSelect} />
              ))}
            </BriefColumn>
          ) : null}
        </div>
      ) : null}

      <p className="mt-5 text-xs leading-5 text-(--muted)">
        Every rupee figure is computed from your proven evidence; foreign charges stay in their own currency and are
        never folded into a ₹ total.
      </p>
    </section>
  );
}

function BriefColumn({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <p className="field-label">{title}</p>
      <p className="mt-1 font-data text-[0.66rem] text-(--muted)">{caption}</p>
      <ul className="mt-3 grid gap-2">{children}</ul>
    </div>
  );
}

function SavingRow({ saving, onSelect }: { saving: BriefSaving; onSelect?: (itemId: string) => void }) {
  return (
    <li>
      <RowButton onSelect={onSelect} itemId={saving.itemId}>
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate font-medium text-(--ink)">{saving.merchant}</span>
          <span className="shrink-0 font-data text-(--ink-soft)">{formatMoney(saving.monthlyCost, saving.currency)}/mo</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <ActionChip action={saving.action} />
          <span className="truncate text-[0.7rem] text-(--muted)">{saving.category}</span>
        </div>
      </RowButton>
    </li>
  );
}

function RenewalRow({ renewal, onSelect }: { renewal: BriefRenewal; onSelect?: (itemId: string) => void }) {
  return (
    <li>
      <RowButton onSelect={onSelect} itemId={renewal.itemId}>
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate font-medium text-(--ink)">{renewal.merchant}</span>
          <span className="shrink-0 font-data text-(--ink-soft)">{formatMoney(renewal.amount, renewal.currency)}</span>
        </div>
        <p className="mt-1 text-[0.7rem] text-(--muted)">{renewIn(renewal.daysAway)} · {formatShortDate(renewal.date)}</p>
      </RowButton>
    </li>
  );
}

function AnomalyRow({ anomaly, onSelect }: { anomaly: BriefAnomaly; onSelect?: (itemId: string) => void }) {
  return (
    <li>
      <RowButton onSelect={onSelect} itemId={anomaly.itemId}>
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate font-medium text-(--ink)">{anomaly.merchant}</span>
          {anomaly.changePercent !== null ? (
            <span className="shrink-0 font-data text-ochre">+{anomaly.changePercent}%</span>
          ) : (
            <span className="shrink-0 text-[0.7rem] text-(--muted)">needs a source</span>
          )}
        </div>
        <p className="mt-1 text-[0.7rem] leading-4 text-(--muted)">{anomaly.detail}</p>
      </RowButton>
    </li>
  );
}

// A row is a deep-link into the commitment when the host wired onSelect; a plain
// block otherwise. Keeping the interactivity optional is what lets this panel be
// reused headlessly (tests, snapshots) without a click handler in scope.
function RowButton({ itemId, onSelect, children }: { itemId: string; onSelect?: (itemId: string) => void; children: React.ReactNode }) {
  if (!onSelect) return <div className="text-sm leading-5">{children}</div>;
  return (
    <button type="button" onClick={() => onSelect(itemId)} className="w-full rounded-lg text-left text-sm leading-5 transition hover:text-(--gold-soft)">
      {children}
    </button>
  );
}

function ActionChip({ action }: { action: "cancel" | "downgrade" }) {
  const label = action === "cancel" ? "Cancel" : "Downgrade";
  return (
    <span className="rounded-full border border-(--gold-line) px-2 py-0.5 font-data text-[0.6rem] uppercase tracking-[0.12em] text-gold">
      {label}
    </span>
  );
}

function renewIn(daysAway: number): string {
  if (daysAway <= 0) return "today";
  if (daysAway === 1) return "tomorrow";
  return `in ${daysAway} days`;
}
