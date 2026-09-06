"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { PublicHeader } from "../public-shell";
import { MoneyValue } from "@/components/ui/money-value";
import type { ControlDecisionDto, ControlReconciliationDto } from "@/lib/commitment-control/contracts";
import type { SyntheticDemoBranch } from "@/lib/synthetic-control-demo";
import "./demo.css";

/**
 * The demonstration.
 *
 * It opens where the work is: a request that a rule has already annotated and
 * cannot settle, with the three things a person may do about it visible
 * immediately. There is no tour, no Next button and no numbered lesson — a
 * finance owner does not need to be walked to the decision they were shown.
 *
 * Two actions reach any ending: choose a decision, then let the later invoice
 * arrive. A decline creates no cap, so it is never offered an invoice to
 * compare against; the refusal is where that record stops.
 *
 * Nothing here touches the network, a store or a product API. Every fact on
 * screen is produced by the same pure engines the signed-in desk uses.
 */

const CHOICE_NOTES: Record<SyntheticDemoBranch, string> = {
  APPROVE_WITH_CAP: "Freeze a cap below what was asked for.",
  APPROVE: "Freeze a cap at the amount that was asked for.",
  DECLINE: "Create no cap at all.",
};

function label(value: string): string {
  return value.toLowerCase().replace(/_/g, " ");
}

export function DemoClient({ branches, period, requestSheet, stamp }: {
  branches: readonly { action: SyntheticDemoBranch; label: string; outcome: string; decision: ControlDecisionDto | null; reconciliation: ControlReconciliationDto | null }[];
  period: string;
  requestSheet: ReactNode;
  stamp: ReactNode;
}) {
  const [branch, setBranch] = useState<SyntheticDemoBranch | null>(null);
  const [observed, setObserved] = useState(false);
  const outcome = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => {
    setBranch(null);
    setObserved(false);
  }, []);

  // Focus moves once, to the record that just changed, and only when the set of
  // available controls changes — never on every re-render.
  const decide = useCallback((action: SyntheticDemoBranch) => {
    setBranch(action);
    setObserved(false);
  }, []);

  useEffect(() => {
    if (branch) outcome.current?.focus();
  }, [branch]);

  const entry = branches.find(choice => choice.action === branch);
  const decision = entry?.decision ?? null;
  const reconciliation = observed ? entry?.reconciliation ?? null : null;
  const refused = branch === "DECLINE";

  return (
    <div className="demo">
      <PublicHeader />
      <header className="demo-top">
        <span className="demo-location">The decision desk / Example</span>
        {stamp}
      </header>

      <main className="demo-body">
        <div className="demo-say">
          <h1 id="demo-title" className="font-display">Review a commitment.</h1>
          <p>A proposed obligation, cited exposure, and a policy result. The next decision belongs to a person.</p>
        </div>
        <div className="demo-grid">
          {/* Heading and record share a column so the decision panel can start
              at the top of the page instead of below the paragraph's measure. */}
          <div className="demo-lede">
            {requestSheet}
          </div>

          <div className="demo-panel">
            <section className="demo-decision" aria-labelledby="demo-decision-title">
              <h2 id="demo-decision-title">Your decision</h2>
              <div className="demo-choices" role="group" aria-describedby="demo-decision-title">
                {branches.map(({ action, label: choiceLabel }) => (
                  <button
                    key={action}
                    type="button"
                    className="demo-choice"
                    data-action={action}
                    aria-pressed={branch === action}
                    onClick={() => decide(action)}
                  >
                    {action === "APPROVE_WITH_CAP" ? <SlidersHorizontal size={20} aria-hidden /> : action === "APPROVE" ? <Check size={20} aria-hidden /> : <X size={20} aria-hidden />}
                    <span className="demo-choice-label">{choiceLabel}</span>
                    <span className="demo-choice-note">{CHOICE_NOTES[action]}</span>
                  </button>
                ))}
              </div>
              {branch ? (
                <button type="button" className="btn btn-ghost btn-sm demo-reset" onClick={reset}>
                  <RotateCcw size={16} aria-hidden />
                  Clear and choose again
                </button>
              ) : (
                <p className="demo-hint">Nothing is stored. No account is involved.</p>
              )}
            </section>

            <div
              className="demo-outcome"
              data-branch={branch ?? "none"}
              tabIndex={-1}
              ref={outcome}
              aria-live="polite"
            >
              {!branch ? (
                <p className="demo-idle">
                  The record is unresolved. It stays that way until a named person acts.
                </p>
              ) : (
                <>
                  <h2>{refused ? "Refused. No cap exists." : "Authorized. The cap is frozen."}</h2>
                  <p className="demo-outcome-note">{entry?.outcome}</p>

                  {decision?.approvedCapMinor ? (
                    <>
                      <div className="demo-cap-rule" aria-hidden="true" />
                      <MoneyValue
                        minor={decision.approvedCapMinor}
                        currency={decision.currency}
                        provenance={{ kind: "frozen", label: `Frozen by ${decision.decidedByDisplayName}` }}
                        size="lead"
                        layout="stacked"
                        className="demo-cap"
                      />
                    </>
                  ) : null}

                  {decision?.overrideReason ? (
                    <p className="demo-reason">“{decision.overrideReason}”</p>
                  ) : null}

                  {refused ? (
                    <p className="demo-refusal">
                      There is no boundary here, so a later invoice has nothing to be measured
                      against. That is the honest result of a refusal, not a gap in the record.
                    </p>
                  ) : !observed ? (
                    <button
                      type="button"
                      className="btn btn-primary demo-evidence-button"
                      onClick={() => setObserved(true)}
                    >
                      Let the {period} invoice arrive
                      <ArrowRight size={17} aria-hidden />
                    </button>
                  ) : reconciliation ? (
                    <div className="demo-observed">
                      <dl className="demo-observed-rows">
                        <div>
                          <dt>{period} invoice</dt>
                          <dd>
                            <MoneyValue
                              minor={reconciliation.observedAmountMinor}
                              currency={reconciliation.observedCurrency ?? "INR"}
                              provenance={{ kind: "observed" }}
                              size="data"
                            />
                          </dd>
                        </div>
                      </dl>
                      <p
                        className={`demo-verdict ${
                          reconciliation.verdict === "OVER_CAP" ? "demo-verdict-breach" : "demo-verdict-ok"
                        }`}
                      >
                        <b>{label(reconciliation.verdict)}</b> against the frozen cap. The cap did not
                        move, and it will not move again.
                      </p>
                    </div>
                  ) : null}

                  <div className="demo-next-action">
                    {refused ? (
                      <Link href="/start" className="btn btn-primary">Use your own evidence</Link>
                    ) : observed ? (
                      <>
                        <Link href="/pay" prefetch={false} className="btn btn-primary">
                          See the one-month pilot
                        </Link>
                        <Link href="/start" className="demo-quiet">Use your own evidence</Link>
                      </>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
