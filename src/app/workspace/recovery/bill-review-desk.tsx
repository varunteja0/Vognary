"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, CheckCheck, Clock3, ListFilter, RefreshCw, Search } from "lucide-react";
import { isZohoBooksPageCursor, zohoBooksSorts, type ZohoBooksSort, type ZohoBooksState, type ZohoBooksView, type ZohoObservation } from "@/lib/zoho-books/contracts";
import { formatExactMinorUnits } from "@/components/ui/money-value";
import { BillReviewError, readBillReview } from "./bill-review-transport";
import { formatDay, formatMoment } from "./labels";
import styles from "./bill-review.module.css";

const Source = dynamic(() => import("./zoho-books-panel"));
const Detail = dynamic(() => import("./bill-review-detail"));
const views: Array<{ id: ZohoBooksView; label: string; icon: typeof ListFilter }> = [{ id: "ATTENTION", label: "Needs review", icon: ListFilter }, { id: "FOLLOW_UP", label: "Follow-ups", icon: Clock3 }, { id: "RESOLVED", label: "Closed", icon: CheckCheck }, { id: "ALL", label: "All bills", icon: ListFilter }];
type Selection = { billId: string | null; revision?: string; view: ZohoBooksView; search: string; sort: ZohoBooksSort; currency: string; cursor?: string };
const initialSelection: Selection = { billId: null, view: "ATTENTION", search: "", sort: "UPDATED", currency: "" };

function changeLabel(item: ZohoObservation) {
  if (item.changeKind === "REMOVED") return "Source removal; last total retained";
  if (!item.previous) return item.changeKind === "BASELINE" ? "Imported total" : "New bill";
  if (item.previous.currency !== item.bill.currency) return "Currency changed; not comparable";
  const difference = BigInt(item.bill.totalMinor) - BigInt(item.previous.totalMinor);
  return difference === BigInt(0) ? "Total unchanged" : `${difference > BigInt(0) ? "+" : "-"}${formatExactMinorUnits((difference < BigInt(0) ? -difference : difference).toString(), item.bill.currency)}`;
}

function sourceStatus(data: ZohoBooksState, loadedAt: number) {
  if (!data.configured) return "Provider reads not configured";
  const connection = data.connection;
  if (connection?.status === "REAUTH_REQUIRED") return "Reconnect required";
  if (connection?.status === "FAILED") return "Updates stopped; operator action needed";
  if (connection?.status === "REVOKED") return "Disconnected; retained records only";
  if (connection?.status !== "READY") return "Import incomplete";
  if (!connection.nextScheduledAt || Date.parse(connection.nextScheduledAt) <= loadedAt) return "Update overdue";
  return "Last import complete";
}

function reviewLabel(item: ZohoObservation) {
  if (item.openFollowUpCount) return `Follow-up due ${item.followUpOn ? formatDay(item.followUpOn) : "date unavailable"}`;
  if (item.pendingReviewCount) return `${item.pendingReviewCount} unanswered ${item.pendingReviewCount === 1 ? "change" : "changes"}`;
  if (item.disposition?.kind === "RESOLVED" || item.lastResolvedReview) return "Review closed";
  if (item.reviewRelevance === "INFORMATIONAL") return "Informational update";
  return item.changeKind === "BASELINE" ? "Imported / not reviewed" : "Needs review";
}

function selectionUrl(selection: Selection) {
  const query = new URLSearchParams({ view: "BILL_REVIEW", billView: selection.view });
  for (const [key, value] of Object.entries({ bill: selection.billId, billRevision: selection.revision, billSearch: selection.search, billSort: selection.sort, billCurrency: selection.currency, billCursor: selection.cursor })) if (value) query.set(key, value);
  return `/app?${query}`;
}

function selectionFromUrl(): Selection {
  const query = new URLSearchParams(window.location.search);
  const bill = query.get("bill");
  const revision = query.get("billRevision");
  const view = query.get("billView");
  const sort = query.get("billSort");
  const cursor = query.get("billCursor");
  return { billId: bill && /^\d{1,64}$/.test(bill) ? bill : null, revision: revision && /^[1-9]\d{0,18}$/.test(revision) ? revision : undefined,
    view: views.some(item => item.id === view) ? view as ZohoBooksView : "ATTENTION", search: (query.get("billSearch") ?? "").slice(0, 160),
    sort: (zohoBooksSorts as readonly unknown[]).includes(sort) ? sort as ZohoBooksSort : "UPDATED", currency: query.get("billCurrency") ?? "", cursor: isZohoBooksPageCursor(cursor) ? cursor : undefined };
}

