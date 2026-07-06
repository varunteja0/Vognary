import Link from "next/link";

export default function BetaReadinessPage() {
  return (
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="font-display text-lg font-semibold text-(--ink)">Vognary <span className="text-(--muted)">· The Silent Ledger</span></Link>
          <Link href="/" className="btn btn-ghost">Back to ledger</Link>
        </div>
        <article className="panel p-6 sm:p-8 rise">
          <span className="folio" data-folio="§ OP">Operating plan</span>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-(--ink) sm:text-5xl">Beta readiness</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-(--muted)">The product is ready for self-serve stateless audits. The table below is the honest path to connected-account production.</p>
          <div className="mt-8 overflow-x-auto rounded-[11px] border border-line">
            <table className="w-full min-w-160 border-separate border-spacing-0 text-left text-sm">
              <thead>
                <tr>
                  <th className="border-b border-line bg-(--card-2) px-4 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Capability</th>
                  <th className="border-b border-line bg-(--card-2) px-4 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Status</th>
                  <th className="border-b border-line bg-(--card-2) px-4 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Next gate</th>
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
  { capability: "CSV audits", status: "Ready", next: "Run 30 private founder audits." },
  { capability: "PDF ingestion", status: "Beta heuristic", next: "Improve bank-specific table extraction." },
  { capability: "Manual commitments", status: "Ready", next: "Add source-specific templates for Apple, UPI, domains, and insurance." },
  { capability: "Gmail receipts", status: "OAuth scaffold", next: "Configure Google OAuth, pass app verification, connect candidates to UI." },
  { capability: "Persistence", status: "Schema ready", next: "Add auth, encryption, deletion, and audit log." },
  { capability: "Regulated data integrations", status: "Blocked by approvals", next: "Choose Account Aggregator/TSP and mandate-data partners." },
];