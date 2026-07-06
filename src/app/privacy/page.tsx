import Link from "next/link";
import { VognaryMark } from "../brand";

export default function PrivacyPage() {
  return <TrustPage title="Privacy" intro="Vognary is designed to use the least data needed to review recurring payments." sections={sections} />;
}

const sections = [
  ["What happens today", "Statement/PDF import and audit calculations do not store uploaded financial documents, Gmail tokens, or report outputs on a backend by default."],
  ["Data sources", "You can connect available sources, upload statement exports, paste receipt text, or manually enter recurring payments."],
  ["No credentials", "Vognary does not ask for bank passwords, card numbers, UPI PINs, or netbanking credentials."],
  ["Account storage", "When account storage is used, uploaded files must be encrypted, deletable by the user, and access-audited."],
  ["Connected accounts", "The self-serve review works without an account. Connected-account sync needs auth, encryption, reviewed legal terms, and approved integrations."],
];

function TrustPage({ title, intro, sections }: { title: string; intro: string; sections: string[][] }) {
  return (
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <Link href="/app" className="btn btn-ghost">Back to app</Link>
        </div>
        <article className="panel p-6 sm:p-8 rise">
          <span className="folio" data-folio="Trust">Privacy</span>
          <h1 className="mt-4 font-display text-3xl font-semibold text-(--ink) sm:text-4xl">{title}</h1>
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