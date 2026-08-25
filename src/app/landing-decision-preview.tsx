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
    nextCheck: "The next Cursor receipt is checked against ₹1,700 and this Keep decision.",
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
    <section id="example-decision" aria-labelledby="product-review-heading" className="min-w-0">
      <h2 className="eyebrow text-ochre">A real decision, not a dashboard</h2>
      <h3 id="product-review-heading" className="mt-2 font-display text-xl font-semibold tracking-tight text-(--ink) sm:text-2xl">
        Cursor costs ₹350 more this month.
      </h3>

      <div className="mt-4 grid min-w-0 gap-5">
        <article className="decision" data-lead="true">
          <div className="min-w-0">
            <p className="decision-cue">Next charge · 28 Aug</p>
            <h4 className="decision-sentence mt-2">Cursor Pro · ₹1,700</h4>
          </div>

          <div className="decision-evidence">
            <p className="eyebrow eyebrow-xs">From two example receipts</p>
            <ol className="cycle-rail mt-2" aria-label="Cursor Pro across three billing periods">
              <li className="cycle-cell">
                <span className="cycle-period">Jul</span>
                <span className="cycle-amount">₹1,350</span>
                <span className="cycle-note">Receipt</span>
              </li>
              <li className="cycle-cell">
                <span className="cycle-period">Aug</span>
                <span className="cycle-amount">₹1,700</span>
                <span className="cycle-note">Receipt</span>
              </li>
              <li className="cycle-cell cycle-cell-open">
                <span className="cycle-period">Sep</span>
                <span className="cycle-amount" aria-label="Not yet known">—</span>
                <span className="cycle-note">Not charged yet</span>
              </li>
            </ol>
          </div>

          <div>
            <p className="eyebrow eyebrow-xs">Why this needs you</p>
            <ul className="reason-list mt-2">
              <li>The latest bill is ₹350 higher than the previous one.</li>
              <li>You have not decided what should happen this cycle.</li>
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

        <aside
          className="flex min-w-0 flex-col justify-between border-t border-line pt-5"
          aria-live="polite"
        >
          <div>
            <p className="eyebrow eyebrow-xs">Your decision</p>
            <p className={`stamp stamp-${presentation.tone} mt-3`}>{presentation.label}</p>
            <h4 className="mt-4 font-display text-lg font-semibold leading-snug text-(--ink)">{hook.title}</h4>
            <p className="mt-2 text-sm leading-6 text-(--ink-soft)">{hook.body}</p>
          </div>
          <div className="mt-4 border-t border-line pt-3">
            <p className="eyebrow eyebrow-xs">What happens next</p>
            <p className="mt-2 text-sm leading-6 text-(--ink-soft)">{presentation.nextCheck}</p>
          </div>
        </aside>
      </div>

      <p className="mt-4 text-xs leading-5 text-(--muted)">
        Example only. Your review uses your receipts, and unsupported facts stay unknown.
      </p>
    </section>
  );
}