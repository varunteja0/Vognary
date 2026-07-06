import Link from "next/link";
import { VognaryMark } from "../brand";
import { connectors, getConnectorSummary, getConnectorSyncSummary, type ConnectorStatus } from "@/lib/connectors";

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
  const syncSummary = getConnectorSyncSummary();

  return (
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
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

          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="inset px-4 py-3">
              <p className="eyebrow" style={{ fontSize: "0.56rem" }}>Connector targets</p>
              <p className="font-data mt-2 text-2xl font-semibold tnum text-(--ink)">{syncSummary.total}</p>
              <p className="mt-1 text-xs leading-5 text-(--muted)">{syncSummary.realtimeCapable} can become realtime after credentials, webhooks, or partner access.</p>
            </div>
            <div className="inset px-4 py-3">
              <p className="eyebrow" style={{ fontSize: "0.56rem" }}>Auth surface</p>
              <p className="mt-2 text-sm leading-6 text-(--muted)">{Object.entries(syncSummary.byAuthType).map(([type, count]) => `${type}: ${count}`).join(" · ")}</p>
            </div>
            <div className="inset px-4 py-3">
              <p className="eyebrow" style={{ fontSize: "0.56rem" }}>Trust classes</p>
              <p className="mt-2 text-sm leading-6 text-(--muted)">{Object.entries(syncSummary.byTrustClass).map(([type, count]) => `${type}: ${count}`).join(" · ")}</p>
            </div>
          </div>

          <div className="mt-8 grid gap-3">
            {connectors.map((connector) => (
              <section key={connector.id} className="inset p-4" data-reveal>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="eyebrow" style={{ fontSize: "0.56rem" }}>{connector.phase} · {connector.category}</p>
                    <h2 className="mt-2 font-display text-xl font-semibold text-(--ink)">{connector.name}</h2>
                    <p className="mt-2 text-sm leading-6 text-(--muted)">{connector.userValue}</p>
                  </div>
                  <span className={`${statusClass[connector.status]} shrink-0`}>{statusLabels[connector.status]}</span>
                </div>
                <div className="mt-3 grid gap-2 text-xs leading-5 text-(--muted) md:grid-cols-4">
                  <p><strong className="text-(--ink)">Auth:</strong> {connector.authType}</p>
                  <p><strong className="text-(--ink)">Sync:</strong> {connector.syncMode}</p>
                  <p><strong className="text-(--ink)">Trust:</strong> {connector.trustClass}</p>
                  <p><strong className="text-(--ink)">Realtime:</strong> {connector.realtimeCapable ? "Capable" : "Scheduled/manual"}</p>
                </div>
                <p className="mt-3 text-sm leading-6 text-(--muted)"><strong className="text-(--ink)">Evidence:</strong> {connector.evidence}</p>
                {connector.limitation ? <p className="mt-2 text-sm leading-6 text-(--muted)"><strong className="text-(--ink)">Boundary:</strong> {connector.limitation}</p> : null}
                <p className="mt-2 text-sm leading-6 text-(--muted)"><strong className="text-(--ink)">Data:</strong> {connector.dataTypes.join(", ")}</p>
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