export default function BillReviewDesk({ workspaceId }: { workspaceId: string }) {
  const [selection, setSelection] = useState<Selection>(initialSelection);
  const [search, setSearch] = useState("");
  const [data, setData] = useState<ZohoBooksState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loadedKey, setLoadedKey] = useState("");
  const [loadedAt, setLoadedAt] = useState(0);
  const [pages, setPages] = useState<Array<string | undefined>>([]);
  const generation = useRef(0);
  const sourceControls = useRef<HTMLDetailsElement>(null);
  const listContext = useRef<{ billId: string; scroll: number } | null>(null);
  const requestKey = JSON.stringify([workspaceId, selection.view, selection.search, selection.sort, selection.currency, selection.cursor, refresh]);
  const updating = loadedKey !== requestKey;
  function restoreList() {
    const context = listContext.current ?? window.history.state?.billListContext;
    if (!context) return;
    requestAnimationFrame(() => {
      document.getElementById(`bill-row-${context.billId}`)?.focus({ preventScroll: true });
      window.scrollTo({ top: context.scroll, behavior: "instant" });
    });
  }
  useEffect(() => {
    const update = () => {
      const next = selectionFromUrl();
      const previous = window.history.state?.billPageCursors;
      const context = window.history.state?.billListContext;
      listContext.current = context && typeof context.billId === "string" && /^\d{1,64}$/.test(context.billId) && Number.isFinite(context.scroll) && context.scroll >= 0 ? context : null;
      setPages(Array.isArray(previous) && previous.every(cursor => cursor === null || isZohoBooksPageCursor(cursor)) ? previous.map(cursor => cursor ?? undefined) : []);
      setSelection(next);
      setSearch(next.search);
      if (!next.billId) restoreList();
    };
    update();
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const request = ++generation.current;
    void readBillReview(workspaceId, selection.view, selection.cursor, controller.signal, { search: selection.search, sort: selection.sort, currency: selection.currency }).then(value => {
      if (request === generation.current) { setData(value); setLoadedKey(requestKey); setLoadedAt(Date.now()); setError(null); }
    }).catch(failure => {
      if (controller.signal.aborted || request !== generation.current) return;
      if (failure instanceof BillReviewError && [401, 403].includes(failure.status)) setData(null);
      setError(failure instanceof Error ? failure.message : "The bill desk could not be opened.");
    });
    return () => controller.abort();
  }, [workspaceId, selection.view, selection.search, selection.sort, selection.currency, selection.cursor, refresh, requestKey]);
  useEffect(() => {
    const update = () => setRefresh(value => value + 1);
    window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, []);

  function navigate(next: Selection, previous = pages) {
    window.history.pushState({ ...window.history.state, billListContext: listContext.current, billPageCursors: previous.map(cursor => cursor ?? null) }, "", selectionUrl(next));
    setPages(previous);
    setSelection(next);
    setSearch(next.search);
    if (!next.billId) restoreList();
  }

  function filter(next: Partial<Selection>) {
    listContext.current = null;
    navigate({ ...selection, ...next, billId: null, revision: undefined, cursor: undefined }, []);
  }

  return <section className={`${styles.desk} ${selection.billId ? styles.selected : ""}`} aria-label="Supplier bill review">
    <header className={`${styles.top} ${styles.intro}`}><h3 className={styles.title}>{data?.connection?.organizationName ?? "Your bill reviews"}</h3><button type="button" className="btn btn-sm btn-ghost" aria-label="Reload bill review desk" title="Reload saved bills" onClick={() => { filter({}); setRefresh(value => value + 1); }}><RefreshCw size={18} aria-hidden /></button></header>
    {error ? <p role="alert" className={`${styles.notice} ${styles.error}`}>{error}</p> : null}
    {!data && !error ? <div className={styles.loading} role="status">Opening your saved bills...</div> : null}
    {data && !data.connection?.organizationId ? <div className={styles.empty}><Source workspaceId={workspaceId} connectionOnly onChanged={() => setRefresh(value => value + 1)} /><Link className="btn btn-ghost justify-self-start" href="/start">Open synthetic bill review<ArrowUpRight size={16} aria-hidden /></Link><p className={styles.muted}>Bill-review evaluation needs no policy setup. It does not activate the <Link href="/pay" className="link-quiet">Commitment Control pilot</Link>. Provider permission and customer-data eligibility are separate.</p></div> : null}
    {data?.connection?.organizationId ? <>
      <section className={`${styles.overview} ${styles.statusLine}`} aria-label="Available bill records">
        <div className={styles.top}><strong>{data.overview ? `${data.overview.billCount} available` : "Available records"}</strong><button type="button" className="link-quiet" onClick={() => { if (sourceControls.current) { sourceControls.current.open = true; sourceControls.current.querySelector("summary")?.focus(); } }}>{sourceStatus(data, loadedAt)}</button></div>
        {data.overview ? <p className={styles.muted}>{data.overview.needsReviewCount} need review / {data.overview.followUpCount} with follow-ups. No complete-company coverage.</p> : <p className={styles.muted}>No complete-company coverage.</p>}
        {selection.cursor ? <p className={styles.muted}>Saved register snapshot. First page loads the latest review state.</p> : null}
      </section>
      <nav className={styles.toolbar} aria-label="Bill review views">{views.map(({ id, label, icon: Icon }) => <button type="button" className={styles.tab} key={id} aria-current={selection.view === id ? "page" : undefined} onClick={() => filter({ view: id })}><Icon size={16} aria-hidden />{label}</button>)}</nav>
      <form className={styles.filters} role="search" aria-label="Search bill register" onSubmit={event => { event.preventDefault(); filter({ search: search.trim() }); }}>
        <label className={styles.search}>Supplier or bill number<div><input className="field" type="search" maxLength={160} value={search} onChange={event => setSearch(event.target.value)} /><button type="submit" className="btn btn-ghost" aria-label="Search bills" title="Search bills"><Search size={18} aria-hidden /></button></div></label>
        <details className={styles.filterOptions} open={selection.sort !== "UPDATED" || Boolean(selection.currency) || undefined}><summary>Sort and currency{selection.currency ? ` / ${selection.currency}` : ""}</summary><div>
          <label>Sort by<select className="field" value={selection.sort} onChange={event => filter({ sort: event.target.value as ZohoBooksSort })}><option value="UPDATED">Latest observed</option><option value="SUPPLIER">Supplier A to Z</option><option value="DATE">Bill date, newest</option><option value="AMOUNT_DESC">Amount, high to low</option><option value="AMOUNT_ASC">Amount, low to high</option></select></label>
          <label>Currency<select className="field" value={selection.currency} onChange={event => filter({ currency: event.target.value })}><option value="">All currencies</option>{(data.register?.currencies ?? []).map(currency => <option key={currency} value={currency}>{currency}</option>)}</select></label>
        </div></details>
      </form>
      <div className={`${styles.layout} ${selection.billId ? "" : styles.registerLayout}`}>
        <div className={`${styles.list} ${selection.billId ? styles.selectedList : ""}`} aria-label="Bill attention list" aria-busy={updating && !error}>
          <p className={styles.resultStatus} role="status">{updating && !error ? "Updating saved results..." : `${data.items.length} shown / ${data.total} matching bills`}{selection.sort.startsWith("AMOUNT_") && !selection.currency ? " / grouped by currency" : ""}</p>
          {data.items.length ? <table className={`${styles.register} ${selection.billId ? styles.compactRegister : ""}`}><caption className="sr-only">Imported bill register</caption><thead><tr><th scope="col">Supplier / bill</th><th scope="col">Total / change</th><th scope="col">Bill date</th><th scope="col">Review / next action</th></tr></thead><tbody>{data.items.map(item => <tr key={item.bill.billId} aria-selected={selection.billId === item.bill.billId || undefined}>
            <td><Link id={`bill-row-${item.bill.billId}`} href={selectionUrl({ ...selection, billId: item.bill.billId, revision: selection.view === "ATTENTION" ? item.pendingReviewSequence ?? undefined : undefined })} aria-current={selection.billId === item.bill.billId ? "true" : undefined} onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); listContext.current = { billId: item.bill.billId, scroll: window.scrollY }; window.history.replaceState({ ...window.history.state, billListContext: listContext.current }, ""); navigate({ ...selection, billId: item.bill.billId, revision: selection.view === "ATTENTION" ? item.pendingReviewSequence ?? undefined : undefined }); }}><strong>{item.bill.vendorName}</strong></Link><span className={styles.muted}>{item.bill.billNumber}</span></td>
            <td><span className={styles.money}>{formatExactMinorUnits(item.bill.totalMinor, item.bill.currency)}</span><span className={styles.muted}>{changeLabel(item)}</span></td>
            <td><time dateTime={item.bill.date}>{formatDay(item.bill.date)}</time></td>
            <td><span>{reviewLabel(item)}</span>{item.responsibleUserId ? <span className={styles.muted}>Responsible: {data.people?.find(person => person.userId === item.responsibleUserId)?.displayName ?? (item.responsibleUserId === data.viewerUserId ? "You" : "Name unavailable")}</span> : null}{item.pendingReviewSince ? <span className={styles.muted}>Waiting since {formatMoment(item.pendingReviewSince)}</span> : null}<span className={styles.muted}>{item.openFollowUpCount ? "Open follow-up" : item.pendingReviewCount ? "Review change" : item.disposition?.kind === "RESOLVED" || item.lastResolvedReview ? "View result" : "View bill"}</span></td>
          </tr>)}</tbody></table> : <div className={styles.empty}><strong>{selection.search || selection.currency ? "No matching bills" : selection.view === "FOLLOW_UP" ? "No open follow-ups" : selection.view === "RESOLVED" ? "No closed reviews yet" : selection.view === "ALL" ? "No bills in imported coverage" : "No bill changes waiting"}</strong><p className={styles.muted}>{sourceStatus(data, loadedAt) === "Last import complete" ? "Initial imports and informational updates stay in All bills without being marked reviewed. Missing coverage is not an all-clear." : "Source coverage is incomplete or paused. This is not an all-clear."}</p>{selection.view !== "ALL" ? <button type="button" className="btn btn-ghost justify-self-start" onClick={() => filter({ view: "ALL" })}>View all bills</button> : null}</div>}
          {selection.cursor || data.nextCursor ? <nav className={styles.pagination} aria-label="Bill register pages"><button className="btn btn-sm btn-ghost" type="button" disabled={!selection.cursor || updating} onClick={() => navigate({ ...selection, cursor: undefined }, [])}>First page</button><button className="btn btn-sm btn-ghost" type="button" disabled={!selection.cursor || !pages.length || updating} onClick={() => navigate({ ...selection, cursor: pages.at(-1) }, pages.slice(0, -1))}><ArrowLeft size={16} aria-hidden />Previous</button><button className="btn btn-sm btn-ghost" type="button" disabled={!data.nextCursor || updating} onClick={() => navigate({ ...selection, cursor: data.nextCursor! }, [...pages, selection.cursor])}>Next<ArrowRight size={16} aria-hidden /></button></nav> : null}
        </div>
        {selection.billId ? <Detail key={`${workspaceId}:${selection.billId}:${selection.revision ?? "current"}`} workspaceId={workspaceId} billId={selection.billId} revision={selection.revision} refresh={refresh} onSelect={(billId, revision) => navigate({ ...selection, billId, revision })} onBack={() => navigate({ ...selection, billId: null, revision: undefined })} onSaved={() => setRefresh(value => value + 1)} /> : null}
      </div>
      <details ref={sourceControls} className={`${styles.source} ${styles.sourceControls}`}><summary>Connection and import status</summary>
        <p className={styles.muted}>Books bills from {formatDay(data.connection.coverageStart)}. Last complete import: {data.connection.lastSuccessfulSyncAt ? formatMoment(data.connection.lastSuccessfulSyncAt) : "Not completed"}.</p>
        {data.overview ? <p className={styles.muted}>{data.overview.changedBillCount} with source changes{data.overview.oldestPendingObservedAt ? `. Oldest unanswered change observed ${formatMoment(data.overview.oldestPendingObservedAt)}` : ""}{data.overview.earliestFollowUpOn ? `. Earliest follow-up ${formatDay(data.overview.earliestFollowUpOn)}` : ""}.</p> : null}
        <Source workspaceId={workspaceId} connectionOnly onChanged={() => setRefresh(value => value + 1)} />
      </details>
    </> : null}
  </section>;
}
