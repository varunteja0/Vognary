import Link from "next/link";
import { VognaryMark } from "./brand";

const checks = [
  {
    tag: "Scattered",
    title: "The renewal is never in one place",
    body: "One charge is in Gmail, one in a UPI mandate, one on a card, one inside a SaaS dashboard, and one inside a cloud bill.",
  },
  {
    tag: "Unproven",
    title: "A charge without proof is not a decision",
    body: "Vognary keeps the source beside every candidate: receipt, statement row, dashboard, mandate, invoice, or missing evidence.",
  },
  {
    tag: "Founder burn",
    title: "Small tools become invisible monthly burn",
    body: "AI, API, cloud, domains, design tools, app stores, insurance, SIPs, EMIs, and utilities all renew on different rails.",
  },
  {
    tag: "No owner",
    title: "Nobody owns the monthly review",
    body: "A useful audit should say what renews next, what can be cancelled, what needs a human check, and what source is still missing.",
  },
];

const steps = [
  { n: "1", title: "Connect evidence", body: "Start with Google receipts, then add official sources as they become available. No bank passwords." },
  { n: "2", title: "Prove the commitment", body: "Every recurring candidate carries source, confidence, amount, cadence, and next expected debit." },
  { n: "3", title: "Name what is missing", body: "If UPI, cards, app stores, bank debits, or SaaS dashboards are not connected, the gap is visible." },
  { n: "4", title: "Run the review", body: "Keep, watch, downgrade, cancel, or investigate before the next renewal silently hits." },
];

const trust = ["Proof over guesses", "No bank passwords", "Missing sources named", "Delete anytime"];

const userLanguage = [
  "I forgot what I am actually paying for.",
  "Subscriptions pile up across Stripe, GPay, bank debits, cards, and SaaS tools.",
  "Enterprise spend tools are overkill before we have finance or procurement.",
];

