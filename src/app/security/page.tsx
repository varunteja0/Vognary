import Link from "next/link";

export default function SecurityPage() {
  return (
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="font-display text-lg font-semibold text-(--ink)">Vognary <span className="text-(--muted)">· The Silent Ledger</span></Link>
          <Link href="/" className="btn btn-ghost">Back to ledger</Link>
        </div>
        <article className="panel p-6 sm:p-8 rise">
          <span className="folio" data-folio="§ T1">Trust</span>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-(--ink) sm:text-5xl">Security model</h1>
          <p className="mt-3 text-sm leading-7 text-(--muted)">Vognary runs self-serve stateless audits today, then graduates to encrypted persistence only when connected-account sync is enabled.</p>
          <div className="mt-8 grid gap-3">
            {items.map((item) => (
              <div key={item.title} className="inset p-4">
                <h2 className="font-display text-base font-semibold text-(--ink)">{item.title}</h2>
                <p className="mt-2 text-sm leading-6 text-(--muted)">{item.body}</p>
              </div>
            ))}
          </div>
        </article>
      </div>
    </main>
  );
}

const items = [
  { title: "No credential collection", body: "The product must never collect bank passwords, card PINs, UPI PINs, or netbanking credentials." },
  { title: "Stateless beta APIs", body: "The current audit, ingestion, and Gmail-preview APIs process request data and return results without database persistence." },
  { title: "Evidence-first recommendations", body: "Every recommendation must link back to transaction or receipt evidence so users can verify before acting." },
  { title: "Future encrypted storage", body: "When accounts ship, financial files must be encrypted at rest, access logged, and deletable by users." },
  { title: "Integration approvals", body: "Gmail, Account Aggregator, UPI, and card-mandate integrations require approved scopes, partner paths, and legal review." },
];