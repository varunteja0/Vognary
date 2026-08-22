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
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <Link href="/app" className="btn btn-ghost">Open Vognary</Link>
        </div>

        <article className="panel p-6 sm:p-8 rise">
          <span className="folio" data-folio="Billing">Payment status</span>
          <h1 className="mt-4 font-display text-3xl font-semibold text-(--ink) sm:text-4xl">Your payment status</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-(--muted)">
            Settlement is confirmed by Razorpay&apos;s signed webhook. If you just paid, this page may show pending
            for a short moment while that confirmation arrives; it refreshes automatically.
          </p>

          <BillingReturnClient checkoutId={checkoutParam ?? null} />

          <div className="mt-6 inset p-4">
            <p className="eyebrow eyebrow-xs">Good to know</p>
            <ul className="mt-2 grid gap-1.5 text-sm leading-6 text-(--muted)">
              <li>— Keep the payment confirmation shown by Razorpay. Vognary does not claim settlement until the signed webhook is processed.</li>
              <li>— A paid private audit is delivered by reply to the email you used in the audit request.</li>
              <li>— If status remains unavailable, email support@vognary.com with the checkout reference shown in the return-page URL. Do not send card or bank credentials.</li>
            </ul>
          </div>
        </article>
      </div>
    </main>
  );
}
