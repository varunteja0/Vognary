import "../public.css";
import "../ledger.css";
import type { Metadata } from "next";
import Link from "next/link";
import { VognaryMark } from "../brand";
import { formatExactMinorUnits } from "@/components/ui/money-value";
import { commitmentControlPilotOffer, pilotOfferMajorUnits } from "@/lib/pilot-offer";
import { getPilotPaymentLink } from "@/lib/pilot-payment-link";

export const dynamic = "force-dynamic";

// The canonical renderer, so the offer is not "INR 14,999" on Home and
// "₹14,999" here — two notations for one number across the same journey.
const priceCopy = formatExactMinorUnits(
  String(commitmentControlPilotOffer.amountMinor),
  commitmentControlPilotOffer.currency,
);

export const metadata: Metadata = {
  title: "Reserve the Commitment Control pilot",
  description: `${priceCopy} one-time Commitment Control private pilot for one month. Service begins only after the written activation conditions are met.`,
  alternates: { canonical: "/pay" },
  openGraph: {
    url: "/pay",
    title: "Reserve the Commitment Control pilot - Vognary",
    description: `${priceCopy} one-time Commitment Control private pilot for one month. Service begins only after the written activation conditions are met.`,
  },
};

const included = [
  "One policy setup and a named finance-owner workspace",
  `Up to ${commitmentControlPilotOffer.proposalLimit} real proposals during the pilot month`,
  `One 30-minute reconciliation review per week, up to ${commitmentControlPilotOffer.reconciliationReviewLimit}`,
  `Up to ${commitmentControlPilotOffer.additionalFounderSupportMinutes / 60} additional founder-support hours`,
] as const;

