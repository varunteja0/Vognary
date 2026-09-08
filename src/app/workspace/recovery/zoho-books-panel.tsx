"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BookCheck, BookOpen, ChevronDown, Link2, Play, RefreshCw, Trash2, Unplug } from "lucide-react";
import { isZohoBooksState, type ZohoBooksState, type ZohoConnectionStatus } from "@/lib/zoho-books/contracts";
import { controlProviderBillRetentionNotice, type ZohoBooksAdmissionStateDto } from "@/lib/commitment-control/provider-bill-contracts";
import { formatExactMinorUnits } from "@/components/ui/money-value";
import { formatDay, formatMoment } from "./labels";
import { RecoveryDialog } from "./recovery-dialog";
import { LoadingBlock } from "./recovery-states";

const endpoint = "/api/workspaces/current/sources/zoho-books";
const statusLabels: Record<ZohoConnectionStatus, string> = {
  AUTHORIZING: "Authorization unfinished", AWAITING_ORGANIZATION: "Choose an organization",
  QUEUED: "Import queued", SYNCING: "Import in progress", READY: "Last import complete",
  RETRY_WAIT: "Recovery scheduled", REAUTH_REQUIRED: "Reconnect required", FAILED: "Source needs review", REVOKED: "Disconnected",
};
const changeLabels = { BASELINE: "Initial import", NEW: "New bill", AMENDED: "Bill changed", VOIDED: "Voided by provider", REMOVED: "Removed by provider" };

class SourceResponseError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

type ReadableSourceState = ZohoBooksState & Partial<Pick<ZohoBooksAdmissionStateDto, "retainedAdmissionCount" | "retentionNotice">>;
function isReadableSourceState(value: unknown): value is ReadableSourceState {
  if (!isZohoBooksState(value)) return false;
  const source = value as ReadableSourceState;
  return source.retainedAdmissionCount === undefined && source.retentionNotice === undefined
    || Number.isSafeInteger(source.retainedAdmissionCount) && Number(source.retainedAdmissionCount) >= 0 && source.retentionNotice === controlProviderBillRetentionNotice;
}

async function readState(workspaceId: string, changes: boolean, cursor?: string, signal?: AbortSignal): Promise<ReadableSourceState> {
  const query = new URLSearchParams({ changes: String(changes), ...(cursor ? { cursor } : {}) });
  const response = await fetch(`${endpoint}?${query}`, { cache: "no-store", headers: { "X-Vognary-Workspace": workspaceId }, signal });
  const payload: unknown = await response.json();
  if (!response.ok) throw new SourceResponseError(response.status === 401 ? "Sign in again to open source observations." : "Source observations could not be opened. Reload the workspace before continuing.", response.status);
  if (!payload || typeof payload !== "object" || !("data" in payload) || !isReadableSourceState(payload.data)) throw new SourceResponseError("The source response could not be verified. No new financial values were displayed.");
  return payload.data;
}

