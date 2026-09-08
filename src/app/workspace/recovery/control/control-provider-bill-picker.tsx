"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, RefreshCw, Search } from "lucide-react";
import type { ControlDecisionDto, ControlProposalDto, ControlReconciliationWriteDto } from "@/lib/commitment-control/contracts";
import type { ControlProviderBillCandidateDto, ControlProviderBillCandidatesDto, ControlProviderBillCandidateQuery } from "@/lib/commitment-control/provider-bill-contracts";
import type { ResponseMeta } from "../transport";
import { formatDay, formatMoment } from "../labels";
import { formatControlMoney } from "./control-format";
import { createControlTransport } from "./control-transport";
import { providerBillAttemptKey, providerBillRequest, restoreProviderBillAttempt, type ProviderBillAttempt } from "./control-provider-bill-state";
import styles from "./control-provider-bill.module.css";

export const billedVerdictLabels = {
  MATCHED: "Bill matches the agreed amount", WITHIN_CAP: "Bill is within the approved cap", OVER_CAP: "Bill is over the approved cap",
  CURRENCY_MISMATCH: "Bill currency differs from the authorization", AUTHORIZATION_EXPIRED: "Bill is after the authorization expiry",
};

function billCapabilityReason(reason: string) {
  const labels: Record<string, string> = {
    SOURCE_UNAVAILABLE: "Source unavailable. Open Books source settings.", SOURCE_STALE: "The last complete import is too old for a new comparison.",
    SOURCE_NOT_READY: "The source has not completed a usable import.", CONSENT_REQUIRED: "An owner or admin must authorize this source.",
    CONSENT_UNAVAILABLE: "Current source consent is unavailable.", CONSENT_CHANGED: "Source consent changed. Reload the source before selecting a bill.",
    LEGACY_AMOUNT_BASIS: "Amount basis not recorded. Use saved receipts.", AMOUNT_BASIS_INCOMPATIBLE: "This authorization does not record a gross per-charge bill limit.",
    ALREADY_COMPARED: "This exact revision already has a saved comparison.", ROLE_REQUIRED: "Only an owner or admin may save a billed comparison.",
    BILL_NOT_COMPARABLE: "This bill status cannot be compared.", BILL_BEFORE_AUTHORIZATION: "This bill predates the human authorization.",
    FUTURE_BILL: "This bill is dated in the future.", STALE_SNAPSHOT: "This is no longer the latest bill revision. Reload available bills.",
    OWNER_OR_ADMIN_REQUIRED: "Only a workspace owner or admin may save a billed comparison.",
    PROVIDER_BILL_ADMISSION_DISABLED: "Billed comparisons are not enabled for this workspace.",
    EXPLICIT_GROSS_AUTHORIZATION_REQUIRED: "Amount basis not recorded. Use saved receipts.",
    PROPOSAL_DECLINED: "This proposal was declined and cannot receive a billed comparison.",
    ORIGINAL_GRANT_MISSING: "This capture has no original read-consent record. A new authorized import is required.",
    CONSENT_NOT_CURRENT: "This capture no longer has current read consent. Reconnect and import before making a new selection.",
    SNAPSHOT_SUPERSEDED: "A newer bill revision exists. Reload the available bills.",
    SOURCE_TIME_INVALID: "The source times cannot support a comparison. Open source settings.",
    SOURCE_BASIS_INVALID: "The captured amount is not a supported provider bill total.",
    ABSENCE_UNCONFIRMED: "The provider could not confirm whether this bill is present. It cannot be selected.",
  };
  return labels[reason] ?? reason.toLowerCase().replaceAll("_", " ");
}

