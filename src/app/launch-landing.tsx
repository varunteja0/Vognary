import Link from "next/link";
import { PublicFooter, PublicHeader } from "./public-shell";
import { HomeFieldNarrative } from "./home-field-narrative";
import { HomeOperatingRecord } from "./home-operating-record";
import { commitmentControlPilotOffer, pilotOfferMajorUnits } from "@/lib/pilot-offer";
import "./home.css";

export default function LaunchLanding() {
  const price = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: commitmentControlPilotOffer.currency,
    currencyDisplay: "code",
    maximumFractionDigits: 0,
  }).format(pilotOfferMajorUnits());
  return (
    <>
      <PublicHeader />
      <main id="ledger-main" className="home">
        <HomeFieldNarrative>
          <div className="home-say">
            <p className="home-category">Commitment Control for India-first AI companies</p>
            <h1 id="home-title" className="home-title font-display">
              Your next expensive yes should leave a line behind it.
            </h1>
            <p className="home-lead">
              Someone asks for money. Vognary shows what your record already proves, applies your own
              rule, and then waits. Only a named human freezes the boundary — and later receipts are
              measured against that boundary rather than against a memory.
            </p>
            <div className="home-actions">
              <Link href="/demo" className="btn btn-primary btn-lg">Walk a decision</Link>
              <Link href="/start" className="home-quiet">Or cite a bill you already hold</Link>
            </div>
          </div>
        </HomeFieldNarrative>

        <HomeOperatingRecord />

        <section className="home-try" aria-labelledby="home-try-heading">
          <div className="home-measure">
            <h2 id="home-try-heading" className="home-section-heading font-display">
              What you can truthfully do today
            </h2>
            <ul className="home-try-list">
              <li>
                <h3>Walk a synthetic decision</h3>
                <p>
                  Every stage above, under your control, with placeholder figures. Approve, cap or
                  decline and watch the record change. Nothing is stored and no account is involved.
                </p>
                <Link href="/demo" className="btn btn-ghost">Walk a decision</Link>
              </li>
              <li>
                <h3>Cite one bill you already hold</h3>
                <p>
                  Bring a single invoice or receipt. Vognary reads what is on it, states plainly what
                  it cannot know, and shows the exposure that would surround a proposal. No bank
                  password and no mailbox access are involved at any point.
                </p>
                <Link href="/start" className="btn btn-ghost">Bring your own bill</Link>
              </li>
              <li>
                <h3>Run the loop with your team</h3>
                <p>
                  Live decisions, frozen boundaries and reconciliation run inside an enrolled
                  workspace. Enrollment is deliberate and manual today, which is why there is a
                  pilot rather than a sign-up button.
                </p>
                <Link href="/pay" prefetch={false} className="btn btn-ghost">See the pilot</Link>
              </li>
            </ul>
          </div>
        </section>

        <section className="home-close" aria-labelledby="home-close-heading">
          <div className="home-measure home-close-inner">
            <div>
              <h2 id="home-close-heading" className="home-close-heading font-display">
                One pilot month. One price. No automatic renewal.
              </h2>
              <p className="home-close-body">
                {price} covers one workspace for a single pilot month. Payment is not activation: a
                person at Vognary enrolls you, and you can ask for a refund before that happens.
                Vognary never auto-approves, never purchases or provisions, and never moves money on
                your behalf.
              </p>
            </div>
            <div className="home-close-action">
              <Link href="/pay" prefetch={false} className="btn btn-primary btn-lg">
                See pilot scope and price
              </Link>
              <Link href="/security" className="home-quiet">Read the security boundaries first</Link>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
