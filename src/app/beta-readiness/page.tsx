export default function BetaReadinessPage() {
  return (
    <main className="min-h-screen px-5 py-10 text-foreground sm:px-8">
      <article className="mx-auto max-w-4xl rounded-lg border border-line bg-(--surface) p-6 shadow-sm">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-(--accent)">Vognary Operating Plan</p>
        <h1 className="mt-3 text-4xl font-semibold text-[#151712]">Beta Readiness</h1>
        <p className="mt-3 text-sm leading-6 text-(--muted)">The product is ready for self-serve stateless audits. The table below is the honest path to connected-account production.</p>
        <div className="mt-8 overflow-hidden rounded-lg border border-line">
          <table className="w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="bg-[#f5f7f0] text-xs uppercase tracking-[0.14em] text-(--muted)">
              <tr>
                <th className="px-4 py-3 font-semibold">Capability</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Next Gate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.capability} className="bg-white">
                  <td className="border-t border-line px-4 py-3 font-semibold text-[#151712]">{row.capability}</td>
                  <td className="border-t border-line px-4 py-3 text-(--muted)">{row.status}</td>
                  <td className="border-t border-line px-4 py-3 text-(--muted)">{row.next}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
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