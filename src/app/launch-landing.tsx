import Link from "next/link";
import { ArrowDown, ArrowRight, FileCheck2, LockKeyhole, UserRoundCheck } from "lucide-react";
import { PublicFooter, PublicHeader } from "./public-shell";
import { DeskStrip } from "./desk-strip";
import { FreezeSheet, RequestSheet } from "./record-sheet";
import { MoneyValue } from "@/components/ui/money-value";
import { commitmentControlPilotOffer } from "@/lib/pilot-offer";
import "./clearline-home.css";

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
        <section className="home-entry" aria-labelledby="home-title">
          <div className="home-measure">
            <header className="home-intro">
              <p className="home-category">Commitment Control for India-first AI companies</p>
              <h1 id="home-title" className="home-title">Vognary<span aria-hidden>.</span></h1>
              <p className="home-lead">Before the commitment. <br />A clear human decision.</p>
            </header>
            <div className="home-scene" aria-label="Synthetic commitment awaiting a human decision">
              <div className="home-scene-rail">
                <p className="home-scene-label">The decision desk</p>
                <ol className="home-sequence">
                  <li aria-current="step"><span>Proposed</span><small>User-entered assumption</small></li>
                  <li><span>Authorized</span><small>A named person decides</small></li>
                  <li><span>Observed</span><small>Later financial evidence</small></li>
                </ol>
                <Link href="/demo" className="btn btn-primary">Review the synthetic request <ArrowRight size={17} aria-hidden /></Link>
              </div>
              <RequestSheet />
            </div>
            <div className="home-entry-foot">
              <p>Policy gives context. Only you authorize.</p>
              <a href="#home-freeze-title" aria-label="Explore the authorization record"><ArrowDown size={20} aria-hidden /></a>
            </div>
          </div>
        </section>

        {/* 2 — AUTHORIZATION TO OUTCOME */}
        <section className="home-band home-freeze" aria-labelledby="home-freeze-title">
          <div className="home-measure home-freeze-grid">
            <div className="home-say">
              <p className="home-category">One decision. A lasting record.</p>
              <h2 id="home-freeze-title" className="home-section-heading font-display">
                The cap stays put.<br />The evidence speaks.
              </h2>
              <p className="home-lead">
                A proposed amount is not a bill. A policy result is not approval. Your recorded decision keeps its original cap when later evidence arrives.
              </p>
              <Link href="/demo" className="home-quiet">Follow the full example <ArrowRight size={17} aria-hidden /></Link>
            </div>
            <FreezeSheet headingId="home-freeze-title" />
          </div>
        </section>

        {/* 3 — DAILY OPERATION */}
        <section className="home-band home-week" aria-labelledby="home-week-title">
          <div className="home-measure">
            <div className="home-band-heading">
              <h2 id="home-week-title" className="home-section-heading font-display">A place for what needs you.</h2>
              <p>Six synthetic records, computed by the product&apos;s policy and reconciliation engines. Not customer activity.</p>
            </div>
            <DeskStrip headingId="home-week-title" />
          </div>
        </section>

        {/* 4 — BOUNDARIES */}
        <section className="home-band home-trust" aria-labelledby="home-trust-title">
          <div className="home-measure">
            <h2 id="home-trust-title" className="home-section-heading font-display">
              Authority stays with you.
            </h2>
            <ul className="home-refusals">
              <li><UserRoundCheck size={24} aria-hidden /><b>A person, not a threshold.</b><p>No automatic approval or decline. No purchasing, provisioning, cancellation, or money movement.</p></li>
              <li><FileCheck2 size={24} aria-hidden /><b>Evidence, not invented certainty.</b><p>Assumptions stay labelled. Unknown stays unknown. Financial facts point back to their source.</p></li>
              <li><LockKeyhole size={24} aria-hidden /><b>Access, with a boundary.</b><p>No bank passwords. No mailbox access. Real customer financial data stays blocked until independent security assessment and retest are complete.</p></li>
            </ul>
            <Link href="/security" className="home-quiet">Read the current boundaries <ArrowRight size={17} aria-hidden /></Link>
          </div>
        </section>

        {/* 5 — PILOT */}
        <section className="home-band home-pilot" aria-labelledby="home-pilot-title">
          <div className="home-measure home-pilot-grid">
            <div>
              <p className="home-category">For a named finance owner</p>
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
            <div className="home-pilot-detail">
              <ul className="home-pilot-terms">
                <li>One policy setup and up to {commitmentControlPilotOffer.proposalLimit} proposals.</li>
                <li>Up to {commitmentControlPilotOffer.reconciliationReviewLimit} weekly reconciliation reviews.</li>
                <li>Payment reserves the pilot. Payment is not activation.</li>
                <li>A second month requires a separate purchase.</li>
              </ul>
              <Link href="/pay" prefetch={false} className="btn btn-primary btn-lg">
                See the one-month pilot <ArrowRight size={18} aria-hidden />
              </Link>
              <Link href="/start" className="home-quiet">Use your own evidence</Link>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
