"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { RenewalTimeline } from "@/lib/renewal-timeline";
import { VognaryMark } from "./brand";
import { Nakul } from "./character";
import { SearchTrigger } from "./command-palette";

/**
 * The workspace rail — persistent left sidebar on desktop.
 *
 * Gives the workspace the structure of a real financial console: chapters
 * with live counts, universal search on top, and Nakul keeping watch at the
 * bottom with an honest status line.
 */

export type RailSection = {
  id: string;
  folio: string;
  label: string;
};

export function WorkspaceSidebar({
  sections,
  moreSections = [],
  activeId,
  counts,
  watching,
  signedIn,
  onNavigate,
  onOpenSearch,
}: {
  sections: readonly RailSection[];
  moreSections?: readonly RailSection[];
  activeId: string;
  counts: Partial<Record<string, number>>;
  watching: number;
  signedIn: boolean;
  onNavigate: (id: string) => void;
  onOpenSearch: () => void;
}) {
  return (
    <aside
      aria-label="Workspace navigation"
      className="fixed inset-y-0 left-0 z-40 hidden w-[236px] flex-col border-r border-line bg-(--paper-2)/85 px-4 pb-4 pt-5 backdrop-blur lg:flex"
    >
      <Link href="/" className="flex items-center gap-2.5 px-1">
        <VognaryMark size={26} className="text-(--ink)" />
        <span className="font-display text-[1.15rem] font-semibold tracking-tight text-(--ink)">Vognary</span>
      </Link>

      <SearchTrigger onOpen={onOpenSearch} className="mt-5 w-full" />

      <nav aria-label="Workspace sections" className="mt-5 grid gap-1">
        {sections.map((section) => {
          const active = activeId === section.id;
          const count = counts[section.id];
          return (
            <a
              key={section.id}
              href={`#${section.id}`}
              aria-current={active ? "true" : undefined}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(section.id);
              }}
              className={`group flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
                active ? "bg-(--gold) text-(--ink-on-gold)" : "text-(--ink-soft) hover:bg-white/5 hover:text-(--ink)"
              }`}
            >
              <span className={`font-data text-[0.6rem] tnum ${active ? "opacity-70" : "text-(--muted)"}`}>{section.folio}</span>
              <span className="truncate">{section.label}</span>
              {typeof count === "number" && count > 0 ? (
                <span
                  className={`ml-auto rounded-md px-1.5 py-0.5 font-data text-[0.62rem] tnum ${
                    active ? "bg-black/15" : "bg-white/6 text-(--muted)"
                  }`}
                >
                  {count}
                </span>
              ) : null}
            </a>
          );
        })}
        {moreSections.length ? (
          <details className="group mt-1">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-(--ink-soft) transition hover:bg-white/5 hover:text-(--ink)">
              <span className="font-data text-[0.6rem] text-(--muted)">•••</span>
              <span>More</span>
              <span className="ml-auto text-(--muted) transition group-open:rotate-180" aria-hidden>⌄</span>
            </summary>
            <div className="mt-1 grid gap-1 pl-3">
              {moreSections.map((section) => {
                const active = activeId === section.id;
                const count = counts[section.id];
                return (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    aria-current={active ? "true" : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      onNavigate(section.id);
                    }}
                    className={`flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
                      active ? "bg-(--gold) text-(--ink-on-gold)" : "text-(--ink-soft) hover:bg-white/5 hover:text-(--ink)"
                    }`}
                  >
                    <span className={`font-data text-[0.6rem] tnum ${active ? "opacity-70" : "text-(--muted)"}`}>{section.folio}</span>
                    <span className="truncate">{section.label}</span>
                    {typeof count === "number" && count > 0 ? <span className="ml-auto font-data text-[0.62rem] tnum">{count}</span> : null}
                  </a>
                );
              })}
            </div>
          </details>
        ) : null}
      </nav>

      <div className="mt-auto grid gap-3">
        <div className="rounded-2xl border border-line bg-(--card-2) p-3">
          <div className="flex items-end gap-2">
            <Nakul pose={watching > 0 ? "sentinel" : "rest"} size={52} className="shrink-0 text-(--ink)" title="Nakul, the ledger mongoose" />
            <div className="min-w-0 pb-1">
              <p className="text-[0.8rem] font-medium leading-4 text-(--ink)">
                {watching > 0 ? `Watching ${watching} commitment${watching === 1 ? "" : "s"}` : "No ledger yet"}
              </p>
              <p className="mt-1 text-[0.68rem] leading-3.5 text-(--muted)">
                {watching > 0 ? "Nakul flags every renewal before it charges." : "Paste receipts to prove what renews — rails are optional."}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between px-1 font-data text-[0.62rem] text-(--muted)">
          <Link href="/guide" className="transition hover:text-(--ink)">Guide</Link>
          <Link href="/sources" className="transition hover:text-(--ink)">Sources</Link>
          <Link href="/profile" className="transition hover:text-(--ink)">{signedIn ? "Profile" : "Sign in"}</Link>
        </div>
      </div>
    </aside>
  );
}

/**
 * Live next-debit ticker. The dashboard heartbeat: names the next charge and
 * counts down to it in real time, so the workspace visibly stays alive.
 */
export function NextDebitTicker({ timeline }: { timeline: RenewalTimeline }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const next = timeline.events[0];
  if (!next) return null;

  const target = new Date(`${next.date}T00:00:00`);
  const remaining = target.getTime() - now;

  return (
    <p className="flex min-w-0 items-baseline gap-2" aria-live="off">
      <span className="eyebrow eyebrow-xs shrink-0">Next debit</span>
      <span className="truncate text-sm font-medium text-(--ink)">{next.merchant}</span>
      <span className="shrink-0 font-data text-sm tnum text-(--gold)">
        {new Intl.NumberFormat("en-IN", { style: "currency", currency: next.currency, maximumFractionDigits: 0 }).format(next.amount)}
      </span>
      <span className="shrink-0 font-data text-xs tnum text-(--ink-soft)">{formatCountdown(remaining)}</span>
    </p>
  );
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "due today";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `in ${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
  if (hours > 0) return `in ${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  return `in ${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
