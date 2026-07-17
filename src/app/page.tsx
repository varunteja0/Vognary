import Link from "next/link";
import { VognaryMark } from "./brand";
import { Nakul } from "./character";

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

const firstResult = [
  "Your recurring monthly total",
  "The next renewal date",
  "One ranked action with its source proof",
];

const proofRows = [
  { source: "Gmail receipts", proves: "Invoices, renewals, trial reminders, payment-success emails", status: "First connector" },
  { source: "SaaS and cloud dashboards", proves: "AI/API usage, paid plans, domains, seats, cloud commitments", status: "Provider path" },
  { source: "Statements and mandates", proves: "Bank debits, card repeats, UPI AutoPay, EMIs, SIPs, utilities", status: "Audit evidence" },
  { source: "Partner rails", proves: "Direct UPI/card mandate state and regulated account data", status: "Needs approval" },
];

const productLedgerRows = [
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
            <a href="#product-ledger" className="btn btn-sm btn-ondark border-transparent text-(--ink-soft)">Product output</a>
            <a href="#how" className="btn btn-sm btn-ondark border-transparent text-(--ink-soft)">How it works</a>
            <Link href="/guide" className="btn btn-sm btn-ondark border-transparent text-(--ink-soft)">Guide</Link>
            <Link href="/security" className="btn btn-sm btn-ondark border-transparent text-(--ink-soft)">Security</Link>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/app" prefetch={false} className="btn btn-sm btn-primary">Start audit</Link>
          </div>
        </nav>

        {/* Hero + guided path */}
        <section className="dossier spotlight scan overflow-hidden">
          <div className="grid gap-0 lg:grid-cols-[1.35fr_1fr]">
            <div className="p-7 sm:p-10 lg:p-12">
              <span className="folio" data-folio="Start" style={{ color: "var(--dossier-muted)" }}>Evidence-first recurring money</span>
              <h1 className="mt-6 font-display text-4xl font-bold leading-[0.98] tracking-[-0.035em] text-(--dossier-ink) sm:text-6xl">
                Find what renews next.<br />Act before it charges.
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 muted-on-dark sm:text-lg">
                Paste receipts or invoices and get your monthly burn, next renewal, and one evidence-backed action—without creating an account.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/app" prefetch={false} className="btn btn-primary btn-lg">Audit my recurring spend</Link>
                <a href="#product-ledger" className="btn btn-ondark btn-lg">See product output</a>
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
            <div className="relative border-t border-(--dossier-line) p-7 sm:p-10 lg:border-l lg:border-t-0">
              <p className="eyebrow muted-on-dark">Your first result</p>
              <div className="mt-4 flex flex-col gap-3">
                {firstResult.map((item) => (
                  <div key={item} className="rounded-[10px] border p-3 text-sm leading-6 muted-on-dark" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
                    {item}
                  </div>
                ))}
              </div>
              <Link href="/app" prefetch={false} className="btn btn-primary btn-block mt-6">Start with receipt paste</Link>
              <div className="mt-6 flex items-end justify-between gap-3 border-t border-(--dossier-line) pt-5">
                <p className="max-w-[15rem] text-xs leading-5 muted-on-dark">
                  Nakul, the ledger mongoose, watches every commitment you prove — and flags the renewal before it charges.
                </p>
                <Nakul pose="sentinel" size={84} className="shrink-0 text-(--dossier-ink)" title="Nakul, the ledger mongoose" />
              </div>
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

        {/* Product ledger result */}
        <section id="product-ledger" className="panel scroll-mt-24 overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-line px-5 py-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <span className="folio" data-folio="Product">Recurring audit output</span>
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

          <div className="divide-y divide-line sm:hidden" aria-label="Recurring spend audit output">
            {productLedgerRows.map((row) => (
              <article key={row.merchant} className="grid gap-3 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-(--ink)">{row.merchant}</h3>
                    <p className="font-data mt-1 text-xs text-(--muted)">{row.source}</p>
                  </div>
                  <span className={row.actionClass}>{row.action}</span>
                </div>
                <dl className="grid grid-cols-2 gap-3">
                  <div><dt className="eyebrow">Monthly</dt><dd className="font-data mt-1 tnum text-(--ink-soft)">{row.monthly}</dd></div>
                  <div><dt className="eyebrow">Renews</dt><dd className="font-data mt-1 text-(--ink-soft)">{row.renews}</dd></div>
                </dl>
                <p className="text-sm leading-6 text-(--muted)">{row.proof}</p>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto sm:block" role="region" aria-label="Recurring spend audit output table" tabIndex={0}>
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
                {productLedgerRows.map((row) => (
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
              <Link href="/app" prefetch={false} className="btn btn-primary">Open Vognary</Link>
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
          <div className="mt-6 divide-y divide-line rounded-[11px] border border-line sm:hidden" aria-label="Evidence source coverage">
            {proofRows.map((row) => (
              <article key={row.source} className="grid gap-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold text-(--ink)">{row.source}</h3>
                  <span className="pill pill-partial">{row.status}</span>
                </div>
                <p className="text-sm leading-6 text-(--ink-soft)">{row.proves}</p>
              </article>
            ))}
          </div>
          <div className="mt-6 hidden overflow-x-auto rounded-[11px] border border-line sm:block" role="region" aria-label="Evidence source coverage table" tabIndex={0}>
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

        {/* Verified savings — proved, not promised */}
        <section id="proved" className="dossier spotlight scroll-mt-24 overflow-hidden">
          <div className="grid gap-0 lg:grid-cols-[1fr_0.9fr]">
            <div className="p-7 sm:p-10">
              <span className="folio" data-folio="Proved" style={{ color: "var(--dossier-muted)" }}>Verified savings</span>
              <h2 className="mt-4 font-display text-3xl font-semibold text-(--dossier-ink) sm:text-4xl">
                Every tracker recommends cancels.<br />Vognary proves the money stopped leaving.
              </h2>
              <p className="mt-5 max-w-xl text-sm leading-7 muted-on-dark sm:text-base">
                After you cancel, the engine keeps watching the exact debit dates it predicted for that commitment.
                When they pass clean inside evidence that actually covers them, the saving is marked <em>verified</em> —
                proof by absence. You can mint it as a sealed receipt and a share card; anyone can check the number
                at <Link href="/verify" className="underline underline-offset-4">/verify</Link> without seeing your data.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/app" prefetch={false} className="btn btn-primary">Start proving savings</Link>
                <Link href="/guide" className="btn btn-ondark">Read how verification works</Link>
              </div>
            </div>
            <div className="flex items-center justify-center border-t border-(--dossier-line) p-7 sm:p-10 lg:border-l lg:border-t-0">
              <div className="w-full max-w-sm rounded-2xl border border-(--gold-line) bg-[#0e1013] p-6" aria-hidden>
                <p className="font-data text-[0.62rem] uppercase tracking-[0.2em] text-(--gold)">Verified savings receipt</p>
                <p className="mt-3 font-display text-4xl font-bold text-(--gold)">₹43,164<span className="text-xl">/yr</span></p>
                <p className="mt-1 text-sm text-(--dossier-ink)">verifiably stopped leaving this account</p>
                <p className="mt-3 font-data text-[0.66rem] text-(--dossier-muted)">3 recurring charges · proven by evidence of absence</p>
                <div className="mt-4 flex items-end justify-between border-t border-(--dossier-line) pt-4">
                  <p className="font-data text-[0.62rem] text-(--dossier-muted)">Check any receipt at<br />vognary.com/verify</p>
                  <Nakul pose="celebrate" size={64} className="text-(--dossier-ink)" />
                </div>
              </div>
            </div>
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

        {/* Honest capability boundary */}
        <section className="panel p-6 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <span className="folio" data-folio="Honest">Current capability boundary</span>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <div className="inset p-4">
                  <p className="font-data text-[0.66rem] uppercase tracking-[0.16em] text-verdict">The wedge</p>
                  <p className="mt-2 text-sm leading-6 text-(--ink-soft)">Start as a proof-backed recurring-money audit: receipt paste first, one ledger, evidence, confidence, next debit, action labels, and encrypted workspace sync when deployment infrastructure is configured.</p>
                </div>
                <div className="inset p-4">
                  <p className="font-data text-[0.66rem] uppercase tracking-[0.16em] text-ochre">The honest gap</p>
                  <p className="mt-2 text-sm leading-6 text-(--muted)">Direct UPI/card mandate sync, Account Aggregator, user-wide app-store APIs, PayPal/Razorpay/Cashfree live sync, and cancellation automation need provider or partner access before they can be claimed.</p>
                </div>
              </div>
            </div>
            <Link href="/app" prefetch={false} className="btn btn-primary btn-lg">Start with receipts</Link>
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
            <Link className="transition hover:text-(--ink)" href="/sources">Sources</Link>
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
