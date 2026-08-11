import type { Metadata } from "next";
import Link from "next/link";
import { VognaryMark } from "../brand";
import { getPublicTrustSignals, type TrustSignalState } from "@/lib/server/trust-signals";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Security",
  description: "How Vognary protects submitted evidence, account data, connected sources, and recurring-spend audit results.",
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
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <Link href="/app" className="btn btn-ghost">Back to app</Link>
        </div>
        <article className="panel p-6 sm:p-8 rise">
          <span className="folio" data-folio="Trust">Security</span>
          <h1 className="mt-4 font-display text-3xl font-semibold text-(--ink) sm:text-4xl">How Vognary handles data</h1>
          <p className="mt-3 text-sm leading-7 text-(--muted)">Google is used for sign-in only. Receipt mail enters through a signed provider webhook, is bounded before parsing, and is saved only through the canonical Recovery workspace.</p>
          <div className="mt-8 grid gap-3">
            {items.map((item) => (
              <div key={item.title} className="inset p-4">
                <h2 className="font-display text-base font-semibold text-(--ink)">{item.title}</h2>
                <p className="mt-2 text-sm leading-6 text-(--muted)">{item.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-10">
            <h2 className="font-display text-xl font-semibold text-(--ink)">Live status - measured, not promised</h2>
            <p className="mt-2 text-sm leading-6 text-(--muted)">These states are read from this deployment&apos;s configuration each time the page loads. Anything unproven is labeled that way.</p>
            <div className="mt-4 grid gap-3">
              {signals.map((signal) => (
                <div key={signal.id} className="inset p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-display text-base font-semibold text-(--ink)">{signal.label}</h3>
                    <span className={`pill ${statePills[signal.state]}`}>{stateLabels[signal.state]}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-(--muted)">{signal.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </article>
      </div>
    </main>
  );
}

const items = [
  { title: "No passwords or PINs", body: "Vognary never asks for bank passwords, card PINs, UPI PINs, or netbanking credentials." },
  { title: "No mailbox access", body: "Vognary does not access or scan Gmail. Any mail sent to a private receipt address can reach the receiving provider, so the address must be kept confidential." },
  { title: "Signed receipt ingress", body: "Resend webhook requests are verified against the untouched request body, bounded, replay-fenced, and resolved through a secret alias before content is retrieved." },
  { title: "Encrypted Recovery storage", body: "Accepted raw source text uses authenticated application-layer encryption. Protected routes recheck the session and workspace role; normalized facts retain evidence references." },
  { title: "Separate retention boundaries", body: "Vognary minimizes encrypted raw source text and terminal transport metadata under its retention policy. Provider-held email follows Resend’s separate retention and deletion controls." },
  { title: "Source before action", body: "Each suggestion links to receipt evidence. Planning to cancel records your intent; Vognary does not cancel the service." },
];
