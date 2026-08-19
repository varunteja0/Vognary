"use client";

import type { ReactNode } from "react";

export function WizardProgress({ step, total, label }: { step: number; total: number; label: string }) {
  return (
    <p className="font-data text-xs text-(--muted)">
      Step {step} of {total}
      <span className="sr-only">: {label}</span>
    </p>
  );
}

export function WizardFrame({
  step,
  total,
  title,
  children,
  actions,
}: {
  step: number;
  total: number;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section aria-labelledby="gmail-wizard-title" className="grid gap-4">
      <WizardProgress step={step} total={total} label={title} />
      <h3 id="gmail-wizard-title" className="font-display text-xl font-semibold text-(--ink)">{title}</h3>
      <div className="grid gap-3 text-sm leading-6 text-(--muted)">{children}</div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </section>
  );
}