function ProviderBillLineage({ bill }: { bill: ControlProviderBillCandidateDto }) {
  return <details className="control-more"><summary>Source identity and observation times</summary><dl className={styles.lineage}>
    <div><dt>Source</dt><dd>Zoho Books India / organization {bill.organizationId} / bill {bill.billId}</dd></div>
    <div><dt>Captured</dt><dd>{formatMoment(bill.sourceObservedAt)} / {bill.sourceObservedAt}</dd></div>
    <div><dt>Provider modified</dt><dd>{formatMoment(bill.providerModifiedAt)} / {bill.providerModifiedAt}</dd></div>
    <div><dt>Revision / schema</dt><dd>{bill.sourceSequence} / {bill.sourceVersion}</dd></div>
    <div><dt>Fingerprint</dt><dd>{bill.sourceFingerprint}</dd></div>
    <div><dt>Connection / version</dt><dd>{bill.connectionId} / {bill.expectedSourceVersion}</dd></div>
    <div><dt>Read consent</dt><dd>{bill.consentReference ?? "Not recorded"} / generation {bill.consentGeneration ?? "Not recorded"}</dd></div>
    <div><dt>Consent recorded</dt><dd>{bill.consentAuthorizedAt ?? "Not recorded"} / {bill.consentAuthorizedByUserId ?? "Account not on record"}</dd></div>
    <div><dt>Read scopes</dt><dd>{bill.consentScopes?.join(" / ") ?? "Not recorded"}</dd></div>
  </dl></details>;
}

