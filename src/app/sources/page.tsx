import Link from "next/link";

const sourceGroups = [
  {
    title: "Cards And Bank Statements",
    steps: ["Export last 6-12 months of credit card and bank statements as CSV when available.", "If CSV is unavailable, upload a readable PDF and verify converted rows.", "Check your card app for Recurring Payments, Standing Instructions, AutoPay, Merchant Mandates, or e-mandates."],
  },
  {
    title: "UPI AutoPay",
    steps: ["Open Google Pay, PhonePe, Paytm, BHIM, or your UPI app.", "Look for AutoPay, Mandates, UPI Mandates, or Subscriptions.", "Manually add each mandate to Vognary if it does not appear in statements."],
  },
  {
    title: "Apple And Google Play",
    steps: ["Apple: Settings -> Apple ID -> Subscriptions.", "Google Play: Profile -> Payments and subscriptions -> Subscriptions.", "Add each active app-store subscription manually or paste receipt snippets into Receipt Intelligence."],
  },
  {
    title: "Email Receipts",
    steps: ["Search Gmail or Outlook for invoice, receipt, subscription, renewal, payment successful, trial, monthly, annual.", "Paste useful snippets into Receipt Intelligence.", "When Gmail OAuth is configured, Vognary can read snippets through read-only consent."],
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
          <Link href="/" className="font-display text-lg font-semibold text-(--ink)">Vognary <span className="text-(--muted)">· The Silent Ledger</span></Link>
          <Link href="/" className="btn btn-ghost">Back to ledger</Link>
        </div>
        <article className="panel p-6 sm:p-8 rise">
          <span className="folio" data-folio="§ SG">Field kit</span>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-(--ink) sm:text-5xl">Collect every recurring-payment source</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-(--muted)">No app can magically see every subscription without source access. Use this checklist to make your Vognary audit complete and evidence-backed.</p>
          <div className="mt-8 grid gap-3 md:grid-cols-2">
            {sourceGroups.map((group, index) => (
              <section key={group.title} className="inset p-4">
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