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
    <main className="min-h-screen px-5 py-10 text-foreground sm:px-8">
      <article className="mx-auto max-w-5xl rounded-lg border border-line bg-(--surface) p-6 shadow-sm">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-(--accent)">Vognary Source Guide</p>
        <h1 className="mt-3 text-4xl font-semibold text-[#151712]">How to collect every recurring-payment source</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-(--muted)">No app can magically see every subscription without source access. Use this checklist to make your Vognary audit complete and evidence-backed.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {sourceGroups.map((group) => (
            <section key={group.title} className="rounded-lg border border-line bg-[#fbfcf8] p-4">
              <h2 className="text-lg font-semibold text-[#151712]">{group.title}</h2>
              <ol className="mt-3 grid gap-2 text-sm leading-6 text-(--muted)">
                {group.steps.map((step, index) => <li key={step}>{index + 1}. {step}</li>)}
              </ol>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}