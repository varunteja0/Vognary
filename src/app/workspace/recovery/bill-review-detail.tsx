"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, BookCheck, CheckCheck, ChevronDown, Copy, RefreshCw, Save } from "lucide-react";
import type { ZohoBooksDetail, ZohoObservation } from "@/lib/zoho-books/contracts";
import { normalizeBillDisposition, type BillDisposition, type BillDispositionInput } from "@/lib/zoho-books/resolution";
import { formatExactMinorUnits } from "@/components/ui/money-value";
import { indiaCalendarDate } from "@/lib/date-only";
import { BillReviewError, readBillDetail, writeBillDisposition } from "./bill-review-transport";
import { formatDay, formatMoment } from "./labels";
import styles from "./bill-review.module.css";

function PendingDisposition({ workspaceId, detail, onSaved }: { workspaceId: string; detail: ZohoBooksDetail; onSaved: () => void }) {
  const formId = useId();
  const observation = detail.selected;
  const key = `vognary.bill-disposition.${workspaceId}.${detail.viewerUserId ?? "current"}.${observation.bill.billId}`;
  const draftKey = `vognary.bill-draft.${workspaceId}.${detail.viewerUserId ?? "current"}.${observation.bill.billId}.${observation.sequence}`;
  const [restored] = useState(() => {
    try {
      const stored = typeof window === "undefined" ? null : sessionStorage.getItem(key);
      if (!stored) return null;
      const pending = normalizeBillDisposition(JSON.parse(stored));
      return pending.billId === observation.bill.billId ? pending : null;
    } catch { return null; }
  });
  const [draft] = useState(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(draftKey) ?? "null");
      return value && ["RESOLVED", "FOLLOW_UP"].includes(value.kind) && typeof value.note === "string" && value.note.length <= 2000 && typeof value.date === "string" && value.date.length <= 10 ? value as { kind: BillDisposition["kind"]; note: string; date: string } : null;
    } catch { return null; }
  });
  const [kind, setKind] = useState<BillDisposition["kind"]>(restored?.kind ?? draft?.kind ?? "RESOLVED");
  const [note, setNote] = useState(restored?.note ?? draft?.note ?? "");
  const [date, setDate] = useState(restored?.followUpOn ?? draft?.date ?? "");
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState<BillDispositionInput | null>(restored);
  const [error, setError] = useState<string | null>(restored ? `A prior save for revision ${restored.sourceSequence} was interrupted. Retry its original request to check the outcome; this does not resolve a newer revision.` : null);
  const optional = observation.disposition?.kind === "RESOLVED" || ["BASELINE", "INFORMATIONAL"].includes(observation.reviewRelevance ?? observation.changeKind);
  const [editing, setEditing] = useState(restored !== null || draft !== null || observation.disposition?.kind === "FOLLOW_UP" || !optional);
  const lock = useRef(false);
  function updateDraft(next: { kind?: BillDisposition["kind"]; note?: string; date?: string }) {
    const value = { kind, note, date, ...next };
    setKind(value.kind);
    setNote(value.note);
    setDate(value.date);
    try {
      if (value.note || value.date) sessionStorage.setItem(draftKey, JSON.stringify(value));
      else sessionStorage.removeItem(draftKey);
    } catch {}
  }

  async function save() {
    if (lock.current) return;
    const request = uncertain ?? { billId: observation.bill.billId, sourceSequence: observation.sequence, expectedLatestSequence: detail.current.sequence,
      expectedVersion: observation.disposition?.version ?? "0", idempotencyKey: crypto.randomUUID(), kind, note: note.trim(), followUpOn: kind === "FOLLOW_UP" ? date : null };
    try { normalizeBillDisposition(request); } catch { setError("Add an explanation and a valid follow-up date when needed."); return; }
    lock.current = true;
    setSaving(true);
    setError(null);
    try {
      try { sessionStorage.setItem(key, JSON.stringify(request)); } catch {}
      await writeBillDisposition(workspaceId, request);
      try { sessionStorage.removeItem(key); sessionStorage.removeItem(draftKey); } catch {}
      setUncertain(null);
      setNote("");
      setDate("");
      onSaved();
    } catch (failure) {
      const unknown = failure instanceof BillReviewError && failure.unconfirmed;
      setUncertain(unknown ? request : null);
      if (!unknown) { try { sessionStorage.removeItem(key); } catch {} }
      setError(failure instanceof Error ? failure.message : "The save result is unconfirmed. Inspect the saved review before continuing.");
    } finally { lock.current = false; setSaving(false); }
  }

  if (!editing) return <button type="button" className="btn btn-sm btn-ghost justify-self-start" onClick={() => setEditing(true)}>{observation.disposition ? "Record a further review" : "Record a review"}</button>;

  return <form className={styles.form} onSubmit={event => { event.preventDefault(); void save(); }} aria-label="Bill disposition">
    <h4>{observation.disposition?.kind === "FOLLOW_UP" ? "Update this follow-up" : observation.disposition?.kind === "RESOLVED" ? "Record a further review" : "What does this change mean?"}</h4>
    <fieldset disabled={saving || uncertain !== null} className={styles.choices}>
      <legend className="sr-only">Disposition</legend>
      <label><input type="radio" name="bill-disposition" checked={kind === "RESOLVED"} onChange={() => updateDraft({ kind: "RESOLVED" })} />Close review</label>
      <label><input type="radio" name="bill-disposition" checked={kind === "FOLLOW_UP"} onChange={() => updateDraft({ kind: "FOLLOW_UP" })} />Follow up</label>
    </fieldset>
    <label htmlFor={`${formId}-explanation`}><span id={`${formId}-explanation-label`}>Explanation</span><textarea id={`${formId}-explanation`} aria-labelledby={`${formId}-explanation-label`} className="field" required maxLength={2000} disabled={saving || uncertain !== null} value={note} onChange={event => updateDraft({ note: event.target.value })} /></label>
    {kind === "FOLLOW_UP" ? <label htmlFor={`${formId}-date`}><span id={`${formId}-date-label`}>Follow-up date</span><input id={`${formId}-date`} aria-labelledby={`${formId}-date-label`} aria-describedby={`${formId}-date-description`} type="date" className="field" required min={indiaCalendarDate()} disabled={saving || uncertain !== null} value={date} onChange={event => updateDraft({ date: event.target.value })} /><span id={`${formId}-date-description`} className={styles.muted}>Assigned to you. No reminder or supplier message is sent.</span></label> : null}
    <p className={styles.muted}>Human review only. No payment or supplier action; no spending approval or cap change.</p>
    <details className={styles.source}><summary>Draft privacy</summary><p className={styles.muted}>Drafts and interrupted saves stay in this tab until saved or signed out, when browser storage is available.</p></details>
    {error ? <p className={`${styles.notice} ${styles.error}`} role="alert">{error}</p> : null}
    <div className={styles.actions}><button type="submit" className="btn btn-primary" disabled={saving || !note.trim() || (kind === "FOLLOW_UP" && !date)}><Save size={16} aria-hidden />{saving ? "Saving review..." : uncertain ? "Retry original save" : kind === "FOLLOW_UP" ? "Save follow-up" : "Close this review"}</button>{optional && !uncertain ? <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => setEditing(false)}>Cancel further review</button> : null}</div>
  </form>;
}

