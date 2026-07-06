import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="font-display text-lg font-semibold text-(--ink)">Vognary <span className="text-(--muted)">· The Silent Ledger</span></Link>
          <Link href="/" className="btn btn-ghost">Back to ledger</Link>
        </div>
        <article className="panel p-6 sm:p-8 rise">
          <span className="folio" data-folio="§ T3">Trust</span>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-(--ink) sm:text-5xl">Terms</h1>
          <p className="mt-3 text-sm leading-7 text-(--muted)">Terms for using Vognary as a self-serve recurring-money audit tool.</p>
          <div className="mt-8 grid gap-4 text-sm leading-6 text-(--muted)">
            <p>Vognary provides software-generated recurring-payment analysis. It is not a bank, payment institution, investment adviser, insurance adviser, or legal adviser.</p>
            <p>Audit results are informational. Users must verify merchants, amounts, mandates, and cancellation paths before taking financial action.</p>
            <p>The current MVP is stateless and does not persist uploaded statements. Future hosted storage must be governed by a reviewed privacy policy, deletion process, and security controls.</p>
            <p>Do not upload credentials, card numbers, UPI PINs, passwords, or documents you are not authorized to analyze.</p>
            <p>Production use with regulated financial data requires compliance review, security review, and approved integrations.</p>
          </div>
        </article>
      </div>
    </main>
  );
}