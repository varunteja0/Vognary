import type { Metadata } from "next";
import Link from "next/link";
import { VognaryMark } from "../brand";
import { formatMoney } from "@/lib/format";
import { commitmentControlPilotOffer, pilotOfferMajorUnits } from "@/lib/pilot-offer";
import { getPilotPaymentLink } from "@/lib/pilot-payment-link";

export const dynamic = "force-dynamic";

const priceCopy = formatMoney(pilotOfferMajorUnits(), commitmentControlPilotOffer.currency);

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
      <main id="ledger-main" className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <div className="flex gap-2">
            <Link href="/terms" className="btn btn-sm btn-ghost">Terms</Link>
            <Link href="/contact" className="btn btn-sm btn-ghost">Contact</Link>
          </div>
        </div>

        <article className="panel p-6 sm:p-8">
          <span className="folio" data-folio="Commercial">Private pilot</span>
          <h1 className="mt-4 font-display text-3xl font-semibold text-(--ink) sm:text-4xl">
            {commitmentControlPilotOffer.title}
          </h1>
          <p className="mt-3 font-data text-3xl font-semibold text-(--ink)">{price}<span className="ml-2 text-base font-normal text-(--muted)">one-time for one month</span></p>
          <p className="mt-3 text-sm leading-7 text-(--muted)">
            This is a one-month, founder-delivered Commitment Control pilot: Vognary records a proposed obligation, shows cited existing exposure, records who approved what limit, and later checks observed evidence against that decision. Payment reserves the pilot; service and customer-data access begin only after the written activation conditions are met. Vognary never auto-approves, auto-denies, purchases, provisions, cancels, or moves your vendor money. Card, UPI, and bank details stay with the payment provider.
          </p>

          <section className="mt-8 border-t border-line pt-5">
            <h2 className="font-display text-lg font-semibold text-(--ink)">Included in the pilot month</h2>
            <ul className="reason-list mt-3">
              {included.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>

          <section className="mt-8 border-t border-line pt-5">
            <h2 className="font-display text-lg font-semibold text-(--ink)">Reserve the pilot</h2>
            {payment.status === "ready" ? (
              <>
                <p className="mt-2 text-sm leading-7 text-(--muted)">
                  The button opens a founder-configured hosted payment page for exactly {price}. It must request one payment only. Keep the provider&apos;s confirmation and email{" "}
                  <a className="link-quiet" href="mailto:support@vognary.com">support@vognary.com</a> if you need a Vognary letterhead receipt.
                </p>
                <p className="mt-2 text-sm leading-7 text-(--muted)">
                  Service starts only after the independent security review and written activation conditions are complete. If Vognary cannot activate the pilot within {commitmentControlPilotOffer.activationDeadlineBusinessDays} business days after payment, request a full refund. A second month requires a new, active purchase; this payment does not create an automatic renewal.
                </p>
                <a className="btn btn-primary btn-lg mt-5" href={payment.href} rel="noopener noreferrer">
                  Reserve the pilot for {price}
                </a>
              </>
            ) : (
              <p className="mt-2 text-sm leading-7 text-(--muted)">
                Online one-time collection is not configured on this deployment. Email{" "}
                  <a className="link-quiet" href="mailto:support@vognary.com">support@vognary.com</a> for a one-time invoice and payment link. Do not send card numbers, OTPs, or bank passwords.
              </p>
            )}
          </section>

          <section className="mt-8 border-t border-line pt-5">
            <h2 className="font-display text-lg font-semibold text-(--ink)">Tax, refunds, and retired checkout</h2>
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
        </article>
      </div>
      </main>
    </>
  );
}
