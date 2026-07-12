import type { Metadata } from "next";
import Link from "next/link";
import { VognaryMark } from "../brand";

export const metadata: Metadata = {
  title: "Data and payment partners",
  description: "The technical, consent, security, and launch requirements for approved Vognary connector and regulated-rail partners.",
};

const partnerTracks = [
  {
    title: "Account Aggregator / FIU / TSP",
    body: "Consent-bound deposit, transaction, and recurring-debit evidence through an approved Indian Account Aggregator path. Production status requires a contracted role model, purpose codes, consent artefacts, data minimization, revocation, and audit evidence.",
  },
  {
    title: "Bank, issuer, network, PSP",
    body: "Read-only UPI AutoPay, card e-mandate, standing-instruction, and pre-debit status. Vognary does not request PINs, CVVs, bank passwords, or screen-scraping access.",
  },
  {
    title: "SaaS, cloud, and billing provider",
    body: "Official OAuth, scoped API keys, IAM roles, or signed webhooks for subscription, invoice, renewal, usage, domain, and cost evidence. Credentials are encrypted and disconnected accounts stop future sync.",
  },
];

const launchGates = [
  "Documented data fields, lawful purpose, consent and revocation lifecycle",
  "Stable sandbox plus test identities and deterministic replay fixtures",
  "Least-privilege scopes, token rotation, signed webhooks and idempotency",
  "Coverage-window, cursor, rate-limit, retry and incident contracts",
  "Joint privacy, security, legal and user-copy review before production",
  "One successful consent → sync → disconnect → deletion production rehearsal",
];

export default function PartnersPage() {
  return (
    <main id="ledger-main" className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <nav className="mb-5 flex flex-wrap items-center justify-between gap-3" aria-label="Partner page">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} /> Vognary
          </Link>
          <div className="flex flex-wrap gap-2">
            <Link href="/integrations" className="btn btn-ghost">Integration status</Link>
            <a href="mailto:partners@vognary.com" className="btn btn-primary">Start a partner review</a>
          </div>
        </nav>

        <section className="dossier spotlight scan p-7 sm:p-10 rise">
          <span className="folio" data-folio="Partner" style={{ color: "var(--dossier-muted)" }}>Approved rails only</span>
          <h1 className="mt-5 max-w-4xl font-display text-4xl font-bold leading-[0.98] tracking-[-0.04em] text-(--dossier-ink) sm:text-6xl">Build the trusted recurring-money graph with us.</h1>
          <p className="mt-6 max-w-3xl text-base leading-8 muted-on-dark">Vognary is ready to integrate official evidence rails. A listing is not a launch claim: every partner moves through technical, consent, security, deletion, and production-rehearsal gates before users see it as connected.</p>
        </section>

        <section className="mt-5 grid gap-4 lg:grid-cols-3">
          {partnerTracks.map((track) => (
            <article key={track.title} className="panel p-5 sm:p-6">
              <h2 className="font-display text-xl font-semibold text-(--ink)">{track.title}</h2>
              <p className="mt-3 text-sm leading-7 text-(--muted)">{track.body}</p>
            </article>
          ))}
        </section>

        <section className="panel mt-5 p-5 sm:p-7">
          <div className="grid gap-6 lg:grid-cols-[0.75fr_1.25fr]">
            <div>
              <p className="eyebrow">Production gate</p>
              <h2 className="mt-3 font-display text-3xl font-semibold text-(--ink)">What “integrated” means</h2>
              <p className="mt-3 text-sm leading-7 text-(--muted)">The public connector registry distinguishes implemented, setup-ready, partner-gated, evidence-only, and planned paths. The weakest unmet requirement controls the status.</p>
              <a href="/api/connectors" className="btn btn-ghost mt-4">View machine-readable registry</a>
            </div>
            <ol className="grid gap-2">
              {launchGates.map((gate, index) => (
                <li key={gate} className="inset flex gap-3 p-3 text-sm leading-6 text-(--muted)">
                  <span className="font-data font-semibold text-ember">{String(index + 1).padStart(2, "0")}</span>
                  <span>{gate}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="panel mt-5 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div>
            <h2 className="font-display text-2xl font-semibold text-(--ink)">Bring a real sandbox and named data contract.</h2>
            <p className="mt-2 text-sm leading-6 text-(--muted)">We will return a field map, consent flow, threat review, launch checklist, and honest user-facing status.</p>
          </div>
          <a href="mailto:partners@vognary.com?subject=Vognary%20partner%20integration" className="btn btn-primary shrink-0">partners@vognary.com</a>
        </section>
      </div>
    </main>
  );
}
