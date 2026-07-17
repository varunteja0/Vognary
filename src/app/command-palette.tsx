"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Universal search — the ⌘K palette.
 *
 * One field that reaches everything: workspace sections, ledger items,
 * actions, sources, and site pages. Callers supply the items; the palette
 * owns matching, keyboard flow, and the global shortcut.
 */

export type PaletteItem = {
  id: string;
  /** Group header the item renders under, e.g. "Ledger" or "Actions". */
  group: string;
  label: string;
  /** Right-aligned hint: an amount, a status, a shortcut. */
  hint?: string;
  /** Extra text the query can match that is not displayed. */
  keywords?: string;
  run: () => void;
};

const GROUP_ORDER = ["Go to", "Ledger", "Actions", "Sources", "Pages"];

export function CommandPalette({
  open,
  onOpenChange,
  items,
  placeholder = "Search your ledger, sources, actions…",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PaletteItem[];
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      } else if (event.key === "Escape" && open) {
        onOpenChange(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) {
      queueMicrotask(() => {
        setQuery("");
        setCursor(0);
      });
      const timer = window.setTimeout(() => inputRef.current?.focus(), 10);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  const results = useMemo(() => rankItems(items, query), [items, query]);

  useEffect(() => {
    const active = listRef.current?.querySelector('[data-active="true"]');
    active?.scrollIntoView({ block: "nearest" });
  }, [cursor, results]);

  if (!open) return null;

  const grouped = groupResults(results);
  const flat = grouped.flatMap(({ items: groupItems }) => groupItems);

  function runItem(item: PaletteItem) {
    onOpenChange(false);
    item.run();
  }

  return (
    <div
      className="fixed inset-0 z-70 bg-black/55 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Universal search"
        className="mx-auto mt-[10vh] w-[min(92vw,38rem)] overflow-hidden rounded-2xl border border-(--line-strong) bg-card shadow-[0_32px_90px_-20px_rgba(0,0,0,0.9)]"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <SearchGlyph />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setCursor((current) => Math.min(current + 1, flat.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setCursor((current) => Math.max(current - 1, 0));
              } else if (event.key === "Enter" && flat[cursor]) {
                event.preventDefault();
                runItem(flat[cursor]);
              }
            }}
            placeholder={placeholder}
            aria-label="Universal search"
            className="h-12 w-full bg-transparent text-[0.95rem] text-(--ink) outline-none placeholder:text-(--muted)"
          />
          <kbd className="hidden shrink-0 rounded-md border border-line bg-(--card-2) px-1.5 py-0.5 font-data text-[0.6rem] text-(--muted) sm:block">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-2">
          {flat.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-(--muted)">
              Nothing matches &ldquo;{query}&rdquo;. Try a merchant, a section, or an action like &ldquo;export&rdquo;.
            </p>
          ) : (
            grouped.map(({ group, items: groupItems }) => (
              <div key={group} className="mb-1">
                <p className="px-3 pb-1 pt-2 font-data text-[0.6rem] uppercase tracking-[0.16em] text-(--muted)">{group}</p>
                {groupItems.map((item) => {
                  const index = flat.indexOf(item);
                  const active = index === cursor;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-active={active ? "true" : undefined}
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => runItem(item)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                        active ? "bg-(--gold) text-[#17130a]" : "text-(--ink-soft) hover:bg-white/5"
                      }`}
                    >
                      <span className="truncate">{item.label}</span>
                      {item.hint ? (
                        <span className={`shrink-0 font-data text-xs tnum ${active ? "opacity-75" : "text-(--muted)"}`}>{item.hint}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center gap-4 border-t border-line px-4 py-2 font-data text-[0.6rem] text-(--muted)">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span className="ml-auto">Vognary universal search</span>
        </div>
      </div>
    </div>
  );
}

/** Compact trigger for headers and rails. */
export function SearchTrigger({ onOpen, className }: { onOpen: () => void; className?: string }) {
  const [mac, setMac] = useState(true);
  useEffect(() => {
    queueMicrotask(() => setMac(/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)));
  }, []);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex items-center gap-2 rounded-xl border border-line bg-(--card-2) px-3 py-2 text-sm text-(--muted) transition hover:border-(--line-strong) hover:text-(--ink) ${className ?? ""}`}
      aria-label="Open universal search"
    >
      <SearchGlyph />
      <span className="truncate">Search</span>
      <kbd className="ml-auto rounded-md border border-line bg-(--paper) px-1.5 py-0.5 font-data text-[0.6rem]">{mac ? "⌘K" : "Ctrl K"}</kbd>
    </button>
  );
}

function SearchGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden className="shrink-0 text-(--muted)">
      <circle cx="6.5" cy="6.5" r="4.75" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5 13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function rankItems(items: PaletteItem[], query: string): PaletteItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items.filter((item) => item.group === "Go to" || item.group === "Actions").slice(0, 12);

  const scored = items
    .map((item) => {
      const label = item.label.toLowerCase();
      const keywords = item.keywords?.toLowerCase() ?? "";
      let score = 0;
      if (label.startsWith(needle)) score = 4;
      else if (label.split(/\s+/).some((word) => word.startsWith(needle))) score = 3;
      else if (label.includes(needle)) score = 2;
      else if (keywords.includes(needle)) score = 1;
      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, 24).map(({ item }) => item);
}

function groupResults(results: PaletteItem[]) {
  const byGroup = new Map<string, PaletteItem[]>();
  for (const item of results) {
    const bucket = byGroup.get(item.group) ?? [];
    bucket.push(item);
    byGroup.set(item.group, bucket);
  }
  return [...byGroup.entries()]
    .sort(([left], [right]) => {
      const li = GROUP_ORDER.indexOf(left);
      const ri = GROUP_ORDER.indexOf(right);
      return (li === -1 ? 99 : li) - (ri === -1 ? 99 : ri);
    })
    .map(([group, groupItems]) => ({ group, items: groupItems }));
}