export default function Home() {
  return (
    <main id="ledger-main" className="relative px-4 pb-16 pt-4 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        {/* Sticky top navigation */}
        <nav className="glass sticky top-3 z-30 flex items-center justify-between gap-3 rounded-2xl border border-line px-4 py-2.5 sm:px-5">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={26} />
            Vognary
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            <a href="#solves" className="btn btn-sm btn-ondark border-transparent text-(--ink-soft)">What it solves</a>
            <a href="#how" className="btn btn-sm btn-ondark border-transparent text-(--ink-soft)">How it works</a>
            <Link href="/integrations" className="btn btn-sm btn-ondark border-transparent text-(--ink-soft)">Integrations</Link>
            <Link href="/security" className="btn btn-sm btn-ondark border-transparent text-(--ink-soft)">Security</Link>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/private-audit" className="btn btn-sm btn-ghost">Request audit</Link>
            <Link href="/login" className="btn btn-sm btn-primary">Sign in</Link>
          </div>
        </nav>

        {/* Hero + guided path */}
        <section className="dossier spotlight scan overflow-hidden">
          <div className="grid gap-0 lg:grid-cols-[1.35fr_1fr]">
            <div className="p-7 sm:p-10 lg:p-12">
              <span className="folio" data-folio="Start" style={{ color: "var(--dossier-muted)" }}>Evidence-first recurring money</span>
              <h1 className="mt-6 font-display text-4xl font-bold leading-[0.98] tracking-[-0.035em] text-(--dossier-ink) sm:text-6xl">
                Every renewal hides<br />in a different place.
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 muted-on-dark sm:text-lg">
                Vognary turns receipts, statements, mandates, invoices, SaaS bills, cloud spend, EMIs, SIPs, insurance, and utilities into one proof-backed monthly action review.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/login" className="btn btn-primary btn-lg">Find hidden renewals</Link>
                <Link href="/private-audit" className="btn btn-ondark btn-lg">Ask for a private audit</Link>
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
                {trust.map((item) => (
                  <span key={item} className="inline-flex items-center gap-1.5 font-data text-[0.66rem] uppercase tracking-[0.12em] muted-on-dark">
                    <span className="live-dot" aria-hidden />
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <div className="border-t border-(--dossier-line) p-7 sm:p-10 lg:border-l lg:border-t-0">
              <p className="eyebrow muted-on-dark">The pain users say out loud</p>
              <div className="mt-4 flex flex-col gap-3">
                {userLanguage.map((quote) => (
                  <blockquote key={quote} className="rounded-[10px] border p-3 text-sm leading-6 muted-on-dark" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
                    {quote}
                  </blockquote>
                ))}
              </div>
              <Link href="/login" className="btn btn-primary btn-block mt-6">Start the audit</Link>
            </div>
          </div>
        </section>

        {/* What this solves */}
        <section id="solves" className="scroll-mt-24">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="folio" data-folio="Solves">What this solves</span>
              <h2 className="mt-3 font-display text-2xl font-semibold text-(--ink) sm:text-3xl">The problem is not subscriptions. It is proof.</h2>
            </div>
            <p className="max-w-sm text-sm leading-6 text-(--muted)">Generic trackers make lists. Vognary shows what source proved each commitment, what renews next, and what source still has to be connected.</p>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {checks.map((item) => (
              <article key={item.title} className="panel lift flex flex-col p-5">
                <span className="pill pill-planned w-fit">{item.tag}</span>
                <h3 className="mt-4 font-display text-lg font-semibold text-(--ink)">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-(--muted)">{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-24">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="folio" data-folio="Flow">How it works</span>
              <h2 className="mt-3 font-display text-2xl font-semibold text-(--ink) sm:text-3xl">From scattered evidence to one review</h2>
            </div>
            <Link href="/sources" className="btn btn-ghost">How to add sources</Link>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <article key={step.title} className="panel flex flex-col p-5">
                <div className="flex items-center gap-3">
                  <span className="step-num">{step.n}</span>
                  {index < steps.length - 1 ? <span className="hidden h-px flex-1 bg-line lg:block" /> : null}
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold text-(--ink)">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-(--muted)">{step.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Honest beta boundary */}
        <section className="panel p-6 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <span className="folio" data-folio="Honest">Current beta boundary</span>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <div className="inset p-4">
                  <p className="font-data text-[0.66rem] uppercase tracking-[0.16em] text-verdict">The wedge</p>
                  <p className="mt-2 text-sm leading-6 text-(--ink-soft)">Start as a proof-backed recurring-money audit: Gmail receipts first, one ledger, evidence, confidence, next debit, action labels, and saved review snapshots when beta infrastructure is configured.</p>
                </div>
                <div className="inset p-4">
                  <p className="font-data text-[0.66rem] uppercase tracking-[0.16em] text-ochre">The honest gap</p>
                  <p className="mt-2 text-sm leading-6 text-(--muted)">Direct UPI/card mandate sync, Account Aggregator, user-wide app-store APIs, PayPal/Razorpay/Cashfree live sync, and cancellation automation need provider or partner access before they can be claimed.</p>
                </div>
              </div>
            </div>
            <Link href="/login" className="btn btn-primary btn-lg">Start the review</Link>
          </div>
        </section>

        {/* Footer */}
        <footer className="panel flex flex-col items-center gap-3 px-5 py-6 text-center">
          <div className="flex items-center gap-2.5">
            <VognaryMark size={22} className="text-(--ink)" />
            <span className="font-display text-base font-semibold text-(--ink)">Vognary <span className="font-normal text-(--muted)">· Recurring payments, reviewed</span></span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-data text-[0.66rem] uppercase tracking-[0.16em] text-(--muted)">
            <Link className="transition hover:text-(--ink)" href="/privacy">Privacy</Link>
            <span className="text-(--line-strong)">·</span>
            <Link className="transition hover:text-(--ink)" href="/security">Security</Link>
            <span className="text-(--line-strong)">·</span>
            <Link className="transition hover:text-(--ink)" href="/sources">Sources</Link>
            <span className="text-(--line-strong)">·</span>
            <Link className="transition hover:text-(--ink)" href="/integrations">Integrations</Link>
            <span className="text-(--line-strong)">·</span>
            <Link className="transition hover:text-(--ink)" href="/terms">Terms</Link>
            <span className="text-(--line-strong)">·</span>
            <Link className="transition hover:text-(--ink)" href="/login">Sign in</Link>
          </div>
        </footer>
      </div>
    </main>
  );
}