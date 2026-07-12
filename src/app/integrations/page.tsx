import Link from "next/link";
import { VognaryMark } from "../brand";
import { connectors, getConnectorSummary, getConnectorSyncSummary, type ConnectorHonestyState, type ConnectorStatus } from "@/lib/connectors";
import { getConnectorHonesty } from "@/lib/connector-runtime";

const statusLabels: Record<ConnectorStatus, string> = {
  live: "Implemented path",
  "ready-with-env": "Needs setup",
  "partner-required": "Needs partner",
  planned: "Planned",
};

const statusClass: Record<ConnectorStatus, string> = {
  live: "pill pill-ready",
  "ready-with-env": "pill pill-partial",
  "partner-required": "pill pill-blocked",
  planned: "pill pill-planned",
};

const statusMeaning: Record<ConnectorStatus, string> = {
  live: "An implemented path exists. Its second badge distinguishes automatic sync from manual or fallback evidence.",
  "ready-with-env": "Code path exists, but production credentials, verification, or workspace token capture is still required.",
  "partner-required": "Needs a provider, issuer, PSP, network, bank, or regulated partner before direct sync can be claimed.",
  planned: "Modeled as a target contract. It stays planned until an adapter and first authorized sync are proven.",
};

const honestyPillClass: Record<ConnectorHonestyState, string> = {
  live: "pill pill-ready",
  "usage-only": "pill pill-partial",
  "source-health-only": "pill pill-partial",
  "evidence-only": "pill pill-ready",
  "setup-ready": "pill pill-partial",
  "token-required": "pill pill-partial",
  "oauth-required": "pill pill-partial",
  "verification-required": "pill pill-partial",
  "partner-gated": "pill pill-blocked",
  blocked: "pill pill-blocked",
  planned: "pill pill-planned",
};

const launchWaves = [
  { title: "Prove now", body: "Private audit, statement import, receipt snippets, manual mandates, automatically synchronized encrypted workspace state, and source coverage review." },
  { title: "Connect next", body: "Gmail receipt sync and OpenAI organization costs, because both have concrete code paths and official access patterns." },
  { title: "Scale after proof", body: "AWS, GitHub/Copilot, Cloudflare, Vercel, Render, domains, and team SaaS after sandbox credentials prove first sync." },
  { title: "Partner rails", body: "Account Aggregator, UPI AutoPay, card e-mandates, and bank/issuer pilots only after legal and partner approval." },
];

