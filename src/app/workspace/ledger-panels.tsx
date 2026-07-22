"use client";

import { useState } from "react";
import type { AuditResult, RecommendationType, RecurringItem } from "@/lib/recurring-audit";
import { formatCurrency } from "./format";
import { SectionHead, statusStyles } from "./primitives";

// Ledger panels extracted verbatim from vognary-mvp-client.tsx (WP-B7). Both are
// pure props → JSX views over the deterministic audit result: RecurringGraph is
// the "your subscriptions" grid, PriorityActionPanel is the "what to review
// first" queue. They share the currency + stamp primitives, so moving them out
// of the monolith depends on those already living in ./format and ./primitives.

export function RecurringGraph({
  audit,
  selectedItem,
  userActions,
  categoryBudgets,
  onSelect,
}: {
  audit: AuditResult;
  selectedItem: RecurringItem | null;
  userActions: Record<string, RecommendationType>;
  categoryBudgets: Record<string, number>;
  onSelect: (id: string) => void;
}) {
  const [sortBy, setSortBy] = useState<"cost" | "renewal">("cost");
  const sortedItems = [...audit.recurringItems].sort((left, right) => {
    if (sortBy === "renewal") return left.nextExpectedDate.localeCompare(right.nextExpectedDate) || right.monthlyCost - left.monthlyCost;
    return right.monthlyCost - left.monthlyCost || left.nextExpectedDate.localeCompare(right.nextExpectedDate);
  });
  const categorySpend = audit.recurringItems.reduce<Record<string, number>>((totals, item) => {
    if (item.currency === audit.summary.primaryCurrency) totals[item.category] = (totals[item.category] ?? 0) + item.monthlyCost;
    return totals;
  }, {});

  return (
    <section id="recurring-ledger" className="panel scroll-mt-36 p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="folio" data-folio="2.1">Results</span>
          <h3 className="mt-2 font-display text-xl font-semibold text-(--ink)">Your subscriptions</h3>
          <p className="mt-1 text-sm text-(--muted)">{audit.summary.recurringCount} recurring payment{audit.summary.recurringCount === 1 ? "" : "s"}, each linked to proof.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-(--muted)">
          Sort
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value as "cost" | "renewal")} className="field h-10 w-auto py-0 text-xs" aria-label="Sort subscriptions">
            <option value="cost">Highest cost</option>
            <option value="renewal">Renews next</option>
          </select>
        </label>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2" aria-label="Subscriptions list">
        {sortedItems.map((item) => {
          const action = userActions[item.identityKey] ?? item.recommendationType;
          const selected = selectedItem?.identityKey === item.identityKey;
          const categoryOverBudget = Boolean(categoryBudgets[item.category]) && categorySpend[item.category] > categoryBudgets[item.category];
          return (
            <button
              key={item.identityKey}
              type="button"
              onClick={() => onSelect(item.identityKey)}
              aria-pressed={selected}
              className={`group min-h-36 rounded-2xl border p-4 text-left transition ${selected ? "border-(--gold-line) bg-(--gold-tint)" : categoryOverBudget ? "border-ochre bg-(--gold-tint)" : "border-line bg-(--card-2) hover:border-(--line-strong)"}`}
            >
              <span className="flex items-start gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-card font-display text-lg font-semibold text-(--ink)" aria-hidden>{item.merchant.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate font-display text-lg font-semibold text-(--ink)">{item.merchant}</span>
                      <span className="mt-0.5 block truncate text-xs text-(--muted)">{item.category} · <span className="capitalize">{item.frequency}</span></span>
                    </span>
                    <span className="font-data text-lg font-semibold tnum text-(--ink)">{formatCurrency(item.monthlyCost, item.currency)}<span className="text-[0.62rem] font-normal text-(--muted)">/mo</span></span>
                  </span>
                  <span className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="pill pill-partial">{item.confidenceScore}% proof</span>
                    <span className={statusStyles[action]}>{action}</span>
                    {categoryOverBudget ? <span className="pill pill-blocked">Category over budget</span> : null}
                    {item.priceChange?.direction === "increase" ? <span className="pill pill-blocked">↑ was {formatCurrency(item.priceChange.previousAmount, item.currency)}</span> : null}
                  </span>
                  <span className="mt-3 flex items-center justify-between gap-2 font-data text-[0.68rem] text-(--muted)">
                    <span>Renews {item.nextExpectedDate}</span>
                    <span className="text-(--ink-soft) transition group-hover:translate-x-0.5">View proof →</span>
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function PriorityActionPanel({
  priorityItems,
  userActions,
  onSelect,
}: {
  priorityItems: RecurringItem[];
  userActions: Record<string, RecommendationType>;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="panel p-5 sm:p-6">
      <SectionHead folio="2.4" kicker="Priority" title="What to review first" desc="Start with these before the next billing cycle." />
      <div className="mt-4 grid gap-2">
        {priorityItems.length ? priorityItems.map((item) => {
          const action = userActions[item.identityKey] ?? item.recommendationType;
          return (
            <button key={item.identityKey} type="button" onClick={() => onSelect(item.identityKey)} className="inset w-full p-3 text-left transition hover:border-ember">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-(--ink)">{item.merchant}</p>
                  <p className="mt-0.5 font-data text-xs leading-5 text-(--muted)">{formatCurrency(item.monthlyCost, item.currency)}/mo · renews {item.nextExpectedDate} · {item.confidenceScore}%</p>
                </div>
                <span className={statusStyles[action]}>{action}</span>
              </div>
            </button>
          );
        }) : <p className="inset px-3 py-3 text-sm text-(--muted)">Connect a proof source to generate an action plan.</p>}
      </div>
    </section>
  );
}