function ChangeComparison({ observation }: { observation: ZohoObservation }) {
  const previous = observation.previous;
  const current = observation.bill;
  const difference = previous?.currency === current.currency ? BigInt(current.totalMinor) - BigInt(previous.totalMinor) : null;
  return <>
    <dl className={styles.comparison} aria-label="Exact bill total comparison">
      <div><dt>Previously observed</dt><dd className={styles.money}>{previous ? formatExactMinorUnits(previous.totalMinor, previous.currency) : "No prior bill"}</dd></div>
      <div><dt>{observation.changeKind === "REMOVED" ? "Retained prior total" : "This bill total"}</dt><dd className={styles.money}>{formatExactMinorUnits(current.totalMinor, current.currency)}</dd></div>
    </dl>
    <p className={styles.change}>{observation.changeKind === "REMOVED" ? "Source removal. The last observed amount is retained, not a current payable amount." : difference === null ? previous ? "Currency changed. These totals cannot be compared." : "No earlier bill was observed; no price change can be inferred." : difference === BigInt(0) ? "Total unchanged. Other source fields changed." : <><strong>{difference > BigInt(0) ? "Increase" : "Decrease"}: {formatExactMinorUnits((difference < BigInt(0) ? -difference : difference).toString(), current.currency)}</strong><span>The bill does not establish why the total changed.</span></>}</p>
  </>;
}