export function ControlProviderBillPicker({ workspaceId, proposal, decision, online, onSaved, onHeldChange }: {
  workspaceId: string;
  proposal: ControlProposalDto;
  decision: ControlDecisionDto;
  online: boolean;
  onSaved: (data: ControlReconciliationWriteDto, meta: ResponseMeta) => void;
  onHeldChange: (held: boolean) => void;
}) {
  const transport = useMemo(() => createControlTransport(undefined, workspaceId), [workspaceId]);
  const [identity, setIdentity] = useState<{ workspaceId: string; actorId: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<ControlProviderBillCandidatesDto | null>(null);
  const [workspaceVersion, setWorkspaceVersion] = useState<number | null>(null);
  const [query, setQuery] = useState<ControlProviderBillCandidateQuery>({ search: "", sort: "UPDATED", currency: "" });
  const [search, setSearch] = useState("");
  const [currency, setCurrency] = useState("");
  const [history, setHistory] = useState<(string | undefined)[]>([undefined]);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ControlProviderBillCandidateDto | null>(null);
  const [wholeCharge, setWholeCharge] = useState(false);
  const [retention, setRetention] = useState(false);
  const [held, setHeld] = useState<ProviderBillAttempt | null>(null);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const requestSequence = useRef(0);

  useEffect(() => {
    let active = true;
    void transport.providerBillIdentity().then(current => {
      if (!active) return;
      if (!current || current.workspaceId !== workspaceId) { setError("Sign in again to this workspace before choosing a bill."); setReady(true); return; }
      setIdentity(current);
      try {
        const restored = restoreProviderBillAttempt(sessionStorage.getItem(providerBillAttemptKey(workspaceId, current.actorId, proposal.id)), { ...current, proposalId: proposal.id, decisionId: decision.id });
        setHeld(restored);
      } catch { setError("This browser cannot keep an interrupted request. Enable session storage before saving a comparison."); }
      setReady(true);
    });
    return () => { active = false; };
  }, [transport, workspaceId, proposal.id, decision.id]);

  useEffect(() => { onHeldChange(Boolean(held) || pending); }, [held, pending, onHeldChange]);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    let active = true;
    void transport.providerBillCandidates(proposal.id, query).then(result => {
      if (!active || sequence !== requestSequence.current) return;
      setLoading(false);
      if (!result.ok) { setPage(null); setWorkspaceVersion(null); setError(result.error.message); return; }
      setPage(result.data); setWorkspaceVersion(result.meta.workspaceVersion);
    });
    return () => { active = false; };
  }, [transport, proposal.id, query, reload]);

  function changePage(next: ControlProviderBillCandidateQuery, cursors: (string | undefined)[]) {
    if (lock.current || held) return;
    setSelected(null); setWholeCharge(false); setRetention(false); setError(null); setLoading(true); setPage(null);
    setQuery(next); setHistory(cursors);
  }

  async function save() {
    if (lock.current || !online || !identity) return;
    let attempt = held;
    if (!attempt) {
      if (!selected || !page?.canConfirm || workspaceVersion === null) return;
      const request = providerBillRequest(selected, wholeCharge, retention);
      if (!request) return;
      attempt = { version: 1, ...identity, proposalId: proposal.id, decisionId: decision.id, workspaceVersion, idempotencyKey: crypto.randomUUID(), request, snapshot: selected };
      try {
        const key = providerBillAttemptKey(workspaceId, identity.actorId, proposal.id);
        sessionStorage.setItem(key, JSON.stringify(attempt));
        if (!restoreProviderBillAttempt(sessionStorage.getItem(key), { ...identity, proposalId: proposal.id, decisionId: decision.id })) throw new Error("storage");
      } catch { setError("The original request could not be kept in this browser. Nothing was sent. Enable session storage and retry."); return; }
    }
    lock.current = true; setPending(true); setHeld(attempt); setError(null);
    const result = await transport.reconcileProviderBill(attempt);
    lock.current = false; setPending(false);
    if (result.ok) {
      try { sessionStorage.removeItem(providerBillAttemptKey(workspaceId, identity.actorId, proposal.id)); } catch {}
      setHeld(null); onHeldChange(false); onSaved(result.data, result.meta); return;
    }
    setError(result.error.message);
    if (result.outcome === "REJECTED") {
      try { sessionStorage.removeItem(providerBillAttemptKey(workspaceId, identity.actorId, proposal.id)); } catch {}
      setHeld(null); setSelected(null); setWholeCharge(false); setRetention(false); setPage(null); setLoading(true); setReload(value => value + 1);
    }
  }

  const preview = held?.snapshot ?? selected;
  return <section className={styles.picker} aria-label="Choose a Books bill">
    {held ? <div role="status" className={styles.notice}><strong>Original comparison is unconfirmed</strong><p>Check the saved result using the original bill revision and request. A later source change cannot rewrite it.</p><button type="button" className="btn btn-primary" disabled={pending || !online || !identity} onClick={() => void save()}>{pending ? "Checking original result..." : "Retry original comparison"}</button></div> : null}
    <div className={styles.health} role="status">
      <strong>{loading ? "Opening available bill records..." : page?.freshness.status === "FRESH" ? "A recent complete import is available" : page?.freshness.status === "STALE" ? "The saved source is stale" : "A usable source is unavailable"}</strong>
      {page ? <p>Last complete import: {page.freshness.lastCompletedSyncAt ? formatMoment(page.freshness.lastCompletedSyncAt) : "Not completed"}. Maximum age for a new comparison: 24 hours.</p> : null}
      {page?.capabilityReasons.map(reason => <p key={reason}>{billCapabilityReason(reason)}</p>)}
      <a className="link-quiet" href="/app?view=ADD_EVIDENCE#zoho-books-heading">Open Books source settings</a>
    </div>
    {error ? <p role="alert" className="control-error">{error}</p> : null}
    {!held ? <>
      <form className={styles.filters} onSubmit={event => { event.preventDefault(); changePage({ search, currency, sort: query.sort }, [undefined]); }}>
        <div className={styles.filterField}><label htmlFor="a2-bill-search">Search supplier or bill number</label><input id="a2-bill-search" className="field" type="search" value={search} maxLength={160} onChange={event => setSearch(event.target.value)} /></div>
        <div className={styles.filterField}><label htmlFor="a2-bill-sort">Sort bills</label><select id="a2-bill-sort" className="field" value={query.sort} onChange={event => changePage({ ...query, sort: event.target.value as ControlProviderBillCandidateQuery["sort"], cursor: undefined }, [undefined])}>
          <option value="UPDATED">Recently updated</option><option value="SUPPLIER">Supplier</option><option value="DATE">Bill date</option><option value="AMOUNT_ASC">Amount: low to high</option><option value="AMOUNT_DESC">Amount: high to low</option>
        </select></div>
        <div className={styles.filterField}><label htmlFor="a2-bill-currency">Bill currency</label><input id="a2-bill-currency" className="field" value={currency} maxLength={3} onChange={event => setCurrency(event.target.value.toUpperCase())} autoComplete="off" /></div>
        <button className="btn btn-sm btn-ghost" type="submit" disabled={loading || !online}><Search size={16} aria-hidden />Search bills</button>
        <button type="button" className="btn btn-sm btn-ghost" title="Reload available bills" aria-label="Reload available bills" disabled={loading || !online} onClick={() => { changePage({ ...query, cursor: undefined }, [undefined]); setReload(value => value + 1); }}><RefreshCw size={16} aria-hidden /></button>
      </form>
      {page ? <><p className="control-note">{page.candidates.length} of {page.total} available records. Nothing has been matched or selected for you.</p>
        {page.candidates.length ? <fieldset className={styles.candidates}><legend className="field-label">Choose one exact bill revision</legend>{page.candidates.map(bill => <label className={styles.candidate} key={`${bill.billId}:${bill.sourceSequence}`} data-disabled={!bill.canSelect}>
          <input type="radio" className="tick" name="a2-bill" aria-label={`${bill.vendorName} / ${bill.billNumber} / revision ${bill.sourceSequence}`} checked={selected?.sourceSequence === bill.sourceSequence && selected.billId === bill.billId} disabled={!bill.canSelect || !page.canConfirm || !identity || !online} onChange={() => { setSelected(bill); setWholeCharge(false); setRetention(false); }} />
          <span><strong>{bill.vendorName}</strong><span>{bill.billNumber} / {formatDay(bill.billDate)} / {bill.billStatus.replaceAll("_", " ")}</span><span className="font-data tnum">Bill total {formatControlMoney(bill.totalMinor, bill.currency)}</span>{bill.selectionReasons.map(reason => <span key={reason}>{billCapabilityReason(reason)}</span>)}</span>
        </label>)}</fieldset> : <p>No bills are available for this selection. Check the filters and source status. Saved receipts remain a separate option.</p>}
        <nav aria-label="Available bill pages" className={styles.actions}>
          <button type="button" className="btn btn-sm btn-ghost" disabled={history.length < 2 || loading} onClick={() => changePage({ ...query, cursor: history.at(-2) }, history.slice(0, -1))}><ArrowLeft size={16} aria-hidden />Previous</button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={!page.nextCursor || loading} onClick={() => page.nextCursor && changePage({ ...query, cursor: page.nextCursor }, [...history, page.nextCursor])}>Next<ArrowRight size={16} aria-hidden /></button>
        </nav></> : null}
    </> : null}
    {preview ? <section className={styles.preview} aria-label="Billed comparison preview">
      <h4>Bill comparison{held ? " request" : " preview"}</h4>
      <dl className={styles.amounts}><div><dt>Approved cap per charge</dt><dd>{formatControlMoney(decision.approvedCapMinor, decision.currency)}</dd></div><div><dt>Bill total</dt><dd>{formatControlMoney(preview.totalMinor, preview.currency)}</dd></div></dl>
      <p className={styles.verdict}>{preview.prospectiveVerdict ? billedVerdictLabels[preview.prospectiveVerdict] : "No comparable verdict"}</p>
      <p>{preview.vendorName} / {preview.billNumber}</p><p>Bill date {formatDay(preview.billDate)}. Authorization expires {decision.authorizationExpiresOn ? formatDay(decision.authorizationExpiresOn) : "not recorded"}.</p>
      <p>Gross bill total includes tax, discounts and adjustments. No payment, usage, savings or business outcome is proved.</p>
      <ProviderBillLineage bill={preview} />
      {!held ? <>
        <label className={styles.ack}><input type="checkbox" className="tick" checked={wholeCharge} onChange={event => setWholeCharge(event.target.checked)} />This entire bill is for this approved charge</label>
        <p className="control-note">A bill covering several obligations cannot be allocated here. Leave it in bill review.</p>
        <label className={styles.ack}><input type="checkbox" className="tick" checked={retention} onChange={event => setRetention(event.target.checked)} />Keep this selected bill and comparison if the Books source is deleted</label>
        <p className="control-note">The selected bill, consent and selection history stay with this immutable comparison. Deleting the Books source removes imports and reviews, not this admitted record. Whole-workspace erasure removes the full chain, subject to backup retention.</p>
        <button type="button" className="btn btn-primary" disabled={!wholeCharge || !retention || pending || !ready || !identity || !online || !page?.canConfirm} onClick={() => void save()}>{pending ? "Saving billed comparison..." : "Save billed comparison"}</button>
      </> : null}
    </section> : null}
  </section>;
}
