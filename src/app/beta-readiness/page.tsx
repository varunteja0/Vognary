import Link from "next/link";
import { VognaryMark } from "../brand";

export default function BetaReadinessPage() {
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
          <p className="mt-3 max-w-3xl text-sm leading-7 text-(--muted)">The self-serve review works now. This table shows what is ready and what still needs setup before connected-account production.</p>
          <div className="mt-8 overflow-x-auto rounded-[11px] border border-line">
            <table className="w-full min-w-160 border-separate border-spacing-0 text-left text-sm">
              <thead>
                <tr>
                  <th className="border-b border-line bg-(--card-2) px-4 py-3 font-data text-[0.68rem] font-semibold text-(--muted)">Capability</th>
                  <th className="border-b border-line bg-(--card-2) px-4 py-3 font-data text-[0.68rem] font-semibold text-(--muted)">Status</th>
                  <th className="border-b border-line bg-(--card-2) px-4 py-3 font-data text-[0.68rem] font-semibold text-(--muted)">Next step</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.capability}>
                    <td className="border-t border-line px-4 py-3 font-semibold text-(--ink)">{row.capability}</td>
                    <td className="border-t border-line px-4 py-3 font-data text-xs text-(--ink-soft)">{row.status}</td>
                    <td className="border-t border-line px-4 py-3 text-(--muted)">{row.next}</td>
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

const rows = [
  { capability: "Guest self-audit", status: "Code ready", next: "Receipt paste, conservative PDF/CSV import, manual fallback, separate-currency totals, and proof-backed first action." },
  { capability: "Signed-in persistence", status: "Code ready; deployment required", next: "Activate PostgreSQL, session secret, token-vault key, identity provider, backups, retention, and shared rate limiting." },
  { capability: "Assisted audit payment", status: "Provider and legal gate", next: "Apply migration 0016; complete qualified legal review, Razorpay KYC/configuration, signed webhook, replay, refund, and reconciliation proof." },
  { capability: "Gmail receipt sync", status: "Google approval gate", next: "Complete restricted-scope verification and prove consent, sync, resync, disconnect, deletion, and support." },
  { capability: "Bank, UPI, and card mandates", status: "Partner and legal gate", next: "No direct access is offered until approved regulated partner paths and production consent are proven." },
];