export default function PayPage() {
  const payment = getPilotPaymentLink();
  const price = priceCopy;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Offer",
    name: commitmentControlPilotOffer.title,
    url: "https://www.vognary.com/pay",
    price: String(pilotOfferMajorUnits()),
    priceCurrency: commitmentControlPilotOffer.currency,
    availability: payment.status === "ready"
      ? "https://schema.org/LimitedAvailability"
      : "https://schema.org/PreOrder",
    seller: {
      "@type": "Organization",
      name: "Vognary",
      url: "https://www.vognary.com/",
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <main id="ledger-main" className="relative px-4 pb-12 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line py-3">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <div className="flex gap-2">
            <Link href="/terms" className="btn btn-sm btn-ghost">Terms</Link>
            <Link href="/contact" className="btn btn-sm btn-ghost">Contact</Link>
          </div>
        </div>

        <article className="public-ledger">
          <header className="public-ledger-rail">
            <span className="folio" data-folio="Commercial">Private pilot</span>
            <h1 className="mt-5 font-display text-4xl font-semibold leading-tight text-(--ink) sm:text-5xl">
              {commitmentControlPilotOffer.title}
            </h1>
            <p className="public-price mt-6">{price}</p>
            <p className="mt-1 font-data text-xs text-(--muted)">ONE PAYMENT · ONE PILOT MONTH</p>
            <p className="mt-5 text-sm leading-7 text-(--ink-soft)">
              Reserve a founder-delivered control desk for proposed obligations, named human decisions, frozen caps, and later reconciliation.
            </p>
            {payment.status === "ready" ? (
              <a className="btn btn-primary btn-lg mt-6 w-full" href={payment.href} rel="noopener noreferrer">
                Reserve for {price}
              </a>
            ) : (
              <a className="btn btn-primary btn-lg mt-6 w-full" href="mailto:support@vognary.com?subject=Commitment%20Control%20pilot%20invoice">
                Request the one-time invoice
              </a>
            )}
            <p className="mt-4 text-xs leading-5 text-(--muted)">
              No automatic renewal. Payment does not bypass activation or security gates.
            </p>
          </header>

          <div className="public-ledger-body">
          <section className="public-band public-band-lead">
            <p className="truth-label truth-authority">What the payment reserves</p>
            <h2 className="mt-3 font-display text-2xl font-semibold text-(--ink)">One bounded month, with a human in control.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-(--muted)">
              Vognary records a proposed obligation, shows cited existing exposure, records who approved what limit, and later checks observed evidence against that decision. It never auto-approves, auto-denies, purchases, provisions, cancels, or moves vendor money.
            </p>
            {/* A reader arrives here straight from the request they just watched
                a person freeze. The pilot is described in that same order so the
                page continues the product story instead of restarting as a
                price list. */}
            <ol className="public-steps mt-5">
              <li>
                <b>Your policy, once.</b> The limits you already enforce in your head become a
                versioned rule that annotates a proposal and never decides one.
              </li>
              <li>
                <b>Up to {commitmentControlPilotOffer.proposalLimit} proposals.</b> Each one arrives
                as a request with its cited existing exposure beside it, exactly like the synthetic
                request on this site.
              </li>
              <li>
                <b>You freeze a cap, or you decline.</b> The decision, the person, the policy
                version and the reason are preserved and never recomputed.
              </li>
              <li>
                <b>Weekly reconciliation.</b> The invoices that actually arrive are measured against
                the cap that was frozen &mdash; matched, within, or over.
              </li>
            </ol>
            <p className="mt-4 text-sm leading-7 text-(--muted)">
              If you have not seen that loop yet,{" "}
              <Link href="/demo" className="link-quiet">review the synthetic request</Link> before
              you pay for a month of it.
            </p>
            <ul className="reason-list mt-4">
              {included.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>

          <section className="public-band">
            <p className="truth-label truth-policy">Activation boundary</p>
            <h2 className="mt-3 font-display text-xl font-semibold text-(--ink)">Payment reserves the work. It does not open customer data.</h2>
            {payment.status === "ready" ? (
              <>
                <p className="mt-2 text-sm leading-7 text-(--muted)">
                  The payment command opens a founder-configured hosted page for exactly {price}. It must request one payment only. Card, UPI, and bank details stay with the payment provider. Keep the provider&apos;s confirmation and email{" "}
                  <a className="link-quiet" href="mailto:support@vognary.com">support@vognary.com</a> if you need a Vognary letterhead receipt.
                </p>
                <p className="mt-2 text-sm leading-7 text-(--muted)">
                  Service starts only after the independent security review and written activation conditions are complete. If Vognary cannot activate the pilot within {commitmentControlPilotOffer.activationDeadlineBusinessDays} business days after payment, request a full refund. A second month requires a new, active purchase; this payment does not create an automatic renewal.
                </p>
              </>
            ) : (
              <div className="mt-4 border-l-2 border-ochre pl-4">
                <p className="font-data text-xs font-semibold text-ochre">ONLINE COLLECTION NOT CONFIGURED</p>
                <p className="mt-2 text-sm leading-7 text-(--muted)">
                  Email{" "}
                  <a className="link-quiet" href="mailto:support@vognary.com">support@vognary.com</a> for a one-time invoice and payment link. Do not send card numbers, OTPs, or bank passwords.
                </p>
              </div>
            )}
            <dl className="public-facts mt-6">
              <div><dt>Customer data</dt><dd>Blocked until assurance exit</dd></div>
              <div><dt>Activation</dt><dd>Within {commitmentControlPilotOffer.activationDeadlineBusinessDays} business days or full-refund request</dd></div>
              <div><dt>Month two</dt><dd>Requires a separate active purchase</dd></div>
            </dl>
          </section>

          <section className="public-band">
            <p className="truth-label truth-citation">Invoice and legal record</p>
            <h2 className="mt-3 font-display text-xl font-semibold text-(--ink)">Tax, refunds, and terms</h2>
            <p className="mt-2 text-sm leading-7 text-(--muted)">
              GST is charged only when a GSTIN is written on the invoice. Startups may deduct TDS under §194J; share Form 16A. Request a full refund from support@vognary.com before the pilot starts or if Vognary misses the ten business days activation deadline. After work begins, eligibility follows applicable law. The retired public checkout route is not used for this offer.
            </p>
            <p className="mt-3 text-sm leading-7 text-(--muted)">
              Paying confirms the{" "}
              <Link href="/terms" className="link-quiet">Terms</Link>
              {" "}and{" "}
              <Link href="/privacy" className="link-quiet">Privacy Notice</Link>.
            </p>
          </section>
          </div>
        </article>
      </div>
      </main>
    </>
  );
}
