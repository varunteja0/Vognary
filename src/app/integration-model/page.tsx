import Link from "next/link";
import { VognaryMark } from "../brand";

const integrationPatterns = [
  ["OAuth consent", "Google, Microsoft, GitHub, Slack, Notion, Zoom, PayPal", "Redirect user to the official provider, receive code, store encrypted token reference, sync evidence."],
  ["API key or token", "OpenAI, Cloudflare, Render, Vercel, Stripe, Razorpay, domain registrars", "Collect scoped credential, encrypt it, run scheduled sync jobs."],
  ["IAM or delegated role", "AWS, Azure, Google Cloud", "Read billing/cost scopes without storing broad account passwords."],
  ["Webhook", "Stripe, Razorpay, Cashfree, app developer APIs", "Provider pushes subscription, invoice, mandate, or renewal events into Vognary."],
  ["Regulated partner API", "Account Aggregator, UPI, card mandates, banks/issuers", "Requires partner contract, consent artifact, compliance review, and audit logs."],
];

const rollout = [
  ["Gmail receipts", "Ready-to-connect", "First real personal-history connector path. OAuth returns receipt candidates into the recurring ledger."],
  ["OpenAI costs", "Adapter exists", "Needs admin key or workspace token capture before recurring AI spend sync."],
  ["Vercel, Render, GitHub, Cloudflare, AWS", "Next adapter wave", "Needs credential capture, provider adapters, scheduled sync, and normalization."],
  ["Apple, Google Play, X, Claude, Kling", "Provider-dependent", "Needs official user billing APIs, partner access, or receipt-based evidence where APIs are unavailable."],
  ["UPI, cards, banks", "Partner-gated", "Requires regulated rails; cannot be made universal with only frontend code."],
];

export default function IntegrationModelPage() {
  return (
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <div className="flex flex-wrap gap-2">
            <Link href="/sources" className="btn btn-ghost">Sources</Link>
            <Link href="/app" className="btn btn-primary">Open app</Link>
          </div>
        </div>

        <section className="dossier spotlight scan p-7 sm:p-10">
          <span className="folio" data-folio="Model" style={{ color: "var(--dossier-muted)" }}>Universal integration plan</span>
          <h1 className="mt-5 font-display text-4xl font-semibold leading-tight text-(--dossier-ink) sm:text-6xl">One ledger, many official rails.</h1>
          <p className="mt-5 max-w-3xl text-sm leading-7 muted-on-dark sm:text-base">Vognary should not depend on uploads as the product experience. Each source becomes real through official provider consent, scoped credentials, webhooks, IAM roles, or regulated partner APIs. The app must show what is live, setup-ready, planned, and partner-gated without pretending blocked rails are already connected.</p>
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-[1fr_1fr]">
          <article className="panel p-5 sm:p-6">
            <span className="folio" data-folio="01">Patterns</span>
            <h2 className="mt-3 font-display text-2xl font-semibold text-(--ink)">How integrations become real</h2>
            <div className="mt-5 grid gap-3">
              {integrationPatterns.map(([pattern, examples, action]) => (
                <div key={pattern} className="inset p-4">
                  <p className="font-display text-base font-semibold text-(--ink)">{pattern}</p>
                  <p className="mt-1 text-xs leading-5 text-(--muted)">{examples}</p>
                  <p className="mt-2 text-sm leading-6 text-(--ink-soft)">{action}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="panel p-5 sm:p-6">
            <span className="folio" data-folio="02">Rollout</span>
            <h2 className="mt-3 font-display text-2xl font-semibold text-(--ink)">What gets built next</h2>
            <div className="mt-5 grid gap-3">
              {rollout.map(([area, status, note]) => (
                <div key={area} className="inset p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="font-display text-base font-semibold text-(--ink)">{area}</p>
                    <span className="pill pill-partial">{status}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-(--muted)">{note}</p>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="panel mt-6 p-5 sm:p-6">
          <span className="folio" data-folio="Done">Real connector definition</span>
          <p className="mt-3 max-w-4xl text-sm leading-7 text-(--muted)">A connector is real only when the user can start from Vognary, complete official consent or credential setup, store token references encrypted per workspace, run initial sync, re-sync without repeating setup, see the source in profile/data controls, and disconnect/delete it. Anything less is a target, not a finished integration.</p>
        </section>
      </div>
    </main>
  );
}