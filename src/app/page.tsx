import Link from "next/link";
import { VognaryMark } from "./brand";

const checks = [
  "AI tools: Claude, OpenAI, Cursor, Kling",
  "Cloud and SaaS: Render, Vercel, GitHub, AWS",
  "UPI AutoPay and card mandates",
  "Apple, Google Play, domains, insurance, EMIs, SIPs",
];

const steps = [
  ["1", "Sign in", "Use Google or private beta access so your workspace is yours."],
  ["2", "Add evidence", "Use manual entries, statements, receipts, or source checks."],
  ["3", "Review one list", "See recurring spend, next debits, proof, and actions."],
  ["4", "Save safely", "Save an encrypted snapshot or delete your data from Profile."],
];

export default function Home() {
  return (
    <main id="ledger-main" className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <nav className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={24} />
            Vognary
          </Link>
          <div className="flex flex-wrap gap-2">
            <Link href="/private-audit" className="btn btn-ghost">Request audit</Link>
            <Link href="/login" className="btn btn-primary">Sign in</Link>
          </div>
        </nav>

        <section className="dossier spotlight scan overflow-hidden p-7 sm:p-10 lg:p-12">
          <div className="max-w-3xl">
            <span className="folio" data-folio="Start" style={{ color: "var(--dossier-muted)" }}>Recurring payments, reviewed</span>
            <h1 className="mt-6 font-display text-4xl font-bold leading-[0.98] tracking-[-0.035em] text-(--dossier-ink) sm:text-6xl lg:text-7xl">
              See what is renewing<br />before money leaves.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 muted-on-dark sm:text-lg">
              Vognary helps you build one recurring-payment list from real evidence: tools, cloud bills, mandates, app stores, domains, insurance, EMIs, SIPs, and receipts.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login" className="btn btn-primary">Start with login</Link>
              <Link href="/private-audit" className="btn btn-ondark">Ask for private audit help</Link>
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="panel p-5 sm:p-6">
            <span className="folio" data-folio="Pain">What this solves</span>
            <h2 className="mt-3 font-display text-2xl font-semibold text-(--ink)">One place to review recurring commitments</h2>
            <div className="mt-5 grid gap-2">
              {checks.map((item) => (
                <div key={item} className="inset px-3 py-3 text-sm text-(--ink-soft)">{item}</div>
              ))}
            </div>
          </div>

          <div className="panel p-5 sm:p-6">
            <span className="folio" data-folio="Flow">How to use it</span>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {steps.map(([number, title, body]) => (
                <div key={title} className="inset px-4 py-4">
                  <p className="font-data text-xs uppercase tracking-[0.16em] text-ember">{number}</p>
                  <h3 className="mt-2 font-display text-lg font-semibold text-(--ink)">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-(--muted)">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel p-5 sm:p-6">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <span className="folio" data-folio="Honest">Current beta boundary</span>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-(--muted)">
                Live now: login, manual/file/receipt evidence, recurring-payment graph, exports, encrypted snapshots, profile, and delete-data controls. Not live yet: direct UPI/card mandate sync, Account Aggregator, Apple/Google universal subscription APIs, PayPal/Razorpay/Cashfree live sync, and cancellation automation.
              </p>
            </div>
            <Link href="/login" className="btn btn-primary">Go to login</Link>
          </div>
        </section>
      </div>
    </main>
  );
}