function SourceFields({ observation, changedOnly = false }: { observation: ZohoObservation; changedOnly?: boolean }) {
  const previous = observation.previous;
  const current = observation.bill;
  const fields = [
    ["Outstanding", previous ? formatExactMinorUnits(previous.balanceMinor, previous.currency) : "Not previously observed", formatExactMinorUnits(current.balanceMinor, current.currency)],
    ["Bill date", previous ? formatDay(previous.date) : "Not previously observed", formatDay(current.date)],
    ["Status", previous?.status.replaceAll("_", " ") ?? "Not previously observed", current.status.replaceAll("_", " ")],
    ["Supplier", previous?.vendorName ?? "Not previously observed", current.vendorName],
    ["Bill number", previous?.billNumber ?? "Not previously observed", current.billNumber],
    ["Currency", previous?.currency ?? "Not previously observed", current.currency],
    ["Supplier ID", previous?.vendorId ?? "Not previously observed", current.vendorId],
  ];
  const changed = previous ? fields.filter(([, before, after]) => before !== after) : [];
  if (changedOnly) return changed.length ? <section aria-label="Changed source fields" className={styles.changedFields}><h4 className={styles.sectionTitle}>What changed in Books</h4><dl className={styles.fields}>{changed.map(([label, before, after]) => <div className={styles.fieldChange} key={label}><dt>{label}</dt><dd><span className="sr-only">Previously: </span>{before}</dd><dd><span className="sr-only">Now: </span>{after}</dd></div>)}</dl></section> : null;
  return <>
    <details className={styles.source}><summary>Other source fields</summary><dl className={styles.fields}>{fields.map(([label, before, after]) => <div className={styles.fieldChange} key={label}><dt>{label}</dt><dd>{before}</dd><dd>{after}</dd></div>)}</dl></details>
    <details className={styles.source}><summary>What the amounts establish</summary><p className={styles.muted}>Bill total includes the provider&apos;s taxes, discounts and adjustments. Outstanding balance and a paid status are not independently verified payment. Line items, tax breakdown, quantities and service periods are not imported. These are revisions of one bill, not a comparison across monthly bills. No currency conversion or inferred saving.</p></details>
  </>;
}

