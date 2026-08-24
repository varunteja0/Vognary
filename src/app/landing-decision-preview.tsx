"use client";

import { useState } from "react";
import type { DecisionCycleAction } from "@/lib/recovery/contracts";
import { decisionHookCopy } from "@/lib/recovery/wow-first-session";

const actions = [
  { value: "KEEP", label: "Keep" },
  { value: "REVIEW_LATER", label: "Review later" },
  { value: "PLAN_TO_CANCEL", label: "Plan to cancel" },
] as const satisfies readonly { value: DecisionCycleAction; label: string }[];

const actionPresentation: Record<DecisionCycleAction, {
  label: string;
  tone: "keep" | "watch" | "cancel";
  nextCheck: string;
}> = {
  KEEP: {
    label: "Keep this cycle",
    tone: "keep",
    nextCheck: "The next matching receipt is checked against ₹1,700.00 and this cycle's Keep decision.",
  },
  REVIEW_LATER: {
    label: "Review before charge",
    tone: "watch",
    nextCheck: "Vognary brings this back before 28 September. It records no cancellation.",
  },
  PLAN_TO_CANCEL: {
    label: "Plan to cancel",
    tone: "cancel",
    nextCheck: "If another Cursor receipt arrives, Vognary surfaces it. No receipt means Unknown, not cancelled.",
  },
};

export function LandingDecisionPreview() {
  const [action, setAction] = useState<DecisionCycleAction>("PLAN_TO_CANCEL");
  const presentation = actionPresentation[action];
  const hook = decisionHookCopy({
    merchant: "Cursor Pro",
    action,
    watchDate: "28 Sept 2026",
  });

  return (
    <section aria-labelledby="product-review-heading" className="border-b border-line py-10 sm:py-16">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="max-w-2xl">
          <p className="eyebrow eyebrow-xs text-ochre">One bill becomes a decision</p>
          <h2 id="product-review-heading" className="mt-3 font-display text-3xl font-semibold tracking-tight text-(--ink) sm:text-4xl">
            See Vognary do the work.
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-(--muted)">
            Receipt evidence, one founder decision, then a clear record of what to verify next.
          </p>
        </div>
        <p className="font-data text-xs text-(--muted)">Evidence → Decision → Verification</p>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)] lg:gap-12">
        <article className="decision" data-lead="true">
          <div className="min-w-0">
            <p className="decision-cue">Decision due before 28 Aug</p>
            <h3 className="decision-sentence mt-2">Cursor Pro charges ₹1,700.00 on 28 Aug.</h3>
          </div>

          <div className="decision-evidence">
            <p className="eyebrow eyebrow-xs">From the example receipt</p>
            <blockquote className="decision-quote">“Cursor Pro · Paid ₹1,700.00 · 28 Aug 2026”</blockquote>
          </div>

          <div>
            <p className="eyebrow eyebrow-xs">Why a decision is needed now</p>
            <ul className="reason-list mt-2">
              <li>Another AI coding tool also appears in these example bills.</li>
              <li>Overlap asks for your judgment. It never becomes a cancellation recommendation.</li>
            </ul>
          </div>

          <div className="decision-actions">
            <div role="group" aria-label="Choose the example decision" className="flex flex-wrap items-center gap-2">
              {actions.map((item) => {
                const selected = action === item.value;
                const selectedClass = item.value === "PLAN_TO_CANCEL" ? "btn-ember" : "btn-primary";
                const idleClass = item.value === "PLAN_TO_CANCEL" ? "btn-quiet-danger" : "btn-ghost";
                return (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setAction(item.value)}
                    className={`btn btn-sm ${selected ? selectedClass : idleClass}`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </article>

        <aside className="flex min-w-0 flex-col justify-between border-l border-line pl-5 sm:pl-8" aria-live="polite">
          <div>
            <p className="eyebrow eyebrow-xs">After the decision</p>
            <p className={`stamp stamp-${presentation.tone} mt-4`}>{presentation.label}</p>
            <h3 className="mt-5 font-display text-2xl font-semibold leading-tight text-(--ink)">{hook.title}</h3>
            <p className="mt-3 text-sm leading-6 text-(--ink-soft)">{hook.body}</p>
          </div>
          <div className="mt-5 border-t border-line pt-4">
            <p className="eyebrow eyebrow-xs">What Vognary checks next</p>
            <p className="mt-2 text-sm leading-6 text-(--ink-soft)">{presentation.nextCheck}</p>
          </div>
        </aside>
      </div>

      <p className="mt-5 text-xs leading-5 text-(--muted)">
        Illustrative walkthrough, not a claim about your company. Your review is built from evidence you add. Unknown stays unknown.
      </p>
    </section>
  );
}