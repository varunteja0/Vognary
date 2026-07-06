import { connectors, getConnectorSummary, type ConnectorStatus } from "@/lib/connectors";

const statusLabels: Record<ConnectorStatus, string> = {
  live: "Live",
  "ready-with-env": "Ready With Env",
  "partner-required": "Partner Required",
  planned: "Planned",
};

const statusClass: Record<ConnectorStatus, string> = {
  live: "border-emerald-200 bg-emerald-50 text-emerald-800",
  "ready-with-env": "border-blue-200 bg-blue-50 text-blue-800",
  "partner-required": "border-amber-200 bg-amber-50 text-amber-900",
  planned: "border-stone-200 bg-stone-100 text-stone-800",
};

export default function IntegrationsPage() {
  const summary = getConnectorSummary();

  return (
    <main className="min-h-screen px-5 py-10 text-foreground sm:px-8">
      <article className="mx-auto max-w-6xl rounded-lg border border-line bg-(--surface) p-6 shadow-sm">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-(--accent)">Vognary Integration Hub</p>
        <h1 className="mt-3 text-4xl font-semibold text-[#151712]">Connector readiness across all planned phases</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-(--muted)">This is the honest map of what works now, what needs environment configuration, and what needs external regulated partners.</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          {Object.entries(summary).map(([status, count]) => (
            <div key={status} className="rounded-md border border-line bg-[#fbfcf8] p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-(--muted)">{statusLabels[status as ConnectorStatus]}</p>
              <p className="mt-2 text-2xl font-semibold text-[#151712]">{count}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 grid gap-4">
          {connectors.map((connector) => (
            <section key={connector.id} className="rounded-lg border border-line bg-[#fbfcf8] p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-(--muted)">{connector.phase} / {connector.category}</p>
                  <h2 className="mt-2 text-xl font-semibold text-[#151712]">{connector.name}</h2>
                  <p className="mt-2 text-sm leading-6 text-(--muted)">{connector.userValue}</p>
                </div>
                <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${statusClass[connector.status]}`}>{statusLabels[connector.status]}</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-(--muted)"><strong className="text-[#151712]">Evidence:</strong> {connector.evidence}</p>
              <ul className="mt-3 grid gap-1 text-sm leading-6 text-(--muted)">
                {connector.requirements.map((requirement) => <li key={requirement}>- {requirement}</li>)}
              </ul>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}