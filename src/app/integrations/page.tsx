import Link from "next/link";
import { connectors, getConnectorSummary, type ConnectorStatus } from "@/lib/connectors";

const statusLabels: Record<ConnectorStatus, string> = {
  live: "Live",
  "ready-with-env": "Ready With Env",
  "partner-required": "Partner Required",
  planned: "Planned",
};

const statusClass: Record<ConnectorStatus, string> = {
  live: "pill pill-ready",
  "ready-with-env": "pill pill-partial",
  "partner-required": "pill pill-blocked",
  planned: "pill pill-planned",
};

export default function IntegrationsPage() {
  const summary = getConnectorSummary();

  return (
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="font-display text-lg font-semibold text-(--ink)">Vognary <span className="text-(--muted)">· The Silent Ledger</span></Link>
          <Link href="/" className="btn btn-ghost">Back to ledger</Link>
        </div>
        <article className="panel p-6 sm:p-8 rise">
          <span className="folio" data-folio="§ IH">Integration hub</span>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-(--ink) sm:text-5xl">Connector readiness across every phase</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-(--muted)">The honest map of what works now, what needs environment configuration, and what needs external regulated partners.</p>

          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            {Object.entries(summary).map(([status, count]) => (
              <div key={status} className="inset px-4 py-3">
                <p className="eyebrow" style={{ fontSize: "0.56rem" }}>{statusLabels[status as ConnectorStatus]}</p>
                <p className="font-data mt-2 text-2xl font-semibold tnum text-(--ink)">{count}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 grid gap-3">
            {connectors.map((connector) => (
              <section key={connector.id} className="inset p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="eyebrow" style={{ fontSize: "0.56rem" }}>{connector.phase} · {connector.category}</p>
                    <h2 className="mt-2 font-display text-xl font-semibold text-(--ink)">{connector.name}</h2>
                    <p className="mt-2 text-sm leading-6 text-(--muted)">{connector.userValue}</p>
                  </div>
                  <span className={`${statusClass[connector.status]} shrink-0`}>{statusLabels[connector.status]}</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-(--muted)"><strong className="text-(--ink)">Evidence:</strong> {connector.evidence}</p>
                <ul className="mt-3 grid gap-1 text-sm leading-6 text-(--muted)">
                  {connector.requirements.map((requirement) => <li key={requirement}>— {requirement}</li>)}
                </ul>
              </section>
            ))}
          </div>
        </article>
      </div>
    </main>
  );
}