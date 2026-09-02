import "../public.css";
import "../ledger.css";
import type { Metadata } from "next";
import Link from "next/link";
import { VognaryMark } from "../brand";
import { getPublicTrustSignals, type TrustSignalState } from "@/lib/server/trust-signals";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Security",
  description: "How Vognary protects submitted evidence, account data, connected sources, and recurring-spend audit results.",
  alternates: { canonical: "/security" },
  openGraph: {
    url: "/security",
    title: "Security - Vognary",
    description: "How Vognary protects submitted evidence, account data, connected sources, and recurring-spend audit results.",
  },
};

const stateLabels: Record<TrustSignalState, string> = {
  proven: "Proven",
  configured: "Configured",
  "not-yet-proven": "Not yet proven",
};

const statePills: Record<TrustSignalState, string> = {
  proven: "pill-ready",
  configured: "pill-partial",
  "not-yet-proven": "pill-planned",
};

export default function SecurityPage() {
  const signals = getPublicTrustSignals();
  return (
    <main className="relative px-4 pb-12 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line py-3">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <Link href="/app" className="btn btn-ghost">Back to app</Link>
        </div>
        <article className="public-ledger">
          <header className="public-ledger-rail">
            <span className="folio" data-folio="Trust">Security</span>
            <h1 className="mt-5 font-display text-4xl font-semibold leading-tight text-(--ink) sm:text-5xl">How Vognary handles data</h1>
            <p className="mt-5 text-sm leading-7 text-(--ink-soft)">Google is used for sign-in only. Receipt mail enters through a signed provider webhook, is bounded before parsing, and is saved only through the canonical Recovery workspace.</p>
            <div className="mt-6 border-l-2 border-ochre pl-4">
              <p className="font-data text-xs font-semibold text-ochre">ASSESSMENT NOT YET PROVEN</p>
              <p className="mt-2 text-sm leading-7 text-(--muted)">Real customer financial data remains blocked until the independent assessment and remediation retest gate closes.</p>
            </div>
          </header>

          <div className="public-ledger-body">
          <section className="public-band public-band-lead">
            <p className="truth-label truth-observed">Deployment truth</p>
            <h2 className="mt-3 font-display text-2xl font-semibold text-(--ink)">Live status, measured rather than promised</h2>
            <p className="mt-2 text-sm leading-6 text-(--muted)">These states are read from this deployment&apos;s configuration each time the page loads. Backup Proven requires a recorded restore of a stored encrypted dump, not only a storage setting. Anything unproven is labeled that way.</p>
            <ul className="public-status-list mt-5">
              {signals.map((signal) => (
                <li key={signal.id}>
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <h3 className="font-display text-base font-semibold text-(--ink)">{signal.label}</h3>
                    <span className={`pill ${statePills[signal.state]}`}>{stateLabels[signal.state]}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-(--muted)">{signal.detail}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="public-band">
            <p className="truth-label truth-citation">Operating boundaries</p>
            <h2 className="mt-3 font-display text-xl font-semibold text-(--ink)">What the system does and does not hold</h2>
            <dl className="public-record-list mt-5">
              {items.map((item) => (
                <div key={item.title}>
                  <dt>{item.title}</dt>
                  <dd>{item.body}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="public-band">
            <p className="truth-label truth-policy">Inspect the boundary</p>
            <h2 className="mt-3 font-display text-xl font-semibold text-(--ink)">Questions the evidence policy must answer</h2>
            <div className="public-disclosure-list mt-5">
              {trustAnswers.map((item) => (
                <details key={item.title} className="public-disclosure">
                  <summary>{item.title}</summary>
                  <p>{item.body}</p>
                </details>
              ))}
            </div>
          </section>
          </div>
        </article>
      </div>
    </main>
  );
}

const trustAnswers = [
  { title: "Does Vognary read my Gmail?", body: "No. Google is used for sign-in only." },
  { title: "Is Gmail connected through OAuth?", body: "No. Direct mailbox OAuth is not offered." },
  { title: "Is global forwarding required?", body: "No. You can paste or upload receipts. A private billing address is optional after the first result." },
  { title: "What do I provide?", body: "Only evidence you explicitly submit or send to your private receipt address." },
  { title: "Why can I trust a number?", body: "Every important claim exposes the receipt or observation behind it. Unsupported facts stay unpublished." },
  { title: "Is invoice content used for model training?", body: "Vognary does not train models on your invoices or receipt text." },
  { title: "Does AI processing see invoice content?", body: "Signed-in commitment reconstruction is deterministic. If an Anthropic API key is configured, the guest document-ingest assist can send document text to Anthropic; proposed line items are kept only when they reconcile to the document’s own total. Vognary does not control Anthropic’s retention." },
  { title: "What is retained?", body: "Normalized facts and bounded excerpts remain until you delete the workspace or account. Encrypted raw source text is minimized after 30 days when retention runs. Provider-held email follows Resend’s own schedule. Vognary does not promise instant deletion from backups." },
  { title: "Are workspaces isolated?", body: "Queries are scoped to the signed-in workspace id. That is application-level isolation, not a certified multi-tenant audit." },
];

const items = [
  { title: "No passwords or PINs", body: "Vognary never asks for bank passwords, card PINs, UPI PINs, or netbanking credentials." },
  { title: "No mailbox access", body: "Vognary does not access or scan Gmail. Any mail sent to a private receipt address can reach the receiving provider, so the address must be kept confidential." },
  { title: "Signed receipt ingress", body: "Resend webhook requests are verified against the untouched request body, bounded, replay-fenced, and resolved through a secret alias before content is retrieved." },
  { title: "Encrypted Recovery storage", body: "Accepted raw source text uses authenticated application-layer encryption. Protected routes recheck the session and workspace role; normalized facts retain evidence references." },
  { title: "Separate retention boundaries", body: "Vognary minimizes encrypted raw source text and terminal transport metadata under its retention policy. Provider-held email follows Resend’s separate retention and deletion controls." },
  { title: "Source before action", body: "Each suggestion links to receipt evidence. Planning to cancel records your intent; Vognary does not cancel the service." },
];
