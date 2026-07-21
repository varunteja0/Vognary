"use client";

import type { ReactNode } from "react";

// Shared presentational primitives extracted from vognary-mvp-client.tsx as the
// first slice of the src/app/workspace/* decomposition. These are pure props →
// JSX with no local state; extracting them here shrinks the monolith and gives
// every future panel extraction a tokenised foundation to import. Inline colour /
// dimension literals were promoted to tokens in the move (dossier-fill,
// eyebrow-xs), burning down entries from the design-token map.

export function StageHeader({ id, folio, title, note }: { id: string; folio: string; title: string; note?: string }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <h2 id={id} className="folio shrink-0" data-folio={folio}>{title}</h2>
      <span className="hidden h-px flex-1 bg-line sm:block" aria-hidden />
      {note ? <p className="text-xs leading-5 text-(--muted) sm:max-w-sm sm:text-right">{note}</p> : null}
    </div>
  );
}

export function SectionHead({ folio, kicker, title, desc, right }: { folio: string; kicker: string; title: string; desc?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <span className="folio" data-folio={folio}>{kicker}</span>
        <h3 className="mt-2 font-display text-[1.22rem] font-semibold text-(--ink)">{title}</h3>
        {desc ? (
          <details className="mt-1 max-w-xl">
            <summary className="cursor-pointer select-none font-data text-[0.64rem] uppercase tracking-[0.12em] text-(--muted) transition hover:text-(--ink)">How this works</summary>
            <p className="mt-1 text-sm leading-6 text-(--muted)">{desc}</p>
          </details>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export function DetailStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="inset p-3">
      <p className="eyebrow eyebrow-xs">{label}</p>
      <p className="font-data mt-1.5 text-base font-semibold tnum text-(--ink)">{value}</p>
      {sub ? <p className="mt-0.5 font-data text-[0.6rem] text-(--muted)">{sub}</p> : null}
    </div>
  );
}

export function DossierStat({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  const content = (
    <>
      <p className="font-data text-[0.54rem] uppercase tracking-[0.18em] text-(--dossier-muted)">{label}</p>
      <p className="font-data mt-1.5 text-sm font-semibold tnum text-(--dossier-ink)">{value}</p>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="rounded-[9px] border border-(--dossier-line) bg-(--dossier-fill) px-3 py-2.5 text-left transition hover:border-(--gold)" aria-label={`${label}: ${value}. Open subscriptions`}>
        {content}
      </button>
    );
  }
  return <div className="rounded-[9px] border border-(--dossier-line) bg-(--dossier-fill) px-3 py-2.5">{content}</div>;
}

export function TickerStat({ label, value, tone, onClick }: { label: string; value: string; tone: "ember" | "ochre" | "paper"; onClick?: () => void }) {
  const toneClass = tone === "ember" ? "text-ember" : tone === "ochre" ? "text-ochre" : "text-(--dossier-ink)";
  return (
    <button type="button" onClick={onClick} className="flex items-baseline gap-2 text-left" aria-label={`${label}: ${value}. Open subscriptions`}>
      <span className="eyebrow eyebrow-xs muted-on-dark">{label}</span>
      <span className={`font-data text-sm font-medium tnum ${toneClass}`}>{value}</span>
    </button>
  );
}

export function TaskEmptyState({ sentence, actionLabel, onAction }: { sentence: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="inset mt-4 flex flex-col items-center gap-4 px-4 py-6 text-center">
      <p className="text-sm leading-6 text-(--muted)">{sentence}</p>
      <button type="button" onClick={onAction} className="btn btn-primary h-9 px-3 text-xs">{actionLabel}</button>
    </div>
  );
}

export function StatusRow({ label, value, state }: { label: string; value: string; state: "ready" | "partial" | "blocked" | "planned" }) {
  const pillClass = {
    ready: "pill pill-ready",
    partial: "pill pill-partial",
    blocked: "pill pill-blocked",
    planned: "pill pill-planned",
  }[state];

  return (
    <div className="inset flex items-center justify-between gap-3 px-3 py-2.5">
      <div>
        <p className="text-sm font-semibold text-(--ink)">{label}</p>
        <p className="text-xs leading-5 text-(--muted)">{value}</p>
      </div>
      <span className={`${pillClass} shrink-0`}>{state}</span>
    </div>
  );
}
