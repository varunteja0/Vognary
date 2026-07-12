import type { Metadata } from "next";
import Link from "next/link";
import { VognaryMark } from "../brand";
import SourceHealthClient from "./source-health-client";

export const metadata: Metadata = {
  title: "Connected Source Health",
  description: "See connected recurring-payment sources, sync freshness, evidence coverage, and fallback options in Vognary.",
};

const sourceGroups = [
  {
    title: "Cards and bank statements",
    steps: ["Use connected-bank access when an approved Account Aggregator or issuer path is available.", "If no direct source is offered, export a redacted CSV covering enough history to show the recurring pattern.", "Do not repeat an upload when the connected source already covers the same account and date window."],
  },
  {
    title: "UPI AutoPay",
    steps: ["Use direct mandate data only through an approved partner connection when available.", "Otherwise check AutoPay or Mandates in your UPI app and add only commitments missing from connected evidence.", "Keep account numbers, UPI IDs, and authorization references redacted."],
  },
  {
    title: "Apple and Google Play",
    steps: ["Use receipt sync when an authorized mailbox source contains app-store renewals.", "If a renewal is still missing, check Apple Subscriptions or Google Play Subscriptions once.", "Add only the missing subscription with its renewal date and amount."],
  },
  {
    title: "Email receipts",
    steps: ["Prefer the read-only Gmail connection where it is enabled and verified for your account.", "Outlook direct sync is not available yet; use a redacted receipt snippet only for evidence that cannot be connected.", "Never paste passwords, one-time codes, full card numbers, or unrelated email content."],
  },
  {
    title: "Cloud and SaaS",
    steps: ["Connect a scoped provider or admin credential only for integrations marked available in Vognary.", "Let scheduled sync maintain supported cost and usage evidence.", "Use an invoice or manual entry only when that provider has no working direct path."],
  },
  {
    title: "EMIs, SIPs, insurance, utilities",
    steps: ["Rely on connected transaction evidence where an approved bank source covers the account.", "Add a redacted policy, mandate, or bill only for a commitment absent from that coverage.", "Review high-impact financial commitments with the relevant provider before taking action."],
  },
];

const evidencePacks = [
  {
    title: "Private fallback pack",
    bestFor: "Personal, founder, freelancer, household",
    sources: ["One redacted CSV only if no direct account source exists", "Only the receipt snippets missing from connected mail evidence", "Only mandates that connected evidence did not detect"],
  },
  {
    title: "Founder stack pack",
    bestFor: "AI builders, agencies, small teams",
    sources: ["OpenAI/AI tool invoice or usage export", "GitHub, Vercel/Render, Cloudflare, domain invoices", "SaaS seat list or billing emails"],
  },
  {
    title: "India recurring rails pack",
    bestFor: "UPI AutoPay, card mandates, SIPs, EMIs, insurance",
    sources: ["Mandate screenshots with account numbers hidden", "Statement rows showing repeat debits", "Policy, EMI, SIP, or utility renewal receipts"],
  },
];

const redactionChecklist = [
  "Hide account numbers except the last 2 to 4 characters if needed for matching.",
  "Hide card numbers, CVV, OTPs, passwords, full addresses, and identity document numbers.",
  "Keep merchant name, charge date, amount, currency, cadence, and renewal text visible.",
  "Prefer CSV exports for statements because PDF extraction can be lower confidence.",
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
          <Link href="/app" className="btn btn-ghost">Back to app</Link>
        </div>
        <article className="panel p-6 sm:p-8 rise">
          <span className="folio" data-folio="Sources">Workspace source health</span>
          <h1 className="mt-4 max-w-3xl font-display text-3xl font-semibold text-(--ink) sm:text-4xl">One view of what is connected, current, and covered</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-(--muted)">Vognary reads the source ledger for your signed-in workspace so you can see sync freshness, evidence coverage, and the next scheduled update without re-uploading the same history.</p>
          <SourceHealthClient />
        </article>

        <article className="panel mt-5 p-6 sm:p-8">
          <span className="folio" data-folio="Fallback">Manual evidence, only for source gaps</span>
          <h2 className="mt-4 max-w-3xl font-display text-2xl font-semibold text-(--ink) sm:text-3xl">Use an upload only when a direct source cannot cover the commitment</h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-(--muted)">Fallback evidence helps close a specific gap. It is not intended to become a recurring chore: avoid duplicate date ranges, redact sensitive identifiers, and stop uploading once a connected source covers the same account.</p>

          <div className="mt-6 grid gap-3 lg:grid-cols-[1fr_0.8fr]">
            <section className="inset p-4">
              <p className="font-data text-[0.66rem] text-indigo">Fallback evidence packs</p>
              <div className="mt-4 grid gap-3">
                {evidencePacks.map((pack) => (
                  <div key={pack.title} className="rounded-[10px] border border-line bg-(--card) p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="font-display text-base font-semibold text-(--ink)">{pack.title}</h3>
                      <span className="pill pill-partial">{pack.bestFor}</span>
                    </div>
                    <ul className="mt-3 grid gap-1 text-sm leading-6 text-(--muted)">
                      {pack.sources.map((source) => <li key={source}>- {source}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
            <section className="inset p-4">
              <p className="font-data text-[0.66rem] text-ochre">Redaction checklist</p>
              <ul className="mt-4 grid gap-2 text-sm leading-6 text-(--muted)">
                {redactionChecklist.map((item) => <li key={item}>- {item}</li>)}
              </ul>
              <Link href="/private-audit" className="btn btn-ghost mt-4">Request source-gap review</Link>
            </section>
          </div>

          <details className="inset mt-6 p-4 sm:p-5">
            <summary className="cursor-pointer font-display text-base font-semibold text-(--ink)">Show fallback instructions by source type</summary>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {sourceGroups.map((group, index) => (
                <section key={group.title} className="rounded-[10px] border border-line bg-(--card) p-4">
                  <div className="flex items-center gap-2.5">
                    <span className="font-display text-xl font-semibold text-indigo">{String(index + 1).padStart(2, "0")}</span>
                    <h3 className="font-display text-base font-semibold text-(--ink)">{group.title}</h3>
                  </div>
                  <ol className="mt-3 grid gap-2 text-sm leading-6 text-(--muted)">
                    {group.steps.map((step, stepIndex) => <li key={step} className="flex gap-2"><span className="font-data text-xs text-indigo">{stepIndex + 1}.</span><span>{step}</span></li>)}
                  </ol>
                </section>
              ))}
            </div>
          </details>
        </article>
      </div>
    </main>
  );
}
