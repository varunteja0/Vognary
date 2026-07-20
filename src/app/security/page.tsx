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
          <p className="mt-3 text-sm leading-7 text-(--muted)">The review runs without retaining original uploaded files by default. Signed-in workspace state is stored only when database, session, and token-vault configuration are active.</p>
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
  { title: "No backend file storage by default", body: "The current audit and file-import APIs process request data and return results without storing uploaded financial files." },
  { title: "Proof before action", body: "Each suggestion links back to transaction or receipt text so users can verify before acting." },
  { title: "Encrypted workspace storage", body: "Signed-in workspace snapshots and connector secrets use authenticated application-layer encryption; protected routes recheck session and workspace membership." },
  { title: "Approved integrations only", body: "Gmail, Account Aggregator, UPI, and card-mandate integrations require approved scopes, partners, and legal review." },
];
