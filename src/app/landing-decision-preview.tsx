"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MoneyValue } from "@/components/ui/money-value";
import { writeGuestProposalDraft } from "@/lib/guest-proposal-draft";
import { annotateLandingPolicy } from "@/lib/landing-desk-policy";

const EXAMPLE_MERCHANT = "Cursor Pro";
const EXAMPLE_AMOUNT = 1700;
const EXAMPLE_PRIOR = 1350;
const inrNumber = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

const actions = [
  { value: "APPROVE", label: "Approve" },
  { value: "APPROVE_WITH_CAP", label: "Approve with cap" },
  { value: "DECLINE", label: "Decline" },
] as const;

type PreviewAction = (typeof actions)[number]["value"];

function formatInr(rupees: number): string {
  if (!Number.isFinite(rupees) || rupees < 0) return "unknown";
  return `INR ${inrNumber.format(Math.round(rupees))}`;
}

function parseRupees(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  const value = Number(digits);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function LandingDecisionPreview() {
  const [merchant, setMerchant] = useState(EXAMPLE_MERCHANT);
  const [amountInput, setAmountInput] = useState(String(EXAMPLE_AMOUNT));
  const [capInput, setCapInput] = useState(String(EXAMPLE_PRIOR));
  const [action, setAction] = useState<PreviewAction>("APPROVE_WITH_CAP");
  const amount = parseRupees(amountInput);
  const cap = parseRupees(capInput);
  const label = merchant.trim() || "Unnamed vendor";
  const usingExample = label === EXAMPLE_MERCHANT && amount === EXAMPLE_AMOUNT;
  const annotation = annotateLandingPolicy({
    usingExample,
    proposedAmountInr: amount,
    citedPriorInr: EXAMPLE_PRIOR,
  });

  const saveDraft = () => {
    writeGuestProposalDraft({ merchant: label, amountInr: amount, capInr: cap, action, usingExample });
  };

  const presentation = useMemo(() => {
    if (action === "DECLINE") {
      return {
        label: "Decline the obligation",
        tone: "cancel" as const,
        title: "No cap is frozen. The company did not authorize this.",
        body: usingExample
          ? "Decline records a refusal. Vognary does not cancel Cursor or move money."
          : "Decline records a refusal. Vognary does not cancel the vendor or move money.",
        nextCheck: "A later receipt can still be stored as evidence. It is not an authorization.",
        capInr: null as number | null,
      };
    }
    if (action === "APPROVE") {
      const frozen = amount === null ? "unknown" : formatInr(amount);
      return {
        label: "Authorize at the proposed amount",
        tone: "keep" as const,
        title: `A named human freezes ${frozen} as the cap.`,
        body: "The proposal remains an assumption until later cited receipts are linked. Approving does not purchase, provision, or pay the vendor.",
        nextCheck: amount === null
          ? "Name a proposed amount before this can be a frozen cap."
          : `The next cited receipt for ${label} is compared with the frozen ${frozen} cap.`,
        capInr: amount,
      };
    }
    const frozen = cap === null ? null : formatInr(cap);
    return {
      label: "Authorize a lower cap",
      tone: "watch" as const,
      title: frozen ? `A named human freezes ${frozen} as the cap.` : "A named human freezes a cap below the proposal.",
      body: "Policy can require review. The human still decides. A lower cap is recorded; later evidence cannot rewrite it.",
      nextCheck: cap === null
        ? "Name a cap in INR. Until then this is a click, not an authorization."
        : amount !== null && cap >= amount
          ? "A cap at or above the proposal is the same as Approve. Lower it, or choose Approve."
          : `Observed spend above ${frozen} is marked over the frozen authorization.`,
      capInr: cap,
    };
  }, [action, amount, cap, label, usingExample]);

  return (
    <section id="example-decision" aria-labelledby="product-review-heading" className="min-w-0">
      <h2 className="eyebrow text-ochre">A working authorization, not a dashboard</h2>
      <h3 id="product-review-heading" className="mt-2 font-display text-xl font-semibold tracking-tight text-(--ink) sm:text-2xl">
        {usingExample ? "Cursor costs INR 350 more this month." : `${label}: existing exposure is not cited.`}
      </h3>
      <p className={`truth-label ${annotation.truthClass} mt-3`}>{annotation.status}</p>
      <p className="mt-2 text-sm leading-6 text-(--ink-soft)">{annotation.reason}</p>

      <form className="mt-4 grid min-w-0 grid-cols-2 gap-3" onSubmit={(event) => event.preventDefault()}>
        <p className="col-span-2 text-sm leading-6 text-(--muted)">
          Type the next yes. Amounts you type are assumptions. Cited money stays unknown until you add a bill.
        </p>
        <div>
          <label htmlFor="landing-merchant" className="field-label">Vendor / commitment</label>
          <input id="landing-merchant" className="field" value={merchant} onChange={(event) => setMerchant(event.target.value)} autoComplete="off" />
        </div>
        <div>
          <label htmlFor="landing-amount" className="field-label">Proposed amount (INR)</label>
          <input id="landing-amount" className="field field-mono" inputMode="numeric" value={amountInput} onChange={(event) => setAmountInput(event.target.value)} autoComplete="off" />
        </div>
        {action === "APPROVE_WITH_CAP" ? (
          <div className="col-span-2">
            <label htmlFor="landing-cap" className="field-label">Frozen cap (INR)</label>
            <input id="landing-cap" className="field field-mono" inputMode="numeric" value={capInput} onChange={(event) => setCapInput(event.target.value)} placeholder="Lower than the proposal" autoComplete="off" />
          </div>
        ) : null}
      </form>

      <div className="mt-4 grid min-w-0 gap-5">
        <article className="decision" data-lead="true">
          <div className="min-w-0">
            <p className="decision-cue">Proposed obligation · assumption</p>
            <h4 className="decision-sentence mt-2">{label} · {amount === null ? "amount unknown" : formatInr(amount)}</h4>
          </div>

          <div className="decision-evidence">
            {usingExample ? (
              <>
                <p className="eyebrow eyebrow-xs">From two example receipts</p>
                <ol className="cycle-rail mt-2 hidden sm:flex" aria-label="Cursor Pro across three billing periods">
                  <li className="cycle-cell">
                    <span className="cycle-period">Jul</span>
                    <MoneyValue minor={EXAMPLE_PRIOR * 100} provenance={{ kind: "cited", source: "Receipt" }} size="data" layout="stacked" />
                  </li>
                  <li className="cycle-cell">
                    <span className="cycle-period">Aug</span>
                    <MoneyValue minor={EXAMPLE_AMOUNT * 100} provenance={{ kind: "cited", source: "Receipt" }} size="data" layout="stacked" />
                  </li>
                  <li className="cycle-cell cycle-cell-open">
                    <span className="cycle-period">Sep</span>
                    <MoneyValue minor={null} provenance={{ kind: "unknown", reason: "Not charged yet" }} size="data" layout="stacked" />
                  </li>
                </ol>
              </>
            ) : (
              <>
                <p className="eyebrow eyebrow-xs">Cited existing exposure</p>
                <p className="mt-2 text-sm leading-6 text-(--ink-soft)">Unknown. Eligible existing spend was not cited, so exposure stays unknown. Policy annotates; it does not invent a merchant or amount.</p>
              </>
            )}
          </div>

          <div>
            <p className="eyebrow eyebrow-xs">Why this needs a human</p>
            <ul className="reason-list mt-2">
              {usingExample ? (
                <>
                  <li>The latest bill is {formatInr(EXAMPLE_AMOUNT - EXAMPLE_PRIOR)} higher than the previous one.</li>
                  <li>Policy annotates. A named owner or admin still authorizes the cap.</li>
                </>
              ) : (
                <>
                  <li>You typed an assumption. It is not evidence that money was or will be spent.</li>
                  <li>A named owner or admin must freeze a cap, or decline. This unsigned click is not a recorded decision.</li>
                </>
              )}
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
            {presentation.capInr === null ? null : (
              <p className="mt-3">
                <MoneyValue minor={presentation.capInr * 100} provenance={{ kind: "frozen" }} size="lead" />
              </p>
            )}
            <p className="mt-2 text-sm leading-6 text-(--ink-soft)">{presentation.body}</p>
          </div>
          <div className="mt-4 border-t border-line pt-3">
            <p className="eyebrow eyebrow-xs">What happens next</p>
            <p className="mt-2 text-sm leading-6 text-(--ink-soft)">{presentation.nextCheck}</p>
            <Link href="/start" onClick={saveDraft} className="btn btn-primary mt-4">Cite a bill you already have</Link>
          </div>
        </aside>
      </div>

      <p className="mt-4 text-xs leading-5 text-(--muted)">
        {usingExample
          ? "Example only. Your review uses your receipts, and unsupported facts stay unknown."
          : "Not saved. Not a recorded owner decision. Unsupported facts stay unknown. Cite a bill to ground exposure."}
      </p>
    </section>
  );
}