export default function ZohoBooksPanel({ workspaceId, connectionOnly = false, onChanged }: { workspaceId: string; connectionOnly?: boolean; onChanged?: () => void }) {
  const [loaded, setLoaded] = useState<{ workspaceId: string; changes: boolean; data: ReadableSourceState } | null>(null);
  const [changesOnly, setChangesOnly] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [consent, setConsent] = useState(false);
  const [organization, setOrganization] = useState("");
  const [dialog, setDialog] = useState<"DISCONNECT" | "ERASE" | null>(null);
  const [retainedCountAcknowledged, setRetainedCountAcknowledged] = useState<number | null>(null);
  const sequence = useRef(0);
  const actionLock = useRef(false);
  const data = loaded?.workspaceId === workspaceId && loaded.changes === changesOnly ? loaded.data : null;
  const connection = data?.connection;
  const retainedCount = data?.retentionNotice === controlProviderBillRetentionNotice ? data.retainedAdmissionCount ?? null : null;

  useEffect(() => {
    const controller = new AbortController();
    const request = ++sequence.current;
    void readState(workspaceId, changesOnly, undefined, controller.signal).then(value => {
      if (request !== sequence.current) return;
      setLoaded({ workspaceId, changes: changesOnly, data: value });
      setError(null);
    }).catch(failure => {
      if (controller.signal.aborted || request !== sequence.current) return;
      if (failure instanceof SourceResponseError && [401, 403].includes(failure.status)) setLoaded(null);
      setError(failure instanceof SourceResponseError ? failure.message : "Source observations could not be loaded. Your saved records have not been replaced.");
    });
    return () => controller.abort();
  }, [workspaceId, changesOnly, refresh]);

  useEffect(() => {
    const onFocus = () => { if (!actionLock.current) setRefresh(value => value + 1); };
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => {
      if (!document.hidden && !actionLock.current && connection && ["QUEUED", "SYNCING", "RETRY_WAIT"].includes(connection.status)) onFocus();
    }, 30_000);
    return () => { window.removeEventListener("focus", onFocus); window.clearInterval(interval); };
  }, [connection]);

  async function perform(action: string, extra: Record<string, unknown> = {}) {
    if (actionLock.current) return;
    if (action === "ERASE" && (retainedCount === null || retainedCount > 0 && retainedCountAcknowledged !== retainedCount)) return;
    actionLock.current = true;
    sequence.current += 1;
    setPending(action);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json", "X-Vognary-Workspace": workspaceId },
        body: JSON.stringify({ action, revision: connection?.revision, ...extra,
          ...(action === "ERASE" && retainedCount !== null && retainedCount > 0 ? { retentionAcknowledgement: { noticeVersion: controlProviderBillRetentionNotice, retainAdmitted: true, retainedAdmissionCount: retainedCount } } : {}),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new SourceResponseError(typeof payload.error?.message === "string" ? payload.error.message : "The source action was rejected. Reload before continuing.", response.status);
      if (action === "AUTHORIZE") {
        const destination = new URL(payload.data?.authorizationUrl);
        if (destination.origin !== "https://accounts.zoho.in" || destination.pathname !== "/oauth/v2/auth") throw new SourceResponseError("The source authorization destination could not be verified.");
        window.location.assign(destination.toString());
        return;
      }
      if (!isReadableSourceState(payload.data)) throw new SourceResponseError("The result could not be verified. Reload to inspect the saved source state.");
      setDialog(null);
      setRetainedCountAcknowledged(null);
      setOrganization("");
      setLoaded({ workspaceId, changes: false, data: payload.data });
      setChangesOnly(false);
      onChanged?.();
    } catch (failure) {
      setError(failure instanceof SourceResponseError ? failure.message : "The source action's result is unconfirmed. Reload the source before starting another change.");
      if (action === "ERASE") { setRetainedCountAcknowledged(null); setRefresh(value => value + 1); }
    } finally {
      actionLock.current = false;
      setPending(null);
    }
  }

  async function loadMore() {
    if (!data?.nextCursor || loadingMore || actionLock.current) return;
    const request = ++sequence.current;
    setLoadingMore(true);
    try {
      const page = await readState(workspaceId, changesOnly, data.nextCursor);
      if (request !== sequence.current) return;
      setLoaded({ workspaceId, changes: changesOnly, data: {
        ...page, throughSequence: data.throughSequence,
        items: [...new Map([...data.items, ...page.items].map(item => [item.bill.billId, item])).values()],
      } });
    } catch {
      setError("Older bill observations could not be loaded. The current page is kept.");
    } finally { setLoadingMore(false); }
  }

  const canReconnect = data?.canManage && data.configured && (!connection || ["AUTHORIZING", "REAUTH_REQUIRED", "REVOKED"].includes(connection.status));
  return (
    <section className="grid min-w-0 gap-4 border-b border-line pb-6" aria-labelledby="zoho-books-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="zoho-books-heading" className="flex items-center gap-2 font-display text-xl font-semibold"><BookOpen size={20} aria-hidden />Zoho Books</h3>
        <button type="button" className="btn btn-sm btn-ghost" aria-label="Reload Books observations" title="Reload saved observations" disabled={pending !== null} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} aria-hidden /></button>
      </div>
      {error ? <div role="alert" className="text-sm leading-6 text-ember">{error} <Link href="/login?next=%2Fapp%3Fview%3DBILL_REVIEW" className="link-quiet">Sign in</Link></div> : null}
      {!data && !error ? <LoadingBlock label="Opening Books observations..." /> : null}
      {data ? <>
        <div className="grid gap-2">
          <p className="text-sm font-medium text-(--ink)">{connection?.organizationName ?? "No organization selected"}</p>
          <p className="text-sm text-(--muted)" role="status">{!data.configured ? "Access is not configured for this workspace. No provider reads are running here." : connection ? statusLabels[connection.status] : "Not connected"}</p>
          {connection ? <dl className="grid gap-2 text-sm text-(--muted)">
            <div><dt className="inline">Last complete import: </dt><dd className="inline">{connection.lastSuccessfulSyncAt ? formatMoment(connection.lastSuccessfulSyncAt) : "Not completed"}</dd></div>
            <div><dt className="inline">Bill history begins: </dt><dd className="inline">{formatDay(connection.coverageStart)}</dd></div>
            {connection.nextScheduledAt && data.configured ? <div><dt className="inline">Next eligible background run: </dt><dd className="inline">{formatMoment(connection.nextScheduledAt)}</dd></div> : null}
          </dl> : null}
          {connection && ["QUEUED", "SYNCING"].includes(connection.status) ? <p className="text-sm leading-6 text-(--muted)">History is incomplete. Imported records are available below while the remaining pages wait for background processing.</p> : null}
          {connection?.status === "RETRY_WAIT" ? <p className="text-sm leading-6 text-(--muted)">Vognary will retry this source. Saved observations remain available; their freshness has not advanced.</p> : null}
          {connection?.status === "FAILED" ? <p className="text-sm leading-6 text-ember">Vognary needs to review this source. Background reads are paused; the last saved observations are retained.</p> : null}
          {connection?.failureCode === "ABSENCE_UNCONFIRMED" ? <p className="text-sm leading-6 text-ember">A bill could not be located at the provider. Removal is unconfirmed; no retained bill was marked removed.</p> : null}
          {connection?.incident && !connection.incident.recoveredAt ? <div className="grid gap-2 text-sm leading-6">
            <p className="text-(--muted)">Incident {connection.incident.id}. {!connection.incident.assignedOperatorUserId ? "No operator is assigned in this environment." : connection.incident.deliveryStatus === "DELIVERED" ? "Operator notification reached the configured monitoring sink. Human acknowledgement is not verified." : "Operator notification delivery is not confirmed."}</p>
            {connection.incident.canResume ? <button type="button" className="btn btn-sm btn-primary justify-self-start" disabled={pending !== null} onClick={() => void perform("RESUME", { incidentId: connection.incident!.id })}><Play size={16} aria-hidden />Resume source reads</button> : null}
            {connection.incident.canEscalate ? <button type="button" className="btn btn-sm btn-ghost justify-self-start" disabled={pending !== null} onClick={() => void perform("ESCALATE", { incidentId: connection.incident!.id })}><RefreshCw size={16} aria-hidden />Take incident and retry notification</button> : null}
          </div> : null}
          {connection?.status === "REAUTH_REQUIRED" ? <p className="text-sm leading-6 text-ember">Source access or its authorizer changed. An owner or admin must reconnect before background reads can resume.</p> : null}
          {connection?.providerRevocation === "UNCONFIRMED" ? <p className="text-sm leading-6 text-ember">Local access has stopped. Provider revocation was not confirmed; remove Vognary from Connected Apps in your Zoho account.</p> : null}
        </div>

        {canReconnect ? <div className="grid gap-3">
          <p className="text-sm leading-6">Read your selected Zoho Books India organization and its supplier bills. Import 90 days of history, then check new and changed bills in the background. No bill entry is required.</p>
          <p className="text-sm leading-6 text-(--muted)">No email, bank, purchase, approval or payment access. Disconnect stops future reads; signing out does not disconnect Books. Deleting the source removes imported revisions and reviews, but explicitly admitted bills and saved Control comparisons remain.</p>
          <details className="control-more">
            <summary>Permission and retention details</summary>
            <div className="control-more-body grid gap-2 text-sm leading-6">
              <p>Reads organization details and supplier bills in the Zoho India data center. The first import starts with 90 days of bill history; later reads check new and changed bills.</p>
              <p>Only the bill fields used in this feed are retained, including prior revisions. Disconnect stops local reads. Deleting the source removes imports and reviews, not admitted bills or their immutable Control history. Whole-workspace erasure removes the full chain, subject to backup retention. Nothing is deleted in Zoho.</p>
              <p>No email, bank, purchase, approval or payment permissions are requested. Google sign-in does not grant this access.</p>
              <p className="font-data text-xs break-words">ZohoBooks.settings.READ · ZohoBooks.bills.READ</p>
            </div>
          </details>
          <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="tick mt-1" checked={consent} onChange={event => setConsent(event.target.checked)} />I can authorize this read-only organization access and have reviewed its retention.</label>
          <button type="button" className="btn btn-primary justify-self-start" disabled={!consent || pending !== null} onClick={() => void perform("AUTHORIZE", { consentVersion: "zoho-books-read-v1" })}><Link2 size={16} aria-hidden />{pending === "AUTHORIZE" ? "Opening consent..." : connection ? "Reconnect Zoho Books" : "Connect Zoho Books"}</button>
        </div> : null}

        {connection?.status === "AWAITING_ORGANIZATION" && data.canManage && data.configured ? <div className="grid gap-3">
          <label htmlFor="zoho-organization" className="field-label">Choose your organization</label>
          <select id="zoho-organization" className="field" value={organization} disabled={pending !== null} onChange={event => setOrganization(event.target.value)}>
            <option value="">Choose an organization...</option>
            {data.organizations.map(item => <option key={item.id} value={item.id} disabled={!item.active || Boolean(connection.organizationId && connection.organizationId !== item.id)}>{item.name} · {item.currency}{!item.active ? " · inactive" : ""}</option>)}
          </select>
          <button type="button" className="btn btn-primary justify-self-start" disabled={!organization || pending !== null} onClick={() => void perform("SELECT", { organizationId: organization })}><Link2 size={16} aria-hidden />{pending === "SELECT" ? "Importing first page..." : "Connect organization"}</button>
        </div> : null}
        {!data.canManage ? <p className="text-sm text-(--muted)">An owner or admin manages source access.</p> : null}

        {connection?.organizationId && !connectionOnly ? <>
          <p className="text-sm leading-6 text-(--muted)">Bill totals include the provider&apos;s taxes, discounts and adjustments. A bill or its balance is not proof of a payment. These observations do not change caps or enter Recovery automatically.</p>
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="sr-only">Books observation view</legend>
            <label className="flex items-center gap-2"><input type="radio" name="books-view" checked={!changesOnly} disabled={pending !== null} onChange={() => setChangesOnly(false)} />All imported bills</label>
            <label className="flex items-center gap-2"><input type="radio" name="books-view" checked={changesOnly} disabled={pending !== null} onChange={() => setChangesOnly(true)} />Unreviewed changes</label>
          </fieldset>
          {data.items.length === 0 ? <p className="text-sm leading-6 text-(--muted)">{changesOnly ? "No unreviewed bill changes in the imported history." : "No bills have been imported in this source window. This does not establish zero company exposure."}</p> : (
            <div className="grid min-w-0" aria-label="Imported Books bills">
              {data.items.map(item => <article key={item.bill.billId} className="grid min-w-0 gap-3 border-b border-line py-4" aria-label={`Books bill ${item.bill.billNumber}`}>
                <div className="flex flex-wrap items-start justify-between gap-2"><h4 className="min-w-0 break-words font-medium">{item.bill.vendorName}</h4><span className="text-xs font-medium text-(--muted)">{changeLabels[item.changeKind]}</span></div>
                <p className="text-sm text-(--muted)">{item.bill.billNumber} · {formatDay(item.bill.date)} · {item.bill.status.replaceAll("_", " ")}</p>
                <dl className="grid gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2"><dt className="text-sm">Bill total</dt><dd className="break-words font-data text-lg">{formatExactMinorUnits(item.bill.totalMinor, item.bill.currency)}</dd></div>
                  {item.previous && (item.previous.totalMinor !== item.bill.totalMinor || item.previous.currency !== item.bill.currency) ? <div className="flex flex-wrap items-baseline justify-between gap-2"><dt className="text-sm text-(--muted)">Previously observed</dt><dd className="font-data text-sm">{formatExactMinorUnits(item.previous.totalMinor, item.previous.currency)}</dd></div> : null}
                </dl>
                <details className="control-more"><summary>Source details</summary><div className="control-more-body grid gap-2 text-sm break-words">
                  <p>Outstanding balance: {formatExactMinorUnits(item.bill.balanceMinor, item.bill.currency)}. This is not cash paid.</p>
                  <p>Organization {connection.organizationId} · vendor {item.bill.vendorId} · bill {item.bill.billId}</p>
                  <p>Provider modified {formatMoment(item.bill.modifiedAt)}. Observed by Vognary {formatMoment(item.observedAt)}.</p>
                  <p>Immutable source revision {item.sequence} · transformation version {item.bill.version}</p>
                  {item.changeKind === "REMOVED" ? <p>This bill was not found when checked at the provider. The displayed amount is the retained prior observation, not a current payable amount.</p> : null}
                </div></details>
                <Link className="link-quiet justify-self-start" href={`/app?view=BILL_REVIEW&bill=${item.bill.billId}`}>Open bill review</Link>
                {changesOnly && data.canManage ? <button type="button" className="btn btn-sm btn-ghost justify-self-start" disabled={pending !== null} onClick={() => void perform("REVIEW", { sequences: [item.sequence] })}><BookCheck size={16} aria-hidden />Acknowledge this revision</button> : null}
              </article>)}
            </div>
          )}
          <p className="text-sm text-(--muted)" role="status">{data.items.length} of {data.total} bill records</p>
          {data.nextCursor ? <button type="button" className="btn btn-sm btn-ghost justify-self-start" disabled={loadingMore || pending !== null} onClick={() => void loadMore()}><ChevronDown size={16} aria-hidden />{loadingMore ? "Loading observations..." : "Load older observations"}</button> : null}
          {changesOnly ? <p className="text-sm text-(--muted)">Acknowledgement is shared with the workspace. It records reading, not resolution.</p> : null}
        </> : null}
        {connection && data.canManage ? <div className="flex flex-wrap gap-3">
          {connection.status !== "REVOKED" ? <button id="zoho-disconnect" type="button" className="btn btn-sm btn-ghost" disabled={pending !== null} onClick={() => setDialog("DISCONNECT")}><Unplug size={16} aria-hidden />Disconnect</button> : <button id="zoho-erase" type="button" className="btn btn-sm btn-ember" disabled={pending !== null} onClick={() => { setRetainedCountAcknowledged(null); setDialog("ERASE"); }}><Trash2 size={16} aria-hidden />Delete observations</button>}
        </div> : null}
      </> : null}
      {dialog ? <RecoveryDialog title={dialog === "DISCONNECT" ? "Disconnect Zoho Books" : "Delete Books observations"} description={dialog === "DISCONNECT" ? "Stop future reads and clear local source credentials. Existing observations will remain available." : "Delete imported bill revisions, source reviews and grants. Admitted bills and their frozen Control comparisons stay readable. Nothing in Zoho is changed."} returnFocusId={dialog === "DISCONNECT" ? "zoho-disconnect" : "zoho-erase"} onClose={() => { if (!pending) setDialog(null); }} footer={<><button type="button" className="btn btn-ghost" disabled={pending !== null} onClick={() => setDialog(null)}>Cancel</button><button type="button" className="btn btn-ember" disabled={pending !== null || dialog === "ERASE" && (retainedCount === null || retainedCount > 0 && retainedCountAcknowledged !== retainedCount)} onClick={() => void perform(dialog, dialog === "ERASE" ? { confirmation: "DELETE_OBSERVATIONS" } : {})}>{pending ? "Saving..." : dialog === "DISCONNECT" ? "Disconnect" : "Delete observations"}</button></>}>
        <p className="text-sm leading-6">{connection?.organizationName ?? "This source"}</p>
        {dialog === "ERASE" ? <div className="grid gap-3 mt-3 text-sm leading-6">
          {retainedCount === null ? <p role="alert">The retained-admission count is unavailable. Reload source settings before deleting imports.</p> : <p>{retainedCount} admitted bill record{retainedCount === 1 ? "" : "s"} and their saved comparison history will remain.</p>}
          {retainedCount !== null && retainedCount > 0 ? <label className="flex items-start gap-3"><input className="tick" type="checkbox" checked={retainedCountAcknowledged === retainedCount} disabled={pending !== null} onChange={event => setRetainedCountAcknowledged(event.target.checked ? retainedCount : null)} />I understand these {retainedCount} admitted bill records, consent and selection history will remain after source deletion.</label> : null}
          <p>Whole-workspace erasure removes the full chain, subject to backup retention. This source deletion does not erase every financial record.</p>
          {error ? <p role="alert" className="text-ember">{error}</p> : null}
        </div> : null}
      </RecoveryDialog> : null}
    </section>
  );
}
