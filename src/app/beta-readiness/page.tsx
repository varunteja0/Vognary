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
          <Link href="/" className="btn btn-ghost">Back to app</Link>
        </div>
        <article className="panel p-6 sm:p-8 rise">
          <span className="folio" data-folio="Status">Beta status</span>
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
  { capability: "Self-serve audits", status: "Ready", next: "Run 30 real recurring-payment audits." },
  { capability: "PDF ingestion", status: "Beta heuristic", next: "Improve bank-specific table extraction." },
  { capability: "Manual commitments", status: "Ready", next: "Add source-specific templates for Apple, UPI, domains, and insurance." },
  { capability: "Gmail receipts", status: "OAuth scaffold", next: "Configure Google OAuth, pass app verification, connect candidates to UI." },
  { capability: "Persistence", status: "Schema ready", next: "Add auth, encryption, deletion, and audit log." },
  { capability: "Regulated data integrations", status: "Blocked by approvals", next: "Choose Account Aggregator/TSP and mandate-data partners." },
];