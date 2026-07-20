import type { Metadata } from "next";
import Link from "next/link";
import { VognaryMark } from "../brand";
import { getPublicTrustSignals, type PublicTrustSignal, type TrustSignalId } from "@/lib/server/trust-signals";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Beta readiness",
  description:
    "Capability-by-capability status: what the self-serve review does today, and which capabilities still wait on deployment, provider approval, or partner and legal gates.",
};

export default function BetaReadinessPage() {
  const signals = new Map<TrustSignalId, PublicTrustSignal>(getPublicTrustSignals().map((signal) => [signal.id, signal]));
  const liveSignals: Record<string, string> = {
    "Guest self-audit": "Not gated. The review runs in the browser tab without a server dependency.",
    "Signed-in persistence": persistenceLiveSignal(signals),
    "Assisted audit payment": "Held behind the legal and provider gate; checkout stays hidden until settlement proof exists.",
    "Gmail receipt sync": signals.get("gmail-verification")?.detail ?? "Status unavailable.",
    "Bank, UPI, and card mandates": signals.get("bank-rails")?.detail ?? "Status unavailable.",
  };
  return (
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <Link href="/app" className="btn btn-ghost">Back to app</Link>
        </div>
        <article className="panel p-6 sm:p-8 rise">
          <span className="folio" data-folio="Status">Capability status</span>
          <h1 className="mt-4 font-display text-3xl font-semibold text-(--ink) sm:text-4xl">What works now and what is next</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-(--muted)">The self-serve review works now. This table shows what is ready and what still needs setup before connected-account production. The live column is read from this deployment&apos;s configuration when the page loads.</p>
          <div className="mt-8 overflow-x-auto rounded-[11px] border border-line">
            <table className="w-full min-w-200 border-separate border-spacing-0 text-left text-sm">
              <thead>
                <tr>
                  <th className="border-b border-line bg-(--card-2) px-4 py-3 font-data text-[0.68rem] font-semibold text-(--muted)">Capability</th>
                  <th className="border-b border-line bg-(--card-2) px-4 py-3 font-data text-[0.68rem] font-semibold text-(--muted)">Status</th>
                  <th className="border-b border-line bg-(--card-2) px-4 py-3 font-data text-[0.68rem] font-semibold text-(--muted)">Next step</th>
                  <th className="border-b border-line bg-(--card-2) px-4 py-3 font-data text-[0.68rem] font-semibold text-(--muted)">Live signal</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.capability}>
                    <td className="border-t border-line px-4 py-3 font-semibold text-(--ink)">{row.capability}</td>
                    <td className="border-t border-line px-4 py-3 font-data text-xs text-(--ink-soft)">{row.status}</td>
                    <td className="border-t border-line px-4 py-3 text-(--muted)">{row.next}</td>
                    <td className="border-t border-line px-4 py-3 text-xs leading-5 text-(--muted)">{liveSignals[row.capability] ?? "Status unavailable."}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </div>
    </main>
  );
}

function persistenceLiveSignal(signals: Map<TrustSignalId, PublicTrustSignal>) {
  const session = signals.get("session-signing");
  const vault = signals.get("token-vault");
  const backups = signals.get("backups");
  const coreActive = session?.state !== "not-yet-proven" && vault?.state !== "not-yet-proven";
  if (!coreActive) return "Session signing or the token vault is not active in this deployment.";
  return backups?.state === "proven"
    ? "Session signing and the token vault are active; backups are proven with a recorded restore drill."
    : "Session signing and the token vault are active; a backup restore drill is not yet recorded.";
}

const rows = [
  { capability: "Guest self-audit", status: "Code ready", next: "Receipt paste, conservative PDF/CSV import, manual fallback, separate-currency totals, and proof-backed first action." },
  { capability: "Signed-in persistence", status: "Code ready; deployment required", next: "Activate PostgreSQL, session secret, token-vault key, identity provider, backups, retention, and shared rate limiting." },
  { capability: "Assisted audit payment", status: "Provider and legal gate", next: "Apply migration 0016; complete qualified legal review, Razorpay KYC/configuration, signed webhook, replay, refund, and reconciliation proof." },
  { capability: "Gmail receipt sync", status: "Google approval gate", next: "Complete restricted-scope verification and prove consent, sync, resync, disconnect, deletion, and support." },
  { capability: "Bank, UPI, and card mandates", status: "Partner and legal gate", next: "No direct access is offered until approved regulated partner paths and production consent are proven." },
];