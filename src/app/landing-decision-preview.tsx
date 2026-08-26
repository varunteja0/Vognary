"use client";

import { useState } from "react";

const actions = [
  { value: "APPROVE", label: "Approve" },
  { value: "APPROVE_WITH_CAP", label: "Approve with cap" },
  { value: "DECLINE", label: "Decline" },
] as const;

type PreviewAction = (typeof actions)[number]["value"];

const actionPresentation: Record<PreviewAction, {
  label: string;
  tone: "keep" | "watch" | "cancel";
  title: string;
  body: string;
  nextCheck: string;
}> = {
  APPROVE: {
    label: "Authorize at the proposed amount",
    tone: "keep",
    title: "A named human freezes ₹1,700 as the cap.",
    body: "The proposal remains an assumption until later cited receipts are linked. Approving does not purchase, provision, or pay Cursor.",
    nextCheck: "The next Cursor receipt is compared to the frozen ₹1,700 cap.",
  },
  APPROVE_WITH_CAP: {
    label: "Authorize a lower cap",
    tone: "watch",
    title: "A named human freezes a cap below the proposal.",
    body: "Policy can require review. The human still decides. A lower cap is recorded; later evidence cannot rewrite it.",
    nextCheck: "Observed spend above that cap is marked over the frozen authorization.",
  },
  DECLINE: {
    label: "Decline the obligation",
    tone: "cancel",
    title: "No cap is frozen. The company did not authorize this.",
    body: "Decline is a recorded refusal. Vognary does not cancel Cursor or move money.",
    nextCheck: "A later Cursor receipt can still be stored as evidence. It is not an authorization.",
  },
};

export function LandingDecisionPreview() {
  const [action, setAction] = useState<PreviewAction>("APPROVE_WITH_CAP");
  const presentation = actionPresentation[action];

  return (
    <section id="example-decision" aria-labelledby="product-review-heading" className="min-w-0">
      <h2 className="eyebrow text-ochre">A real authorization, not a dashboard</h2>
      <h3 id="product-review-heading" className="mt-2 font-display text-xl font-semibold text-(--ink) sm:text-2xl">
        Cursor costs ₹350 more this month.
      </h3>

      <div className="mt-4 grid min-w-0 gap-5">
        <article className="decision" data-lead="true">
          <div className="min-w-0">
            <p className="decision-cue">Proposed obligation · monthly</p>
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
            <p className="eyebrow eyebrow-xs">Why this needs a human</p>
            <ul className="reason-list mt-2">
              <li>The latest bill is ₹350 higher than the previous one.</li>
              <li>Policy annotates. A named owner or admin still authorizes the cap.</li>
            </ul>
          </div>

          <div className="decision-actions">
            <div role="group" aria-label="Choose the example authorization" className="flex flex-wrap items-center gap-2">
              {actions.map((item) => {
                const selected = action === item.value;
                const selectedClass = item.value === "DECLINE" ? "btn-ember" : "btn-primary";
                const idleClass = item.value === "DECLINE" ? "btn-quiet-danger" : "btn-ghost";
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
            <p className="eyebrow eyebrow-xs">The authorization</p>
            <p className={`stamp stamp-${presentation.tone} mt-3`}>{presentation.label}</p>
            <h4 className="mt-4 font-display text-lg font-semibold leading-snug text-(--ink)">{presentation.title}</h4>
            <p className="mt-2 text-sm leading-6 text-(--ink-soft)">{presentation.body}</p>
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
