"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type FreshnessStatus = "unknown" | "fresh" | "stale" | "error" | null;
type CoverageCompleteness = "partial" | "complete" | null;

type ConnectedAccount = {
  id: string;
  connectorId: string;
  displayName: string;
  status: string;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  coverageStartAt: string | null;
  coverageEndAt: string | null;
  coverageCompleteness: CoverageCompleteness;
  freshnessStatus: FreshnessStatus;
  latestRunStatus: string | null;
  evidenceCount: number;
};

type SourceHealth = {
  connectedAccountId: string;
  connectorId: string;
  status: string;
  freshnessStatus: FreshnessStatus;
  coverageStartAt: string | null;
  coverageEndAt: string | null;
  coverageCompleteness: CoverageCompleteness;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  latestRunStatus: string | null;
};

type SourceHealthPayload = {
  status: "ok";
  ledgerVersion: number;
  accounts: ConnectedAccount[];
  sourceHealth: SourceHealth[];
  recurringItems: Array<{ id: string }>;
  evidence: Array<{ id: string }>;
};

type DashboardState =
  | { kind: "loading" }
  | { kind: "ready"; data: SourceHealthPayload; checkedAt: Date; warning?: string }
  | { kind: "signed-out" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

type DisplaySource = SourceHealth & {
  displayName: string;
  evidenceCount: number;
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export default function SourceHealthClient() {
  const [state, setState] = useState<DashboardState>({ kind: "loading" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let requestInFlight = false;

    async function loadSourceHealth() {
      if (requestInFlight) return;
      requestInFlight = true;

      try {
        const response = await fetch("/api/workspaces/current/connectors", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        const payload = await readJson(response);
        if (disposed) return;

        if (response.status === 401) {
          setState({ kind: "signed-out" });
          return;
        }
        if (response.status === 501 || payload.status === "not-configured") {
          setState({ kind: "unavailable" });
          return;
        }
        if (!response.ok || payload.status !== "ok") {
          throw new Error(readError(payload));
        }

        setState({ kind: "ready", data: payload as SourceHealthPayload, checkedAt: new Date() });
      } catch (error) {
        if (disposed || (error instanceof DOMException && error.name === "AbortError")) return;
        const message = error instanceof Error ? error.message : "Source status could not be loaded.";
        setState((current) => current.kind === "ready"
          ? { ...current, warning: "The latest refresh failed. Showing the last status loaded on this page." }
          : { kind: "error", message });
      } finally {
        requestInFlight = false;
        if (!disposed) setRefreshing(false);
      }
    }

    void loadSourceHealth();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadSourceHealth();
    }, 60_000);

    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refreshKey]);

  function refresh() {
    setRefreshing(true);
    setRefreshKey((value) => value + 1);
  }

  if (state.kind === "loading") return <SourceHealthLoading />;
  if (state.kind === "signed-out") return <SignedOutState />;
  if (state.kind === "unavailable") return <UnavailableState />;
  if (state.kind === "error") return <ErrorState message={state.message} onRetry={refresh} />;

  return (
    <SourceHealthDashboard
      data={state.data}
      checkedAt={state.checkedAt}
      warning={state.warning}
      refreshing={refreshing}
      onRefresh={refresh}
    />
  );
}

function SourceHealthDashboard({
  data,
  checkedAt,
  warning,
  refreshing,
  onRefresh,
}: {
  data: SourceHealthPayload;
  checkedAt: Date;
  warning?: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const sources = useMemo(() => buildDisplaySources(data), [data]);
  const activeSources = sources.filter((source) => source.status !== "revoked");
  const freshSources = activeSources.filter((source) => source.status !== "error" && source.freshnessStatus === "fresh");
  const attentionSources = activeSources.filter((source) => source.freshnessStatus === "stale" || source.freshnessStatus === "error" || source.status === "error");

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div role="status" aria-live="polite">
          <p className="font-data text-[0.68rem] text-(--muted)">
            Dashboard checked <time dateTime={checkedAt.toISOString()}>{dateTimeFormatter.format(checkedAt)}</time>
          </p>
          <p className="mt-1 text-xs leading-5 text-(--muted)">Status refreshes every minute while this page is open. Provider delays can affect freshness.</p>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh status"}
        </button>
      </div>

      {warning ? (
        <p className="mt-3 rounded-[10px] border border-ochre/30 bg-(--ochre-tint) px-3 py-2 text-sm text-ochre" role="status">{warning}</p>
      ) : null}

      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Connected sources" value={activeSources.length} detail={sources.length !== activeSources.length ? `${sources.length - activeSources.length} disconnected` : "Workspace sources"} />
        <Metric label="Fresh now" value={freshSources.length} detail="Latest source evidence" tone="positive" />
        <Metric label="Need attention" value={attentionSources.length} detail="Stale or failed sync" tone={attentionSources.length ? "warning" : "positive"} />
        <Metric label="Commitments found" value={data.recurringItems.length} detail={`${data.evidence.length} recent evidence signals`} />
      </dl>

      {sources.length ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {sources.map((source) => <SourceCard key={source.connectedAccountId} source={source} />)}
        </div>
      ) : (
        <div className="inset mt-4 p-5 sm:p-6">
          <span className="pill pill-planned">No connected sources yet</span>
          <h2 className="mt-3 font-display text-lg font-semibold text-(--ink)">Connect once, then let sync do the routine work</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">A supported connected source can keep its coverage and renewal evidence current without repeat uploads. Add manual evidence only where no direct source is available.</p>
          <Link href="/connect" className="btn btn-primary mt-4">Connect a source</Link>
        </div>
      )}

      <p className="mt-4 text-xs leading-5 text-(--muted)"><span className="font-semibold text-(--ink-soft)">Fresh</span> means the workspace ledger received a successful source update within its freshness window; it does not guarantee a provider has published every pending charge.</p>
    </div>
  );
}

