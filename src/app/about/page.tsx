import "../public.css";
import "../ledger.css";
import type { Metadata } from "next";
import Link from "next/link";
import { VognaryMark } from "../brand";

export const metadata: Metadata = {
  title: "About",
  description: "What Vognary is building, how Commitment Control works, and the product boundaries that protect financial truth.",
  alternates: { canonical: "/about" },
  openGraph: {
    url: "/about",
    title: "About - Vognary",
    description: "What Vognary is building, how Commitment Control works, and the product boundaries that protect financial truth.",
  },
};

const principles = [
  {
    heading: "Evidence before inference",
    body: "Important amounts, dates, changes, and expected charges remain tied to billing evidence the user intentionally provides. When the evidence cannot support a financial fact, Vognary leaves it unknown instead of filling the gap with a plausible answer. Proposal amounts are labeled as user-entered assumptions until later receipts prove an outcome.",
  },
  {
    heading: "A decision before the obligation",
    body: "Commitment Control records a proposed spend, cited existing exposure, and versioned policy, then a named owner or admin authorizes, caps, or declines. Policy annotates. It never auto-approves, auto-denies, purchases, or moves money.",
  },
  {
    heading: "Memory without pretending",
    body: "A saved workspace can remember cited evidence, frozen caps, and later reconciliations. Missing evidence is still unknown. An authorization is not proof that money was spent. A declined proposal is not proof a vendor was cancelled.",
  },
] as const;

export default function AboutPage() {
  return (
    <main id="ledger-main" className="relative px-4 pb-12 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line py-3">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <div className="flex gap-2">
            <Link href="/contact" className="btn btn-sm btn-ghost">Contact</Link>
            <Link href="/" className="btn btn-sm btn-ghost">Back</Link>
          </div>
        </div>

        <article className="public-ledger">
          <header className="public-ledger-rail">
          <span className="folio" data-folio="Company">About</span>
          <h1 className="mt-5 font-display text-4xl font-semibold leading-tight text-(--ink) sm:text-5xl">Commitment Control, built around evidence</h1>
          <p className="mt-5 text-sm leading-7 text-(--ink-soft)">
            Vognary is built for India-first, 20–100 person AI-native companies that need a named human to authorize a new obligation before it exists, then prove later spend against that frozen cap. It starts with receipts and invoices the company already has. Recovery remains the evidence foundation; Control is the authorization desk.
          </p>
          <div className="mt-6 grid gap-2">
            <Link href="/start" className="btn btn-primary btn-lg">Add a bill</Link>
            <Link href="/pay" prefetch={false} className="btn btn-ghost">Reserve the private pilot</Link>
          </div>
          </header>

          <div className="public-ledger-body">
          {principles.map((principle, index) => (
            <section key={principle.heading} className={`public-band ${index === 0 ? "public-band-lead" : ""}`}>
              <p className={`truth-label ${index === 0 ? "truth-citation" : index === 1 ? "truth-authority" : "truth-observed"}`}>Principle {index + 1}</p>
              <h2 className="mt-3 font-display text-xl font-semibold text-(--ink)">{principle.heading}</h2>
              <p className="mt-3 text-sm leading-7 text-(--muted)">{principle.body}</p>
            </section>
          ))}

          <section className="public-band">
            <p className="truth-label truth-frozen">Hard boundary</p>
            <h2 className="mt-3 font-display text-xl font-semibold text-(--ink)">What Vognary does not claim</h2>
            <p className="mt-3 text-sm leading-7 text-(--muted)">
              Vognary is not a bank feed, mailbox-wide scanner, budgeting suite, procurement platform, or autonomous cancellation service. It does not ask for bank passwords, cancel vendors, or move money. Public examples demonstrate product behavior; they are not customer records, savings claims, or evidence of traction. Current control status and known limitations remain published on the security page.
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <Link href="/security" className="btn btn-ghost">Security and readiness</Link>
              <Link href="/privacy" className="btn btn-ghost">Privacy</Link>
            </div>
          </section>
          </div>
        </article>
      </div>
    </main>
  );
}