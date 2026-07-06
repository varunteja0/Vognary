export default function TermsPage() {
  return (
    <main className="min-h-screen px-5 py-10 text-foreground sm:px-8">
      <article className="mx-auto max-w-3xl rounded-lg border border-line bg-(--surface) p-6 shadow-sm">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-(--accent)">Vognary Trust</p>
        <h1 className="mt-3 text-4xl font-semibold text-[#151712]">Terms</h1>
        <p className="mt-3 text-sm leading-6 text-(--muted)">Terms for using Vognary as a self-serve recurring-money audit tool.</p>
        <div className="mt-8 grid gap-5 text-sm leading-6 text-(--muted)">
          <p>Vognary provides software-generated recurring-payment analysis. It is not a bank, payment institution, investment adviser, insurance adviser, or legal adviser.</p>
          <p>Audit results are informational. Users must verify merchants, amounts, mandates, and cancellation paths before taking financial action.</p>
          <p>The current MVP is stateless and does not persist uploaded statements. Future hosted storage must be governed by a reviewed privacy policy, deletion process, and security controls.</p>
          <p>Do not upload credentials, card numbers, UPI PINs, passwords, or documents you are not authorized to analyze.</p>
          <p>Production use with regulated financial data requires compliance review, security review, and approved integrations.</p>
        </div>
      </article>
    </main>
  );
}