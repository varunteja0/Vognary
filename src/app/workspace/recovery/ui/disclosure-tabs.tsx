"use client";

import type { ReactNode } from "react";

export function DisclosureTabs<T extends string>({
  tabs,
  active,
  onChange,
  labelledBy,
}: {
  tabs: readonly { id: T; label: string; panel: ReactNode }[];
  active: T;
  onChange: (id: T) => void;
  labelledBy?: string;
}) {
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  return (
    <div>
      <div role="tablist" aria-labelledby={labelledBy} className="flex flex-wrap gap-2 border-b border-line pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === current.id}
            id={`recovery-tab-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={`btn btn-sm ${tab.id === current.id ? "btn-primary" : "btn-ghost"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-labelledby={`recovery-tab-${current.id}`} className="pt-5">
        {current.panel}
      </div>
    </div>
  );
}
