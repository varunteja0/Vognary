import Link from "next/link";

export default function PrivacyPage() {
  return <TrustPage title="Privacy" intro="Vognary is built for self-serve recurring-payment audits with a data-minimization posture from day one." sections={sections} />;
}

const sections = [
  ["Current Product", "Statement/PDF ingestion and audit calculations are stateless. The browser workflow and stateless APIs do not persist uploaded financial documents, Gmail tokens, or report outputs."],
  ["Data Sources", "Users may connect available sources, upload fallback statement exports, paste receipt text, or manually enter recurring commitments. Gmail is only available when read-only OAuth credentials are configured."],
  ["No Credential Collection", "Vognary does not ask for bank passwords, card numbers, UPI PINs, or netbanking credentials."],
  ["Future Storage", "When accounts and storage are added, uploaded files must be encrypted at rest, deletable by the user, and access-audited."],
  ["Connected Account Boundary", "The self-serve audit works without accounts. Connected-account sync requires auth, encryption, reviewed legal terms, and approved integrations before storing financial documents."],
];

function TrustPage({ title, intro, sections }: { title: string; intro: string; sections: string[][] }) {
  return (
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="font-display text-lg font-semibold text-(--ink)">Vognary <span className="text-(--muted)">· The Silent Ledger</span></Link>
          <Link href="/" className="btn btn-ghost">Back to ledger</Link>
        </div>
        <article className="panel p-6 sm:p-8 rise">
          <span className="folio" data-folio="§ T2">Trust</span>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-(--ink) sm:text-5xl">{title}</h1>
          <p className="mt-3 text-sm leading-7 text-(--muted)">{intro}</p>
          <div className="mt-8 grid gap-5">
            {sections.map(([heading, body]) => (
              <section key={heading}>
                <h2 className="font-display text-lg font-semibold text-(--ink)">{heading}</h2>
                <p className="mt-2 text-sm leading-6 text-(--muted)">{body}</p>
              </section>
            ))}
          </div>
        </article>
      </div>
    </main>
  );
}