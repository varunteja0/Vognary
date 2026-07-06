import Link from "next/link";
import { VognaryMark } from "../brand";

export default function TermsPage() {
  return (
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <Link href="/" className="btn btn-ghost">Back to app</Link>
        </div>
        <article className="panel p-6 sm:p-8 rise">
          <span className="folio" data-folio="Trust">Terms</span>
          <h1 className="mt-4 font-display text-3xl font-semibold text-(--ink) sm:text-4xl">Terms</h1>
          <p className="mt-3 text-sm leading-7 text-(--muted)">Terms for using Vognary to review recurring payments.</p>
          <div className="mt-8 grid gap-4 text-sm leading-6 text-(--muted)">
            <p>Vognary provides software-generated recurring-payment analysis. It is not a bank, payment institution, investment adviser, insurance adviser, or legal adviser.</p>
            <p>Results are informational. Users must verify merchants, amounts, mandates, and cancellation paths before taking financial action.</p>
            <p>The current product does not store uploaded statements by default. Future hosted storage must include a reviewed privacy policy, deletion process, and security controls.</p>
            <p>Do not upload credentials, card numbers, UPI PINs, passwords, or documents you are not authorized to analyze.</p>
            <p>Production use with regulated financial data requires compliance review, security review, and approved integrations.</p>
          </div>
        </article>
      </div>
    </main>
  );
}