import type { Metadata } from "next";
import Link from "next/link";
import { VognaryMark } from "../brand";
import { formatMoney } from "@/lib/format";
import { commitmentControlPilotOffer, pilotOfferMajorUnits } from "@/lib/pilot-offer";
import { getPilotPaymentLink } from "@/lib/pilot-payment-link";

export const dynamic = "force-dynamic";

const priceCopy = formatMoney(pilotOfferMajorUnits(), commitmentControlPilotOffer.currency);

export const metadata: Metadata = {
  title: "Subscribe to the Commitment Control pilot",
  description: `${priceCopy} per month Commitment Control private pilot. First payment on Razorpay authorizes the monthly subscription; later cycles are billed by Razorpay.`,
  alternates: { canonical: "/pay" },
  openGraph: {
    url: "/pay",
    title: "Subscribe to the Commitment Control pilot - Vognary",
    description: `${priceCopy} per month Commitment Control private pilot. First payment on Razorpay authorizes the monthly subscription; later cycles are billed by Razorpay.`,
  },
};

const included = [
  "Policy workshop and a named finance-owner workspace",
  "Up to 50 commitment evaluations in the month",
  "13-week obligation register and weekly reconciliation",
  "One-business-day response SLA on recorded decisions",
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
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
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
          <p className="mt-3 font-data text-3xl font-semibold text-(--ink)">{price}<span className="ml-2 text-base font-normal text-(--muted)">/ month, auto-renewing</span></p>
          <p className="mt-3 text-sm leading-7 text-(--muted)">
            This is a monthly Razorpay subscription for a founder-delivered Commitment Control desk: proposed obligation → cited exposure → stated policy → named human authorization and frozen cap → later Recovery evidence → reconciliation. The first successful payment authorizes the mandate. Razorpay then invoices and charges each billing cycle. Vognary never auto-approves, auto-denies, purchases, provisions, cancels, or moves your vendor money. Card, UPI, and bank details stay on Razorpay.
          </p>

          <section className="mt-8 border-t border-line pt-5">
            <h2 className="font-display text-lg font-semibold text-(--ink)">Included each month</h2>
            <ul className="reason-list mt-3">
              {included.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>

          <section className="mt-8 border-t border-line pt-5">
            <h2 className="font-display text-lg font-semibold text-(--ink)">Subscribe</h2>
            {payment.status === "ready" ? (
              <>
                <p className="mt-2 text-sm leading-7 text-(--muted)">
                  The button opens Razorpay&apos;s hosted Subscription Link for exactly {price} per month. That first payment is the authorisation charge. Later months are billed by Razorpay on the plan schedule, with their retries and invoices. Keep Razorpay&apos;s confirmation and email{" "}
                  <a className="link-quiet" href="mailto:support@vognary.com">support@vognary.com</a> if you need a Vognary letterhead receipt.
                </p>
                <p className="mt-2 text-sm leading-7 text-(--muted)">
                  Cards, bank e-mandates, and UPI Autopay can renew this amount without a fresh PIN when the debit stays at {price} — under India&apos;s ₹15,000 PIN-free recurring cap. GST is not added unless a GSTIN is written on the invoice; adding 18% GST would take the debit over ₹15,000 and UPI would ask for a PIN each month. Pause or cancel on Razorpay; Vognary does not hold the mandate.
                </p>
                <a className="btn btn-primary btn-lg mt-5" href={payment.href} rel="noopener noreferrer">
                  Start {price}/month on Razorpay
                </a>
              </>
            ) : (
              <p className="mt-2 text-sm leading-7 text-(--muted)">
                Online subscription collection is not configured on this deployment. Email{" "}
                <a className="link-quiet" href="mailto:support@vognary.com">support@vognary.com</a> for an invoice and a unique Razorpay Subscription Link. Do not send card numbers, OTPs, or bank passwords.
              </p>
            )}
          </section>

          <section className="mt-8 border-t border-line pt-5">
            <h2 className="font-display text-lg font-semibold text-(--ink)">Tax, refunds, and retired checkout</h2>
            <p className="mt-2 text-sm leading-7 text-(--muted)">
              GST is charged only when a GSTIN is written on the invoice. Startups may deduct TDS under §194J; share Form 16A. Request a full refund from support@vognary.com before the pilot month starts; after work begins, eligibility follows applicable law. The retired public checkout route is not used for this offer.
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
