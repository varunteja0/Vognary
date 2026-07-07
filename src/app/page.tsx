import Link from "next/link";
import { VognaryMark } from "./brand";

const checks = [
  {
    tag: "Receipts",
    title: "Gmail receipt history",
    body: "Invoices, renewal notices, free-trial reminders, and payment-success emails — turned into candidates.",
  },
  {
    tag: "SaaS & AI",
    title: "Tools you already pay for",
    body: "Claude, OpenAI, Cursor, Kling, X, Notion, and Figma — your whole stack in one list.",
  },
  {
    tag: "Cloud",
    title: "Developer and cloud bills",
    body: "Render, Vercel, GitHub, AWS, and Cloudflare charges tracked beside everything else.",
  },
  {
    tag: "Mandates",
    title: "Auto-debits and commitments",
    body: "UPI AutoPay, card mandates, domains, insurance, EMIs, and SIPs — money that leaves on a schedule.",
  },
];

const steps = [
  { n: "1", title: "Sign in", body: "Use Google to create your private workspace. No bank passwords, ever." },
  { n: "2", title: "Connect Gmail", body: "Approve the official Google consent screen so Vognary can read receipt-like messages." },
  { n: "3", title: "Review one ledger", body: "See merchant, amount, renewal date, confidence, source, and the next action in a single list." },
  { n: "4", title: "Save and repeat", body: "Save an encrypted snapshot, return monthly, and add more official sources as they go live." },
];

const trust = ["No bank passwords", "Encrypted snapshots", "Delete anytime", "Runs in your workspace"];

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
              <span className="folio" data-folio="Start" style={{ color: "var(--dossier-muted)" }}>Recurring payments, reviewed</span>
              <h1 className="mt-6 font-display text-4xl font-bold leading-[0.98] tracking-[-0.035em] text-(--dossier-ink) sm:text-6xl">
                See what is renewing<br />before money leaves.
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 muted-on-dark sm:text-lg">
                Connect Gmail once. Vognary scans your receipt history and builds a single recurring-payment ledger — renewals, invoices, trials, cloud bills, mandates, insurance, EMIs, and SIPs.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/login" className="btn btn-primary btn-lg">Start with Google</Link>
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
              <p className="eyebrow muted-on-dark">The guided path</p>
              <ol className="mt-4 flex flex-col gap-4">
                {steps.map((step) => (
                  <li key={step.n} className="flex items-start gap-3">
                    <span className="step-num shrink-0">{step.n}</span>
                    <div className="min-w-0">
                      <p className="font-display text-sm font-semibold text-(--dossier-ink)">{step.title}</p>
                      <p className="mt-0.5 text-xs leading-5 muted-on-dark">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <Link href="/login" className="btn btn-primary btn-block mt-6">Connect Gmail</Link>
            </div>
          </div>
        </section>

        {/* What this solves */}
        <section id="solves" className="scroll-mt-24">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="folio" data-folio="Solves">What this solves</span>
              <h2 className="mt-3 font-display text-2xl font-semibold text-(--ink) sm:text-3xl">One place for every recurring commitment</h2>
            </div>
            <p className="max-w-sm text-sm leading-6 text-(--muted)">Stop hunting through inboxes, dashboards, and statements. Everything that renews lands in a single reviewable ledger.</p>
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
              <h2 className="mt-3 font-display text-2xl font-semibold text-(--ink) sm:text-3xl">Four steps, about two minutes</h2>
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
                  <p className="font-data text-[0.66rem] uppercase tracking-[0.16em] text-verdict">Live now</p>
                  <p className="mt-2 text-sm leading-6 text-(--ink-soft)">Google login, Gmail receipt connection, the recurring-payment ledger, exports, encrypted snapshots, profile, and delete-data controls.</p>
                </div>
                <div className="inset p-4">
                  <p className="font-data text-[0.66rem] uppercase tracking-[0.16em] text-ochre">Not live yet</p>
                  <p className="mt-2 text-sm leading-6 text-(--muted)">Direct UPI/card mandate sync, Account Aggregator, Apple/Google subscription APIs, PayPal/Razorpay/Cashfree live sync, and cancellation automation.</p>
                </div>
              </div>
            </div>
            <Link href="/login" className="btn btn-primary btn-lg">Connect Gmail</Link>
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