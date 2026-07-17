"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import SourceAccountActions from "./source-account-actions";

type Freshness = "unknown" | "fresh" | "stale" | "error" | null;
type Account = {
  id: string;
  connectorId: string;
  displayName: string;
  status: string;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  coverageStartAt: string | null;
  coverageEndAt: string | null;
  coverageCompleteness: "partial" | "complete" | null;
  freshnessStatus: Freshness;
  latestRunStatus: string | null;
  evidenceCount: number;
};
type Payload = {
  status: "ok";
  accounts: Account[];
  recurringItems: Array<{ id: string }>;
  evidence: Array<{ id: string }>;
};
type State =
  | { kind: "loading" }
  | { kind: "ready"; data: Payload; checkedAt: Date; warning?: string }
  | { kind: "signed-out" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

const dateTime = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function SourceHealthClient() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [generation, setGeneration] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [mutationNotice, setMutationNotice] = useState<{ tone: "success" | "warning"; message: string } | null>(null);

  useEffect(() => {
    const refreshAfterMutation = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as { message?: unknown; tone?: unknown } | undefined : undefined;
      if (typeof detail?.message === "string") {
        setMutationNotice({ tone: detail.tone === "warning" ? "warning" : "success", message: detail.message });
      }
      setGeneration((value) => value + 1);
    };
    window.addEventListener("vognary:sources-changed", refreshAfterMutation);
    return () => window.removeEventListener("vognary:sources-changed", refreshAfterMutation);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;

    async function load() {
      try {
        const response = await fetch("/api/workspaces/current/connectors", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        const payload = await readJson(response);
        if (disposed) return;
        if (response.status === 401) return setState({ kind: "signed-out" });
        if (response.status === 501 || payload.status === "not-configured") return setState({ kind: "unavailable" });
        if (!response.ok || payload.status !== "ok") throw new Error(readError(payload));
        setState({ kind: "ready", data: payload as Payload, checkedAt: new Date() });
      } catch (error) {
        if (disposed || (error instanceof DOMException && error.name === "AbortError")) return;
        const message = error instanceof Error ? error.message : "Source status could not be loaded.";
        setState((current) => current.kind === "ready"
          ? { ...current, warning: "Refresh failed. The last status loaded on this page is still shown." }
          : { kind: "error", message });
      } finally {
        if (!disposed) setRefreshing(false);
      }
    }

    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [generation]);

  function refresh() {
    setRefreshing(true);
    setGeneration((value) => value + 1);
  }

  if (state.kind === "loading") return <Loading />;
  if (state.kind === "signed-out") return <SignedOut />;
  if (state.kind === "unavailable") return <Unavailable />;
  if (state.kind === "error") return <LoadError message={state.message} onRetry={refresh} />;

  const active = state.data.accounts.filter((account) => account.status !== "revoked");
  const attention = active.filter(needsAttention);
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div role="status" aria-live="polite">
          <p className="font-data text-[0.68rem] text-(--muted)">Checked <time dateTime={state.checkedAt.toISOString()}>{dateTime.format(state.checkedAt)}</time></p>
          <p className="mt-1 text-xs leading-5 text-(--muted)">{attention.length ? `${attention.length} source${attention.length === 1 ? " needs" : "s need"} attention.` : "No connected source currently reports a sync issue."}</p>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={refresh} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh status"}</button>
      </div>

      {state.warning ? <p className="mt-3 rounded-[10px] border border-ochre/30 bg-(--ochre-tint) px-3 py-2 text-sm text-ochre" role="status">{state.warning}</p> : null}
      {mutationNotice ? <p className={`mt-3 rounded-[10px] border px-3 py-2 text-sm ${mutationNotice.tone === "warning" ? "border-ochre/30 bg-(--ochre-tint) text-ochre" : "border-verdict/30 bg-(--verdict-tint) text-verdict"}`} role="status">{mutationNotice.message}</p> : null}

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <Metric label="Connected" value={active.length} detail="Authorized workspace sources" />
        <Metric label="Need attention" value={attention.length} detail="Failed, stale, or needs access" tone={attention.length ? "warning" : "positive"} />
        <Metric label="Commitments found" value={state.data.recurringItems.length} detail={`${state.data.evidence.length} evidence signals`} />
      </dl>

      {active.length ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {active.map((account) => <SourceCard key={account.id} account={account} />)}
        </div>
      ) : (
        <div className="inset mt-4 p-5 sm:p-6">
          <span className="pill pill-planned">No connected sources</span>
          <h2 className="mt-3 font-display text-lg font-semibold text-(--ink)">Add one only when it can reduce repeat evidence work</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">The available connection paths and their exact coverage are below. Receipt paste and redacted import remain available without a connector.</p>
          <a href="#add-source" className="btn btn-primary mt-4">Review available sources</a>
        </div>
      )}
    </div>
  );
}