const realConnectorChecks = [
  "Official consent, API key, IAM role, webhook, or partner API starts from Vognary.",
  "Token references are encrypted per workspace and never exposed client-side.",
  "Initial sync writes its declared normalized output: financial ledger, usage/cost observations, or source-health inventory.",
  "Resync works without repeating setup and errors are visible to the user.",
  "Disconnect, delete, export, and audit-log paths exist before public rollout.",
];

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
          <Link href="/app" className="btn btn-ghost">Back to app</Link>
        </div>
        <article className="panel p-6 sm:p-8 rise">
          <span className="folio" data-folio="Guide">Integrations</span>
          <h1 className="mt-4 font-display text-3xl font-semibold text-(--ink) sm:text-4xl">Available connections and setup status</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-(--muted)">See what works now, what needs setup, and what still needs an approved partner.</p>

          <div className="mt-5 rounded-xl border border-line bg-(--card-2) p-4">
            <p className="eyebrow" style={{ fontSize: "0.62rem" }}>How Vognary integrates</p>
            <p className="mt-2 text-sm leading-6 text-(--muted)">Every source moves through the same path: official consent or scoped credential, encrypted token reference, initial sync, scheduled resync, ledger normalization, disconnect/delete controls. Banks, UPI, and card mandates require regulated partner access before automatic sync.</p>
            <Link href="/integration-model" className="btn btn-ghost mt-3 h-9 px-3 text-xs">Read integration model</Link>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-4">
            {launchWaves.map((wave, index) => (
              <section key={wave.title} className="inset p-4">
                <span className="font-display text-2xl font-semibold text-ember">{String(index + 1).padStart(2, "0")}</span>
                <h2 className="mt-3 font-display text-base font-semibold text-(--ink)">{wave.title}</h2>
                <p className="mt-2 text-sm leading-6 text-(--muted)">{wave.body}</p>
              </section>
            ))}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            {Object.entries(summary).map(([status, count]) => (
              <div key={status} className="inset px-4 py-3">
                <p className="eyebrow" style={{ fontSize: "0.56rem" }}>{statusLabels[status as ConnectorStatus]}</p>
                <p className="font-data mt-2 text-2xl font-semibold tnum text-(--ink)">{count}</p>
                <p className="mt-2 text-xs leading-5 text-(--muted)">{statusMeaning[status as ConnectorStatus]}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="inset px-4 py-3">
              <p className="eyebrow" style={{ fontSize: "0.62rem" }}>Connections listed</p>
              <p className="font-data mt-2 text-2xl font-semibold tnum text-(--ink)">{syncSummary.total}</p>
              <p className="mt-1 text-xs leading-5 text-(--muted)">{syncSummary.realtimeCapable} can become realtime after credentials, webhooks, or partner access.</p>
            </div>
            <div className="inset px-4 py-3">
              <p className="eyebrow" style={{ fontSize: "0.62rem" }}>Sign-in method</p>
              <p className="mt-2 text-sm leading-6 text-(--muted)">{Object.entries(syncSummary.byAuthType).map(([type, count]) => `${type}: ${count}`).join(" · ")}</p>
            </div>
            <div className="inset px-4 py-3">
              <p className="eyebrow" style={{ fontSize: "0.62rem" }}>Data access type</p>
              <p className="mt-2 text-sm leading-6 text-(--muted)">{Object.entries(syncSummary.byTrustClass).map(([type, count]) => `${type}: ${count}`).join(" · ")}</p>
            </div>
          </div>

          <section className="mt-6 rounded-xl border border-line bg-(--card-2) p-4">
            <p className="font-data text-[0.66rem] uppercase tracking-[0.16em] text-verdict">Definition of a real connector</p>
            <ul className="mt-3 grid gap-2 text-sm leading-6 text-(--muted) md:grid-cols-2">
              {realConnectorChecks.map((check) => <li key={check}>- {check}</li>)}
            </ul>
          </section>

          <div className="mt-8 grid gap-3">
            {connectors.map((connector) => {
              const honesty = getConnectorHonesty(connector);
              return (
              <section key={connector.id} className="inset p-4" data-reveal>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="eyebrow" style={{ fontSize: "0.56rem" }}>{connector.phase} · {connector.category}</p>
                    <h2 className="mt-2 font-display text-xl font-semibold text-(--ink)">{connector.name}</h2>
                    <p className="mt-2 text-sm leading-6 text-(--muted)">{connector.userValue}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-start gap-2 md:justify-end">
                    <span className={statusClass[connector.status]}>{statusLabels[connector.status]}</span>
                    <span className={honestyPillClass[honesty.state]} title={honesty.meaning}>{honesty.label}</span>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-xs leading-5 text-(--muted) md:grid-cols-4">
                  <p><strong className="text-(--ink)">Sign-in:</strong> {connector.authType}</p>
                  <p><strong className="text-(--ink)">Update:</strong> {connector.syncMode}</p>
                  <p><strong className="text-(--ink)">Access:</strong> {connector.trustClass}</p>
                  <p><strong className="text-(--ink)">Live updates:</strong> {connector.realtimeCapable ? "Possible" : "Scheduled/manual"}</p>
                </div>
                <p className="mt-3 text-sm leading-6 text-(--muted)"><strong className="text-(--ink)">Evidence:</strong> {connector.evidence}</p>
                {connector.limitation ? <p className="mt-2 text-sm leading-6 text-(--muted)"><strong className="text-(--ink)">Boundary:</strong> {connector.limitation}</p> : null}
                <p className="mt-2 text-sm leading-6 text-(--muted)"><strong className="text-(--ink)">Data:</strong> {connector.dataTypes.join(", ")}</p>
                <ul className="mt-3 grid gap-1 text-sm leading-6 text-(--muted)">
                  {connector.requirements.map((requirement) => <li key={requirement}>— {requirement}</li>)}
                </ul>
                <p className="mt-3 text-xs leading-5 text-(--muted)"><strong className="text-(--ink)">Current truth:</strong> {honesty.meaning}</p>
              </section>
              );
            })}
          </div>
        </article>
      </div>
    </main>
  );
}
