import "../../public.css";
import "../../ledger.css";
import type { Metadata } from "next";
import Link from "next/link";
import { VognaryMark } from "../../brand";
import BillingReturnClient from "./billing-return-client";

export const metadata: Metadata = {
  title: "Payment status · Vognary",
  description: "Check the settlement status of a Vognary checkout. Settlement is confirmed by Razorpay's signed webhook, not by this page loading.",
  robots: { index: false, follow: false },
};

export default async function BillingReturnPage({ searchParams }: { searchParams: Promise<{ checkout?: string | string[] }> }) {
  const resolved = await searchParams;
  const checkoutParam = Array.isArray(resolved.checkout) ? resolved.checkout[0] : resolved.checkout;

  return (
    <main className="relative px-4 pb-12 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line py-3">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <Link href="/app" className="btn btn-ghost">Open Vognary</Link>
        </div>

        <article className="public-ledger">
          <header className="public-ledger-rail">
          <span className="folio" data-folio="Billing">Payment status</span>
          <h1 className="mt-5 font-display text-4xl font-semibold leading-tight text-(--ink) sm:text-5xl">Your payment status</h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-(--ink-soft)">
            Settlement is confirmed by Razorpay&apos;s signed webhook. If you just paid, this page may show pending
            for a short moment while that confirmation arrives; it refreshes automatically.
          </p>
          <div className="mt-6 border-l-2 border-ochre pl-4">
            <p className="font-data text-xs font-semibold text-ochre">WEBHOOK IS THE AUTHORITY</p>
            <p className="mt-2 text-sm leading-6 text-(--muted)">Loading this page cannot mark a payment settled.</p>
          </div>
          </header>

          <div className="public-ledger-body">
          <section className="public-band public-band-lead">
          <p className="truth-label truth-observed">Provider settlement record</p>
          <BillingReturnClient checkoutId={checkoutParam ?? null} />
          </section>

          <section className="public-band">
            <p className="truth-label truth-policy">Before you leave</p>
            <h2 className="mt-3 font-display text-xl font-semibold text-(--ink)">Keep the provider record</h2>
            <ul className="reason-list mt-4">
              <li>Keep the payment confirmation shown by Razorpay. Vognary does not claim settlement until the signed webhook is processed.</li>
              <li>Settlement is not activation. A founder enables Commitment Control by reply to the email used at checkout.</li>
              <li>If status remains unavailable, email support@vognary.com with the checkout reference shown in the return-page URL. Do not send card or bank credentials.</li>
            </ul>
          </section>
          </div>
        </article>
      </div>
    </main>
  );
}