function SourceCard({ source }: { source: DisplaySource }) {
  const freshness = getFreshnessPresentation(source);
  const nextSync = source.status === "revoked"
    ? "Disabled"
    : source.nextSyncAt
      ? formatTimestamp(source.nextSyncAt)
      : "Not scheduled yet";

  return (
    <article className="inset p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-data text-[0.64rem] text-(--muted)">{formatConnectorLabel(source.connectorId)}</p>
          <h2 className="mt-1 truncate font-display text-base font-semibold text-(--ink)" title={source.displayName}>{source.displayName}</h2>
        </div>
        <span className={freshness.className}>{freshness.label}</span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-sm">
        <SourceDatum label="Last sync" value={source.lastSyncedAt ? formatTimestamp(source.lastSyncedAt) : "Awaiting first sync"} dateTime={source.lastSyncedAt} />
        <SourceDatum label="Next sync" value={nextSync} dateTime={source.status === "revoked" ? null : source.nextSyncAt} />
        <SourceDatum label="Coverage" value={formatCoverage(source.coverageStartAt, source.coverageEndAt)} />
        <SourceDatum label="Coverage quality" value={formatCoverageCompleteness(source.coverageCompleteness)} />
        <SourceDatum label="Latest run" value={formatRunStatus(source.latestRunStatus)} />
        <SourceDatum label="Evidence signals" value={String(source.evidenceCount)} />
      </dl>
    </article>
  );
}

function Metric({ label, value, detail, tone = "neutral" }: { label: string; value: number; detail: string; tone?: "neutral" | "positive" | "warning" }) {
  const valueClass = tone === "positive" ? "text-verdict" : tone === "warning" ? "text-ochre" : "text-(--ink)";
  return (
    <div className="inset p-4">
      <dt className="font-data text-[0.65rem] text-(--muted)">{label}</dt>
      <dd className={`mt-2 font-display text-2xl font-semibold tnum ${valueClass}`}>{value}</dd>
      <dd className="mt-1 text-xs text-(--muted)">{detail}</dd>
    </div>
  );
}

function SourceDatum({ label, value, dateTime }: { label: string; value: string; dateTime?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="font-data text-[0.62rem] text-(--muted)">{label}</dt>
      <dd className="mt-1 break-words text-xs leading-5 text-(--ink-soft)">
        {dateTime ? <time dateTime={dateTime}>{value}</time> : value}
      </dd>
    </div>
  );
}

