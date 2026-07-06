export default function PrivacyPage() {
  return <TrustPage title="Privacy" intro="Vognary is built for self-serve recurring-payment audits with a data-minimization posture from day one." sections={sections} />;
}

const sections = [
  ["Current MVP", "CSV/PDF ingestion and audit calculations are stateless. The browser workflow and stateless APIs do not persist uploaded financial documents, Gmail tokens, or report outputs."],
  ["Data Sources", "Users may upload CSV/PDF statements, paste CSV text, or manually enter recurring commitments. Gmail is only available when read-only OAuth credentials are configured."],
  ["No Credential Collection", "Vognary does not ask for bank passwords, card numbers, UPI PINs, or netbanking credentials."],
  ["Future Storage", "When accounts and storage are added, uploaded files must be encrypted at rest, deletable by the user, and access-audited."],
  ["Connected Account Boundary", "The self-serve audit works without accounts. Connected-account sync requires auth, encryption, reviewed legal terms, and approved integrations before storing financial documents."],
];

function TrustPage({ title, intro, sections }: { title: string; intro: string; sections: string[][] }) {
  return (
    <main className="min-h-screen px-5 py-10 text-foreground sm:px-8">
      <article className="mx-auto max-w-3xl rounded-lg border border-line bg-(--surface) p-6 shadow-sm">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-(--accent)">Vognary Trust</p>
        <h1 className="mt-3 text-4xl font-semibold text-[#151712]">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-(--muted)">{intro}</p>
        <div className="mt-8 grid gap-5">
          {sections.map(([heading, body]) => (
            <section key={heading}>
              <h2 className="text-lg font-semibold text-[#151712]">{heading}</h2>
              <p className="mt-2 text-sm leading-6 text-(--muted)">{body}</p>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}