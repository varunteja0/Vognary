import Link from "next/link";
import { VognaryMark } from "../brand";

const sourceGroups = [
  {
    title: "Cards And Bank Statements",
    steps: ["Check your card app for Recurring Payments, Standing Instructions, AutoPay, Merchant Mandates, or e-mandates.", "Use connected-bank access when an approved Account Aggregator or issuer path is available.", "Use statement exports only as fallback evidence when a direct source is unavailable."],
  },
  {
    title: "UPI AutoPay",
    steps: ["Open Google Pay, PhonePe, Paytm, BHIM, or your UPI app.", "Look for AutoPay, Mandates, UPI Mandates, or Subscriptions.", "Manually add each mandate to Vognary if it does not appear in statements."],
  },
  {
    title: "Apple And Google Play",
    steps: ["Apple: Settings -> Apple ID -> Subscriptions.", "Google Play: Profile -> Payments and subscriptions -> Subscriptions.", "Add each active app-store subscription manually or paste receipt snippets into the receipts box."],
  },
  {
    title: "Email Receipts",
    steps: ["Search Gmail or Outlook for invoice, receipt, subscription, renewal, payment successful, trial, monthly, annual.", "Paste useful snippets into the receipts box.", "When Gmail OAuth is configured, Vognary can read snippets through read-only consent."],
  },
  {
    title: "Cloud And SaaS",
    steps: ["Check OpenAI, Anthropic, Cursor, GitHub, Vercel, Render, AWS, Cloudflare, domain registrars, Notion, Slack, Figma, Adobe.", "Export invoices or paste billing emails.", "Add high-cost tools manually if invoices are not available."],
  },
  {
    title: "EMIs, SIPs, Insurance, Utilities",
    steps: ["Check bank statements for ECS, NACH, SIP, EMI, premium, policy, broadband, telecom, electricity, and utility debits.", "Add annual and quarterly commitments manually so Vognary can annualize them.", "Use the Team Monthly Review to assign ownership for business commitments."],
  },
];

export default function SourcesPage() {
  return (
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <Link href="/" className="btn btn-ghost">Back to app</Link>
        </div>
        <article className="panel p-6 sm:p-8 rise">
          <span className="folio" data-folio="Guide">Source guide</span>
          <h1 className="mt-4 font-display text-3xl font-semibold text-(--ink) sm:text-4xl">How to add recurring-payment sources</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-(--muted)">Start with the sources you can verify. If a provider cannot connect directly yet, add a statement, receipt, or manual entry.</p>
          <div className="mt-8 grid gap-3 md:grid-cols-2">
            {sourceGroups.map((group, index) => (
              <section key={group.title} className="inset p-4" data-reveal style={{ ["--reveal-delay"]: `${index * 60}ms` } as React.CSSProperties}>
                <div className="flex items-center gap-2.5">
                  <span className="font-display text-2xl font-semibold text-ember">{String(index + 1).padStart(2, "0")}</span>
                  <h2 className="font-display text-base font-semibold text-(--ink)">{group.title}</h2>
                </div>
                <ol className="mt-3 grid gap-2 text-sm leading-6 text-(--muted)">
                  {group.steps.map((step, stepIndex) => <li key={step} className="flex gap-2"><span className="font-data text-xs text-ember">{stepIndex + 1}.</span><span>{step}</span></li>)}
                </ol>
              </section>
            ))}
          </div>
        </article>
      </div>
    </main>
  );
}