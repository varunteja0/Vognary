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

const proofRows = [
  { source: "Gmail receipts", proves: "Invoices, renewals, trial reminders, payment-success emails", status: "First connector" },
  { source: "SaaS and cloud dashboards", proves: "AI/API usage, paid plans, domains, seats, cloud commitments", status: "Provider path" },
  { source: "Statements and mandates", proves: "Bank debits, card repeats, UPI AutoPay, EMIs, SIPs, utilities", status: "Audit evidence" },
  { source: "Partner rails", proves: "Direct UPI/card mandate state and regulated account data", status: "Needs approval" },
];

const sampleAuditRows = [
  { merchant: "OpenAI / ChatGPT", monthly: "INR 1,999", renews: "Aug 6", source: "Gmail receipt", proof: "Paid invoice found; usage source still missing", action: "downgrade", actionClass: "stamp stamp-downgrade" },
  { merchant: "Vercel Pro", monthly: "INR 1,600", renews: "Jul 18", source: "Dashboard path", proof: "Team plan renewal; project usage should be checked", action: "watch", actionClass: "stamp stamp-watch" },
  { merchant: "Domain renewal", monthly: "INR 100", renews: "Sep 10", source: "Registrar email", proof: "Annual renewal normalized into monthly burn", action: "keep", actionClass: "stamp stamp-keep" },
  { merchant: "UPI AutoPay mandate", monthly: "INR 999", renews: "Unknown", source: "Missing proof", proof: "Needs UPI app, bank, PSP, or partner source before decision", action: "investigate", actionClass: "stamp stamp-investigate" },
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
            <a href="#sample-audit" className="btn btn-sm btn-ondark border-transparent text-(--ink-soft)">Sample audit</a>
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
                <Link href="/app?demo=1" className="btn btn-primary btn-lg">Try sample workspace</Link>
                <Link href="/app?guest=1" className="btn btn-ondark btn-lg">Start with my data</Link>
                <a href="#sample-audit" className="btn btn-ondark btn-lg">See sample audit</a>
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
              <Link href="/app?demo=1" className="btn btn-primary btn-block mt-6">Open a working sample</Link>
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

        {/* Sample audit result */}
        <section id="sample-audit" className="panel scroll-mt-24 overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-line px-5 py-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <span className="folio" data-folio="Demo">Sample audit result</span>
              <h2 className="mt-3 font-display text-2xl font-semibold text-(--ink) sm:text-3xl">What a useful review should show in five minutes.</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">A ledger row is useful only when it carries amount, renewal timing, proof, missing source, and a decision label.</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="inset px-3 py-2">
                <p className="eyebrow" style={{ fontSize: "0.58rem" }}>Monthly</p>
                <p className="font-data mt-1 text-sm font-semibold tnum text-(--ink)">INR 4,698</p>
              </div>
              <div className="inset px-3 py-2">
                <p className="eyebrow" style={{ fontSize: "0.58rem" }}>Review</p>
                <p className="font-data mt-1 text-sm font-semibold tnum text-(--ink)">INR 4,598</p>
              </div>
              <div className="inset px-3 py-2">
                <p className="eyebrow" style={{ fontSize: "0.58rem" }}>Missing</p>
                <p className="font-data mt-1 text-sm font-semibold tnum text-(--ink)">1 source</p>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-220 border-separate border-spacing-0 text-left text-sm">
              <thead>
                <tr>
                  <th className="border-b border-line bg-(--card-2) px-5 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Merchant</th>
                  <th className="border-b border-line bg-(--card-2) px-5 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Monthly</th>
                  <th className="border-b border-line bg-(--card-2) px-5 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Renews</th>
                  <th className="border-b border-line bg-(--card-2) px-5 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Source</th>
                  <th className="border-b border-line bg-(--card-2) px-5 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Proof / gap</th>
                  <th className="border-b border-line bg-(--card-2) px-5 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Action</th>
                </tr>
              </thead>
              <tbody>
                {sampleAuditRows.map((row) => (
                  <tr key={row.merchant}>
                    <td className="border-b border-line px-5 py-3.5 font-semibold text-(--ink)">{row.merchant}</td>
                    <td className="border-b border-line px-5 py-3.5 font-data tnum text-(--ink-soft)">{row.monthly}</td>
                    <td className="border-b border-line px-5 py-3.5 font-data text-xs text-(--muted)">{row.renews}</td>
                    <td className="border-b border-line px-5 py-3.5 text-(--ink-soft)">{row.source}</td>
                    <td className="border-b border-line px-5 py-3.5 text-(--muted)">{row.proof}</td>
                    <td className="border-b border-line px-5 py-3.5"><span className={row.actionClass}>{row.action}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-(--muted)">This is the product promise: not a list of subscriptions, but a reviewable evidence table with gaps called out honestly.</p>
            <div className="flex flex-wrap gap-2">
              <Link href="/app?demo=1" className="btn btn-primary">Open sample workspace</Link>
              <Link href="/private-audit" className="btn btn-ghost">Request this audit</Link>
            </div>
          </div>
        </section>

        {/* Proof map */}
        <section className="panel p-6 sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="folio" data-folio="Proof">What gets proven</span>
              <h2 className="mt-3 font-display text-2xl font-semibold text-(--ink) sm:text-3xl">One ledger only matters if every row has a source.</h2>
            </div>
            <p className="max-w-sm text-sm leading-6 text-(--muted)">The product job is not to pretend every rail is connected. It is to prove what can be proven now and name the missing source clearly.</p>
          </div>
          <div className="mt-6 overflow-x-auto rounded-[11px] border border-line">
            <table className="w-full min-w-180 border-separate border-spacing-0 text-left text-sm">
              <thead>
                <tr>
                  <th className="border-b border-line bg-(--card-2) px-4 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Source</th>
                  <th className="border-b border-line bg-(--card-2) px-4 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">What it proves</th>
                  <th className="border-b border-line bg-(--card-2) px-4 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Current path</th>
                </tr>
              </thead>
              <tbody>
                {proofRows.map((row) => (
                  <tr key={row.source}>
                    <td className="border-b border-line px-4 py-3 font-semibold text-(--ink)">{row.source}</td>
                    <td className="border-b border-line px-4 py-3 text-(--ink-soft)">{row.proves}</td>
                    <td className="border-b border-line px-4 py-3"><span className="pill pill-partial">{row.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
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