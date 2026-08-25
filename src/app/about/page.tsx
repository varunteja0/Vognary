import type { Metadata } from "next";
import Link from "next/link";
import { VognaryMark } from "../brand";

export const metadata: Metadata = {
  title: "About",
  description: "What Vognary is building, how Commitment Intelligence works, and the product boundaries that protect financial truth.",
  alternates: { canonical: "/about" },
  openGraph: {
    url: "/about",
    title: "About - Vognary",
    description: "What Vognary is building, how Commitment Intelligence works, and the product boundaries that protect financial truth.",
  },
};

const principles = [
  {
    heading: "Evidence before inference",
    body: "Important amounts, dates, changes, and expected charges remain tied to billing evidence the user intentionally provides. When the evidence cannot support a financial fact, Vognary leaves it unknown instead of filling the gap with a plausible answer.",
  },
  {
    heading: "A decision before the charge",
    body: "Vognary turns receipts into a small review queue: what changed, what is expected next, why it needs attention, and whether the founder chose Keep, Review later, or Plan to cancel for that cycle.",
  },
  {
    heading: "Memory without pretending",
    body: "A saved workspace can remember cited evidence and decisions and compare them with later matching evidence. Missing evidence is still unknown. A plan to cancel is a recorded intention, never proof that a vendor was cancelled.",
  },
] as const;

export default function AboutPage() {
  return (
    <main id="ledger-main" className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <div className="flex gap-2">
            <Link href="/contact" className="btn btn-sm btn-ghost">Contact</Link>
            <Link href="/" className="btn btn-sm btn-ghost">Back</Link>
          </div>
        </div>

        <article className="panel p-6 sm:p-8">
          <span className="folio" data-folio="Company">About</span>
          <h1 className="mt-4 font-display text-3xl font-semibold text-(--ink) sm:text-4xl">Commitment Intelligence, built around evidence</h1>
          <p className="mt-3 text-sm leading-7 text-(--muted)">
            Vognary is built for founder-led software and AI companies that need to know what their tools are likely to charge next, what changed, and which bills deserve a decision before the card fires. It starts with receipts and invoices the company already has. The product is India-first and focused on small teams without dedicated finance or procurement operations.
          </p>

          <div className="mt-8 grid gap-6">
            {principles.map((principle) => (
              <section key={principle.heading} className="border-t border-line pt-5">
                <h2 className="font-display text-lg font-semibold text-(--ink)">{principle.heading}</h2>
                <p className="mt-2 text-sm leading-7 text-(--muted)">{principle.body}</p>
              </section>
            ))}
          </div>

          <section className="mt-8 border-t border-line pt-5">
            <h2 className="font-display text-lg font-semibold text-(--ink)">What Vognary does not claim</h2>
            <p className="mt-2 text-sm leading-7 text-(--muted)">
              Vognary is not a bank feed, mailbox-wide scanner, budgeting suite, procurement platform, or autonomous cancellation service. It does not ask for bank passwords, cancel vendors, or move money. Public examples demonstrate product behavior; they are not customer records, savings claims, or evidence of traction. Current control status and known limitations remain published on the security page.
            </p>
          </section>

          <div className="mt-8 flex flex-wrap gap-2.5 border-t border-line pt-5">
            <Link href="/start" className="btn btn-primary">Check a bill</Link>
            <Link href="/security" className="btn btn-ghost">Security and readiness</Link>
            <Link href="/privacy" className="btn btn-ghost">Privacy</Link>
          </div>
        </article>
      </div>
    </main>
  );
}