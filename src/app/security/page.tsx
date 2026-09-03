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
          <Link href="/contact" className="btn btn-ghost">Contact</Link>
        </div>
        <article className="public-ledger">
          <header className="public-ledger-rail">
            <span className="folio" data-folio="Trust">Security</span>
            <h1 className="mt-5 font-display text-4xl font-semibold leading-tight text-(--ink) sm:text-5xl">Where your data goes</h1>
            <p className="mt-5 text-sm leading-7 text-(--ink-soft)">
              Three things decide everything on this page: what this deployment can currently
              prove, the one path evidence travels, and the boundaries the system will not cross.
              Each is stated below, in that order.
            </p>
            {/* Stated once, as current status, then not repeated. A page that
                opens with a wall of warnings buries the operating facts a
                reader came for. */}
            <dl className="public-facts mt-6">
              <div><dt>Mailbox access</dt><dd>None. Google is sign-in only</dd></div>
              <div><dt>Customer financial data</dt><dd>Blocked until the independent assessment and retest close</dd></div>
              <div><dt>Model training on your invoices</dt><dd>Never</dd></div>
            </dl>
            <div className="mt-6 grid gap-2">
              <Link href="/contact" className="btn btn-primary">Ask a security question</Link>
              <a className="btn btn-ghost" href="/.well-known/security.txt">Report a vulnerability</a>
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
            <p className="truth-label truth-citation">Data flow</p>
            <h2 className="mt-3 font-display text-xl font-semibold text-(--ink)">The one path evidence travels</h2>
            <p className="mt-2 text-sm leading-6 text-(--muted)">
              There is no second route in. Nothing is scanned, polled, or fetched on your behalf.
            </p>
            <ol className="public-steps mt-5">
              {dataFlow.map((step) => (
                <li key={step.title}>
                  <b>{step.title}.</b> {step.body}
                </li>
              ))}
            </ol>
          </section>

          <section className="public-band">
            <p className="truth-label truth-frozen">Operating boundaries</p>
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
            <p className="truth-label truth-policy">Detail on request</p>
            <h2 className="mt-3 font-display text-xl font-semibold text-(--ink)">Questions the evidence policy must answer</h2>
            <div className="public-disclosure-list mt-5">
              {trustAnswers.map((item) => (
                <details key={item.title} className="public-disclosure">
                  <summary>{item.title}</summary>
                  <p>{item.body}</p>
                </details>
              ))}
            </div>
            <p className="mt-6 text-sm leading-7 text-(--muted)">
              If your question is not answered above, ask it directly —{" "}
              <Link href="/contact" className="link-quiet">contact Vognary</Link>. Security reports
              have their own channel in{" "}
              <a className="link-quiet" href="/.well-known/security.txt">security.txt</a>.
            </p>
          </section>
          </div>
        </article>
      </div>
    </main>
  );
}

const dataFlow = [
  {
    title: "You submit one document",
    body: "A paste, an upload, or mail you send to a private receipt address. Vognary never reaches into a mailbox, a bank, or a card account to find it.",
  },
  {
    title: "Ingress is verified and bounded",
    body: "Resend webhook requests are checked against the untouched request body, size-bounded, replay-fenced, and resolved through a secret alias before any content is retrieved.",
  },
  {
    title: "Accepted text is encrypted at the application layer",
    body: "Raw source text is stored with authenticated encryption. Normalized facts keep a reference back to the evidence they came from.",
  },
  {
    title: "Every read rechecks who is asking",
    body: "Protected routes revalidate the session and the workspace role, and queries are scoped to the signed-in workspace id.",
  },
  {
    title: "Retention is minimized, not promised away",
    body: "Encrypted raw source text and terminal transport metadata are minimized after 30 days when retention runs. Provider-held email follows Resend's own schedule, and Vognary does not promise instant deletion from backups.",
  },
] as const;

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