function SourceHealthLoading() {
  return (
    <div className="mt-6 grid gap-3" role="status" aria-label="Loading source health">
      <div className="h-20 animate-pulse rounded-xl border border-line bg-(--card-2)" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-48 animate-pulse rounded-xl border border-line bg-(--card-2)" />
        <div className="h-48 animate-pulse rounded-xl border border-line bg-(--card-2)" />
      </div>
      <span className="sr-only">Loading source health…</span>
    </div>
  );
}

function SignedOutState() {
  return (
    <div className="inset mt-6 p-5 sm:p-6">
      <span className="pill pill-partial">Sign-in required</span>
      <h2 className="mt-3 font-display text-lg font-semibold text-(--ink)">Your source status is private to your workspace</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">Sign in to see connected accounts, sync freshness, evidence coverage, and the next scheduled update.</p>
      <Link href="/login?next=%2Fsources" className="btn btn-primary mt-4">Sign in to view sources</Link>
    </div>
  );
}

function UnavailableState() {
  return (
    <div className="inset mt-6 p-5 sm:p-6">
      <span className="pill pill-blocked">Workspace ledger unavailable</span>
      <h2 className="mt-3 font-display text-lg font-semibold text-(--ink)">Connected-source status is not active in this deployment</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">The product can still accept fallback evidence, but automatic source history and freshness need the workspace data service to be configured.</p>
      <Link href="/app" className="btn btn-ghost mt-4">Return to app</Link>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="inset mt-6 p-5 sm:p-6" role="alert">
      <span className="pill pill-blocked">Status could not load</span>
      <h2 className="mt-3 font-display text-lg font-semibold text-(--ink)">We could not read your source ledger</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">{message}</p>
      <button type="button" className="btn btn-ghost mt-4" onClick={onRetry}>Try again</button>
    </div>
  );
}

function buildDisplaySources(data: SourceHealthPayload): DisplaySource[] {
  const accountById = new Map(data.accounts.map((account) => [account.id, account]));
  const healthRecords = data.sourceHealth.length
    ? data.sourceHealth
    : data.accounts.map((account) => ({
        connectedAccountId: account.id,
        connectorId: account.connectorId,
        status: account.status,
        freshnessStatus: account.freshnessStatus,
        coverageStartAt: account.coverageStartAt,
        coverageEndAt: account.coverageEndAt,
        coverageCompleteness: account.coverageCompleteness,
        lastSyncedAt: account.lastSyncedAt,
        nextSyncAt: account.nextSyncAt,
        latestRunStatus: account.latestRunStatus,
      }));

  return healthRecords.map((health) => {
    const account = accountById.get(health.connectedAccountId);
    return {
      ...health,
      displayName: account?.displayName || formatConnectorLabel(health.connectorId),
      evidenceCount: account?.evidenceCount ?? 0,
    };
  });
}

function getFreshnessPresentation(source: DisplaySource) {
  if (source.status === "revoked") return { label: "Disconnected", className: "pill pill-planned" };
  if (source.status === "error" || source.freshnessStatus === "error") return { label: "Sync issue", className: "pill pill-blocked" };
  if (source.freshnessStatus === "fresh") return { label: "Fresh", className: "pill pill-ready" };
  if (source.freshnessStatus === "stale") return { label: "Needs refresh", className: "pill pill-partial" };
  return { label: "Awaiting first sync", className: "pill pill-planned" };
}

function formatCoverage(startAt: string | null, endAt: string | null) {
  if (!startAt && !endAt) return "Not established yet";
  if (startAt && endAt) return `${formatDate(startAt)} – ${formatDate(endAt)}`;
  if (startAt) return `From ${formatDate(startAt)}`;
  return `Through ${formatDate(endAt as string)}`;
}

function formatCoverageCompleteness(value: CoverageCompleteness) {
  if (value === "complete") return "Complete provider window";
  if (value === "partial") return "Partial provider window";
  return "Not assessed yet";
}

function formatRunStatus(value: string | null) {
  if (!value) return "No run recorded";
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function formatConnectorLabel(value: string) {
  return value
    .split("-")
    .map((part) => part === "gmail" ? "Gmail" : part === "openai" ? "OpenAI" : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : dateTimeFormatter.format(date);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : dateFormatter.format(date);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readError(payload: Record<string, unknown>) {
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  return "Source status could not be loaded. Check your connection and try again.";
}
