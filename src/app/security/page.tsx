export default function SecurityPage() {
  return (
    <main className="min-h-screen px-5 py-10 text-foreground sm:px-8">
      <article className="mx-auto max-w-3xl rounded-lg border border-line bg-(--surface) p-6 shadow-sm">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-(--accent)">Vognary Trust</p>
        <h1 className="mt-3 text-4xl font-semibold text-[#151712]">Security Model</h1>
        <p className="mt-3 text-sm leading-6 text-(--muted)">Vognary runs self-serve stateless audits today, then graduates to encrypted persistence only when connected-account sync is enabled.</p>
        <div className="mt-8 grid gap-4">
          {items.map((item) => (
            <div key={item.title} className="rounded-md border border-line bg-[#fbfcf8] p-4">
              <h2 className="text-base font-semibold text-[#151712]">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-(--muted)">{item.body}</p>
            </div>
          ))}
        </div>
      </article>
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