function SourceCard({ account }: { account: Account }) {
  const freshness = freshnessPresentation(account);
  return (
    <article className="inset p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-data text-[0.64rem] text-(--muted)">{formatConnector(account.connectorId)}</p>
          <h2 className="mt-1 break-words font-display text-base font-semibold text-(--ink)">{account.displayName}</h2>
        </div>
        <span className={freshness.className}>{freshness.label}</span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4">
        <Datum label="Last sync" value={account.lastSyncedAt ? formatTimestamp(account.lastSyncedAt) : "Awaiting first sync"} />
        <Datum label="Next sync" value={account.nextSyncAt ? formatTimestamp(account.nextSyncAt) : "Not scheduled"} />
        <Datum label="Coverage" value={formatCoverage(account.coverageStartAt, account.coverageEndAt)} />
        <Datum label="Evidence" value={`${account.evidenceCount} signal${account.evidenceCount === 1 ? "" : "s"}`} />
      </dl>
      <SourceAccountActions account={{ id: account.id, connectorId: account.connectorId, displayName: account.displayName, status: account.status }} retry={needsAttention(account)} />
    </article>
  );
}

function Metric({ label, value, detail, tone = "neutral" }: { label: string; value: number; detail: string; tone?: "neutral" | "positive" | "warning" }) {
  const color = tone === "positive" ? "text-verdict" : tone === "warning" ? "text-ochre" : "text-(--ink)";
  return <div className="inset p-4"><dt className="font-data text-[0.65rem] text-(--muted)">{label}</dt><dd className={`mt-2 font-display text-2xl font-semibold tnum ${color}`}>{value}</dd><dd className="mt-1 text-xs text-(--muted)">{detail}</dd></div>;
}

function Datum({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="font-data text-[0.62rem] text-(--muted)">{label}</dt><dd className="mt-1 break-words text-xs leading-5 text-(--ink-soft)">{value}</dd></div>;
}

function Loading() {
  return <div className="mt-6 grid gap-3" role="status" aria-label="Loading source status"><div className="h-20 animate-pulse rounded-xl border border-line bg-(--card-2)" /><div className="h-40 animate-pulse rounded-xl border border-line bg-(--card-2)" /><span className="sr-only">Loading source status…</span></div>;
}

function SignedOut() {
  return <div className="inset mt-6 p-5 sm:p-6"><span className="pill pill-partial">Sign-in required</span><h2 className="mt-3 font-display text-lg font-semibold text-(--ink)">Source access stays private to your workspace</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">Sign in to see source status or authorize an optional connection. You can finish a guest audit before doing this.</p><Link href="/login?next=%2Fsources" className="btn btn-primary mt-4">Sign in to manage sources</Link></div>;
}

function Unavailable() {
  return <div className="inset mt-6 p-5 sm:p-6"><span className="pill pill-blocked">Workspace ledger unavailable</span><h2 className="mt-3 font-display text-lg font-semibold text-(--ink)">Connected-source status is not active here</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">Fallback evidence still works; automatic source history needs the workspace data service to be configured.</p><Link href="/app" prefetch={false} className="btn btn-ghost mt-4">Use fallback evidence</Link></div>;
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="inset mt-6 p-5 sm:p-6" role="alert"><span className="pill pill-blocked">Status could not load</span><h2 className="mt-3 font-display text-lg font-semibold text-(--ink)">We could not read your source ledger</h2><p className="mt-2 text-sm leading-6 text-(--muted)">{message}</p><button type="button" className="btn btn-ghost mt-4" onClick={onRetry}>Try again</button></div>;
}

function needsAttention(account: Account) {
  return account.status === "error" || account.status === "needs_reauth" || account.freshnessStatus === "stale" || account.freshnessStatus === "error" || account.latestRunStatus === "failed";
}

function freshnessPresentation(account: Account) {
  if (account.status === "needs_reauth") return { label: "Reconnect", className: "pill pill-blocked" };
  if (account.status === "error" || account.freshnessStatus === "error" || account.latestRunStatus === "failed") return { label: "Sync issue", className: "pill pill-blocked" };
  if (account.freshnessStatus === "fresh") return { label: "Fresh", className: "pill pill-ready" };
  if (account.freshnessStatus === "stale") return { label: "Needs refresh", className: "pill pill-partial" };
  return { label: "Awaiting sync", className: "pill pill-planned" };
}

function formatCoverage(start: string | null, end: string | null) {
  if (!start && !end) return "Not established";
  if (start && end) return `${formatDate(start)} – ${formatDate(end)}`;
  return start ? `From ${formatDate(start)}` : `Through ${formatDate(end as string)}`;
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Unavailable" : dateTime.format(parsed);
}

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Unavailable" : dateOnly.format(parsed);
}

function formatConnector(value: string) {
  return value.split("-").map((part) => part === "gmail" ? "Gmail" : part === "openai" ? "OpenAI" : part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try { return await response.json() as Record<string, unknown>; } catch { return {}; }
}

function readError(payload: Record<string, unknown>) {
  return typeof payload.error === "string" && payload.error.trim() ? payload.error : "Source status could not be loaded. Check your connection and try again.";
}
