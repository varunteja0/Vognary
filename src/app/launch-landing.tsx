import Link from "next/link";
import { PublicFooter, PublicHeader } from "./public-shell";
import { DeskStrip } from "./desk-strip";
import { FreezeSheet, RequestSheet } from "./record-sheet";
import { MoneyValue } from "@/components/ui/money-value";
import { commitmentControlPilotOffer } from "@/lib/pilot-offer";
import "./home.css";

/**
 * Home — five bands, in the order a stranger needs them.
 *
 *   1. the decision that is waiting, with the product visible immediately
 *   2. what a human freezing a cap actually does to a later invoice
 *   3. one synthetic record per state, so the shape of the job is visible
 *   4. the boundaries — including what Vognary refuses to do
 *   5. one price, one month, one action
 *
 * The product is the hero. Supporting copy before the first product state is
 * deliberately under 35 words, and there is exactly one primary call to action.
 *
 * Prose here never restates what a sheet already renders. The sheets carry the
 * amounts, the freeze, the decider and the verdict; a paragraph that repeated
 * them would be teaching the reader something the page is already showing, and
 * it would cost the height that keeps this page under its anti-sprawl cap.
 */

export default function LaunchLanding() {
  return (
    <>
      <PublicHeader />
      <main id="ledger-main" className="home">
        {/* 1 — DECISION NOW */}
        <section className="home-band home-decision" aria-labelledby="home-title">
          <div className="home-measure home-decision-grid">
            <div className="home-say">
              <p className="home-category">Commitment Control for India-first AI companies</p>
              <h1 id="home-title" className="home-title font-display">
                Approve AI and cloud commitments before they become bills.
              </h1>
              <p className="home-lead">
                One request is waiting. Its history is cited, your rule is applied, and nothing
                moves until a named person decides.
              </p>
              <div className="home-actions">
                <Link href="/demo" className="btn btn-primary btn-lg">Review the synthetic request</Link>
                <Link href="/start" className="home-quiet">Use your own evidence</Link>
              </div>
            </div>
            <RequestSheet headingId="home-title" />
          </div>
        </section>

        {/* 2 — AUTHORIZATION TO OUTCOME */}
        <section className="home-band home-freeze" aria-labelledby="home-freeze-title">
          <div className="home-measure home-freeze-grid">
            <div className="home-say">
              <h2 id="home-freeze-title" className="home-section-heading font-display">
                A rule can annotate. Only a person can decide.
              </h2>
              <p className="home-lead">
                The finance owner freezes a cap below what was asked for. Weeks later the invoice
                arrives above it, and the gap is a fact instead of an argument.
              </p>
            </div>
            <FreezeSheet headingId="home-freeze-title" />
          </div>
        </section>

        {/* 3 — DAILY OPERATION */}
        <section className="home-band home-week" aria-labelledby="home-week-title">
          <div className="home-measure">
            <h2 id="home-week-title" className="home-section-heading font-display">
              Six constructed records, one per state.
            </h2>
            <p className="home-lead home-lead-wide">
              No customer has used Vognary yet, so nothing below was observed. These six records
              were written by us and run through the same policy and reconciliation engines the
              product uses, which is why the states and figures are real output and the companies
              are not. Grouped by what would have to happen next, never ranked by a score no one
              can audit.
            </p>
            <DeskStrip headingId="home-week-title" />
          </div>
        </section>

        {/* 4 — BOUNDARIES */}
        <section className="home-band home-trust" aria-labelledby="home-trust-title">
          <div className="home-measure">
            <h2 id="home-trust-title" className="home-section-heading font-display">
              What Vognary will not do.
            </h2>
            <ul className="home-refusals">
              <li>
                <b>It never decides.</b> No auto-approval, no auto-denial, no threshold that
                quietly says yes on your behalf.
              </li>
              <li>
                <b>It never moves money.</b> No card, no wallet, no vendor contact, no purchase,
                no cancellation.
              </li>
              <li>
                <b>It never guesses a number.</b> Unknown renders as unknown. A figure you typed
                is labelled an assumption until a document proves it.
              </li>
              <li>
                <b>It never needs your bank password or your mailbox.</b> You bring one document
                at a time.
              </li>
            </ul>
            <p className="home-lead">
              Real customer financial data stays blocked until an independent security assessment
              and retest are complete. <Link href="/security">Read the current boundaries</Link>.
            </p>
          </div>
        </section>

        {/* 5 — PILOT */}
        <section className="home-band home-pilot" aria-labelledby="home-pilot-title">
          <div className="home-measure home-pilot-grid">
            <div>
              <h2 id="home-pilot-title" className="home-section-heading font-display">
                One pilot month.
              </h2>
              <MoneyValue
                minor={String(commitmentControlPilotOffer.amountMinor)}
                currency={commitmentControlPilotOffer.currency}
                provenance={{ kind: "frozen", label: "One-time, no automatic renewal" }}
                size="lead"
                layout="stacked"
                className="home-price"
              />
            </div>
            <ul className="home-pilot-terms">
              <li>Covers one pilot month. A second month is a separate purchase.</li>
              <li>Payment reserves the pilot. Payment is not activation.</li>
              <li>Nothing renews. There is no subscription to cancel.</li>
              <li>Refundable before the pilot month starts.</li>
            </ul>
            <div className="home-pilot-action">
              <Link href="/pay" prefetch={false} className="btn btn-primary btn-lg">
                See the one-month pilot
              </Link>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