export default function BillReviewDetail({ workspaceId, billId, revision, refresh, onSelect, onBack, onSaved }: {
  workspaceId: string; billId: string; revision?: string; refresh: number;
  onSelect: (billId: string, revision?: string) => void; onBack: () => void; onSaved: () => void;
}) {
  const [detail, setDetail] = useState<ZohoBooksDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const generation = useRef(0);
  const focused = useRef(false);
  const savedResult = detail?.selected.disposition ?? (detail?.selected.sequence === detail?.current.sequence && detail?.current.reviewRelevance === "INFORMATIONAL" && !detail.current.pendingReviewCount && !detail.current.openFollowUpCount ? detail.current.lastResolvedReview : null);
  const person = (userId: string) => detail?.people?.find(item => item.userId === userId)?.displayName ?? (userId === detail?.viewerUserId ? "You" : "Name unavailable");
  useEffect(() => {
    const controller = new AbortController();
    const request = ++generation.current;
    void readBillDetail(workspaceId, billId, { revision }, controller.signal).then(value => {
      if (request !== generation.current) return;
      setDetail(value);
      setError(null);
    }).catch(failure => {
      if (controller.signal.aborted || request !== generation.current) return;
      if (failure instanceof BillReviewError && [401, 403].includes(failure.status)) setDetail(null);
      setError(failure instanceof Error ? failure.message : "Bill review could not be opened.");
    });
    return () => controller.abort();
  }, [workspaceId, billId, revision, refresh, reload]);
  useEffect(() => {
    if (detail && heading.current && !focused.current) {
      heading.current.focus();
      focused.current = true;
    }
  }, [detail]);

  async function older(kind: "observations" | "events" | "openFollowUps") {
    if (!detail || loading) return;
    const cursor = kind === "observations" ? detail.nextCursor : kind === "events" ? detail.nextEventCursor : detail.nextFollowUpCursor;
    if (!cursor) return;
    const request = generation.current;
    setLoading(true);
    try {
      const page = await readBillDetail(workspaceId, billId, { revision, [kind === "observations" ? "cursor" : kind === "events" ? "eventCursor" : "followUpCursor"]: cursor });
      if (request !== generation.current) return;
      const cursorKey = kind === "observations" ? "nextCursor" : kind === "events" ? "nextEventCursor" : "nextFollowUpCursor";
      setDetail({ ...detail, people: [...new Map([...(detail.people ?? []), ...(page.people ?? [])].map(person => [person.userId, person])).values()], [kind]: [...detail[kind], ...page[kind]], [cursorKey]: page[cursorKey] });
    } catch { setError("Older history could not be opened. The displayed records are retained."); }
    finally { setLoading(false); }
  }

  async function acknowledge() {
    if (!detail || loading) return;
    setLoading(true);
    try {
      const response = await fetch("/api/workspaces/current/sources/zoho-books", { method: "POST", headers: { "content-type": "application/json", "X-Vognary-Workspace": workspaceId }, body: JSON.stringify({ action: "REVIEW", revision: detail.connectionRevision, sequences: [detail.selected.sequence] }) });
      if (!response.ok) throw new Error();
      setNotice("Reading acknowledged for this exact revision. Its disposition is unchanged.");
      setReload(value => value + 1);
    } catch { setError("Acknowledgement is unconfirmed. Reload to inspect the saved review."); }
    finally { setLoading(false); }
  }

  return <section className={styles.detail} aria-label="Selected bill review">
    <div className={styles.actions}>
      <button type="button" className={`btn btn-sm btn-ghost ${styles.phoneBack}`} onClick={onBack}><ArrowLeft size={16} aria-hidden />Bill list</button>
      <button type="button" className="btn btn-sm btn-ghost" aria-label="Reload selected bill" title="Reload selected bill" onClick={() => setReload(value => value + 1)}><RefreshCw size={16} aria-hidden /></button>
      <button type="button" className="btn btn-sm btn-ghost" aria-label="Copy bill review link" title="Copy bill review link" onClick={() => void navigator.clipboard.writeText(location.href).then(() => setNotice("Bill review link copied."), () => setError("The browser could not copy this link."))}><Copy size={16} aria-hidden /></button>
    </div>
    {error ? <p role="alert" className={`${styles.notice} ${styles.error}`}>{error}</p> : null}
    {notice ? <p role="status" className={styles.notice}>{notice}</p> : null}
    {!detail && !error ? <p role="status" className={styles.muted}>Opening the saved bill review...</p> : null}
    {detail ? <>
      <header><p className={styles.muted}>{detail.organizationName} / Bill {detail.selected.bill.billNumber}</p><h3 ref={heading} tabIndex={-1} className={styles.title}>{detail.selected.bill.vendorName}</h3><p className={styles.subtitle}>{detail.selected.changeKind === "BASELINE" ? "Imported bill" : detail.selected.changeKind === "NEW" ? "New bill" : "Bill changed"} / {formatDay(detail.selected.bill.date)}</p></header>
      {detail.selected.sequence !== detail.current.sequence ? <div className={styles.notice}>Historical revision. The current bill is revision {detail.current.sequence}. <button className="link-quiet" type="button" onClick={() => onSelect(billId)}>Open current revision</button></div> : null}
      {detail.current.pendingReviewSequence && detail.current.pendingReviewSequence !== detail.selected.sequence ? <div className={styles.notice}><p>{detail.current.pendingReviewCount} unanswered {detail.current.pendingReviewCount === 1 ? "change remains" : "changes remain"}. Later source updates do not close earlier questions.</p><button className="btn btn-primary" type="button" onClick={() => onSelect(billId, detail.current.pendingReviewSequence!)}>Review earlier change</button></div> : null}
      {savedResult ? <div className={styles.notice} role="status"><div className={styles.actions}><CheckCheck size={18} aria-hidden /><strong>{savedResult.kind === "RESOLVED" ? "Review closed" : `Follow-up due ${formatDay(savedResult.followUpOn!)}`}</strong></div><p>{savedResult.note}</p><p className={styles.muted}>Recorded by {person(savedResult.actorUserId)} at {formatMoment(savedResult.createdAt)}{savedResult.sourceSequence !== detail.selected.sequence ? ` for revision ${savedResult.sourceSequence}` : ""}.</p>{savedResult.kind === "RESOLVED" ? <button type="button" className="btn btn-primary" onClick={onBack}><ArrowLeft size={16} aria-hidden />Return to bills</button> : null}</div> : null}
      <ChangeComparison observation={detail.selected} />
      {detail.selected.reviewRelevance === "INFORMATIONAL" ? <p className={styles.muted}>Informational update. The total and bill identity are unchanged; Books updated status or outstanding balance. No review is required for this update.</p> : detail.selected.previousChangeKind === "REMOVED" ? <p className={styles.notice}>Bill restored in the source. Earlier removal history is retained.</p> : null}
      <SourceFields observation={detail.selected} changedOnly />
      {detail.canManage ? <PendingDisposition key={`${workspaceId}:${detail.selected.sequence}:${detail.selected.disposition?.version ?? "0"}`} workspaceId={workspaceId} detail={detail} onSaved={() => { setNotice("Review saved."); setReload(value => value + 1); onSaved(); }} /> : <p className={styles.notice}>Read-only access. An owner or admin records the review.</p>}
      <SourceFields observation={detail.selected} />
      <details className={styles.source}><summary>Source identity and observation times</summary><div className={styles.muted}>Organization {detail.organizationId}<br />Supplier {detail.selected.bill.vendorId} / bill {detail.selected.bill.billId}<br />Provider modified {formatMoment(detail.selected.bill.modifiedAt)}<br />Observed {formatMoment(detail.selected.observedAt)}<br />Immutable source revision {detail.selected.sequence}</div></details>
      {detail.canManage ? <details className={styles.source}><summary>Reading acknowledgement</summary><p className={styles.muted}>Records that this revision was read. It does not close a review or a follow-up.</p><button type="button" className="btn btn-sm btn-ghost justify-self-start" disabled={loading} onClick={() => void acknowledge()}><BookCheck size={16} aria-hidden />Acknowledge reading only</button></details> : null}
      {detail.openFollowUps.length ? <section><h4 className={styles.sectionTitle}>Open follow-ups</h4><div className={styles.history}>{detail.openFollowUps.map(item => <div className={styles.event} key={item.id}><strong>Due {formatDay(item.followUpOn!)}</strong><p>{item.note}</p><p className={styles.muted}>Responsible: {person(item.responsibleUserId!)} / revision {item.sourceSequence}</p><button className="link-quiet justify-self-start" type="button" onClick={() => onSelect(billId, item.sourceSequence)}>Open this follow-up</button></div>)}</div>{detail.nextFollowUpCursor ? <button type="button" className="btn btn-sm btn-ghost" disabled={loading} onClick={() => void older("openFollowUps")}><ChevronDown size={16} aria-hidden />Older follow-ups</button> : null}</section> : null}
      <details className={styles.source}><summary>Review history</summary><h4 className={styles.sectionTitle}>Human review history</h4>{detail.events.length ? <div className={styles.history}>{detail.events.map(item => <div className={styles.event} key={item.id}><strong>{item.kind === "RESOLVED" ? "Review closed" : `Follow-up due ${formatDay(item.followUpOn!)}`}</strong><p>{item.note}</p><p className={styles.muted}>Revision {item.sourceSequence} / {formatMoment(item.createdAt)} / {item.actorUserId}</p></div>)}</div> : <p className={styles.muted}>No human review has been recorded.</p>}{detail.nextEventCursor ? <button type="button" className="btn btn-sm btn-ghost" disabled={loading} onClick={() => void older("events")}><ChevronDown size={16} aria-hidden />Older reviews</button> : null}</details>
      <details className={styles.source}><summary>Source revision history</summary><div className={styles.history}>{detail.observations.map(item => <button type="button" className={styles.row} key={item.sequence} onClick={() => onSelect(billId, item.sequence)}><span>Revision {item.sequence} / {item.changeKind.toLowerCase()}</span><span className={styles.money}>{formatExactMinorUnits(item.bill.totalMinor, item.bill.currency)}</span><span className={styles.muted}>{formatMoment(item.observedAt)}</span></button>)}</div>{detail.nextCursor ? <button type="button" className="btn btn-sm btn-ghost" disabled={loading} onClick={() => void older("observations")}><ChevronDown size={16} aria-hidden />Older source revisions</button> : null}</details>
    </> : null}
  </section>;
}
