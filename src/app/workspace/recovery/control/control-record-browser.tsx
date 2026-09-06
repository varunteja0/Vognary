"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { buildControlAttention } from "@/lib/commitment-control/attention";
import { indiaCalendarDate } from "@/lib/date-only";
import type { CommitmentControlDesk } from "./control-view";
import { ControlAttention } from "./control-attention";
import { ControlProposalRow } from "./control-proposal-row";
import { controlDecisionRecordedLabels, controlStatusLabels } from "./control-format";
import styles from "./control-record-browser.module.css";

type RecordFilter = "ALL" | "PENDING" | "DECIDED";

export function ControlRecordBrowser({
  desk,
  online,
  onInspectEvidence,
}: {
  desk: CommitmentControlDesk;
  online: boolean;
  onInspectEvidence: ((evidenceId: string, buttonId: string) => void) | null;
}) {
  const { state, handlers } = desk;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RecordFilter>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [indexOpen, setIndexOpen] = useState(false);

  useEffect(() => {
    const readLocation = () => setSelectedId(new URL(window.location.href).searchParams.get("proposal"));
    readLocation();
    window.addEventListener("popstate", readLocation);
    return () => window.removeEventListener("popstate", readLocation);
  }, []);

  if (!state.brief) return null;
  const attention = buildControlAttention(state.brief.proposals, { today: indiaCalendarDate() });
  const attentionOrder = new Map<string, number>();
  attention.forEach((item, index) => { if (!attentionOrder.has(item.proposalId)) attentionOrder.set(item.proposalId, index); });
  const entries = state.brief.proposals.toSorted((first, second) =>
    (attentionOrder.get(first.proposal.id) ?? Number.MAX_SAFE_INTEGER) - (attentionOrder.get(second.proposal.id) ?? Number.MAX_SAFE_INTEGER));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = entries.filter(entry => {
    const matchesState = filter === "ALL" || (filter === "PENDING" ? !entry.decision : Boolean(entry.decision));
    return matchesState && `${entry.proposal.merchant} ${entry.proposal.purpose}`.toLocaleLowerCase().includes(normalizedQuery);
  });
  const focusedEntry = entries.find(entry => entry.proposal.id === state.focusProposalId);
  const selected = focusedEntry ?? filtered.find(entry => entry.proposal.id === selectedId) ?? filtered[0];
  const pending = state.pending;
  const pendingKind = selected && pending && "proposalId" in pending && pending.proposalId === selected.proposal.id
    && (pending.kind === "DECISION" || pending.kind === "RECONCILIATION") ? pending.kind : null;

  function selectRecord(proposalId: string) {
    setSelectedId(proposalId);
    setIndexOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.set("proposal", proposalId);
    window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  if (entries.length === 0) return null;

  return (
    <section className={styles.browser} aria-label="Commitment records">
      <aside className={styles.index} data-expanded={indexOpen}>
        <div className={styles.indexHeading}>
          <h3>Commitments</h3>
          <span>{entries.length}</span>
        </div>
        <button type="button" className={styles.browse} aria-expanded={indexOpen} aria-controls="control-record-index" onClick={() => setIndexOpen(!indexOpen)}>
          Browse commitments <span>{entries.length}</span><ChevronDown size={16} aria-hidden />
        </button>
        <div id="control-record-index" className={styles.indexBody}>
        <label className={styles.search}>
          <span className="sr-only">Search commitments</span>
          <Search size={16} aria-hidden />
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a commitment" />
        </label>
        <fieldset className={styles.filters}>
          <legend className="sr-only">Filter commitment records</legend>
          {([["ALL", "All"], ["PENDING", "Pending"], ["DECIDED", "Decided"]] as const).map(([value, label]) => (
            <label key={value} data-selected={filter === value}>
              <input type="radio" name="control-record-filter" value={value} checked={filter === value} onChange={() => setFilter(value)} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <ul className={styles.records} aria-label="Choose a commitment">
          {filtered.map(entry => (
            <li key={entry.proposal.id}>
              <button type="button" aria-current={selected?.proposal.id === entry.proposal.id ? "true" : undefined} onClick={() => selectRecord(entry.proposal.id)}>
                <span className={styles.recordName}>{entry.proposal.merchant}</span>
                <span className={styles.recordStatus} data-decided={Boolean(entry.decision)}>
                  {attention.find(item => item.proposalId === entry.proposal.id)?.headline ?? (entry.decision ? controlDecisionRecordedLabels[entry.decision.action] : "Needs a decision")}
                </span>
                <span className={styles.recordContext}>
                  {entry.decision ? entry.decision.authorizationExpiresOn ? `Expiry ${entry.decision.authorizationExpiresOn}` : "No authorization window" : entry.evaluation ? controlStatusLabels[entry.evaluation.status] : "No evaluation"}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {filtered.length === 0 ? (
          <div className={styles.empty} role="status">
            <p>No matching commitments.</p>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setQuery(""); setFilter("ALL"); }}>Clear filters</button>
          </div>
        ) : null}
        </div>
      </aside>
      <div className={styles.detail} aria-live="polite">
        {selected ? <ControlAttention
          items={attention.filter(item => item.proposalId === selected.proposal.id && item.nextStep !== "DECIDE_PROPOSAL")}
          canAct={state.brief.capabilities.canDecide}
          online={online}
          pendingProposalId={pending && "proposalId" in pending ? pending.proposalId : null}
          onDecide={handlers.openDecision}
          onReconcile={handlers.openReconciliation}
          onRecordOutcome={handlers.openOutcome}
          onReviewException={handlers.openExceptionReview}
          onReview={handlers.focusProposal}
        /> : null}
        {selected ? (
          <ControlProposalRow
            key={selected.proposal.id}
            entry={selected}
            canDecide={state.brief.capabilities.canDecide}
            pendingKind={pendingKind}
            focused={state.focusProposalId === selected.proposal.id}
            lead={!selected.decision}
            online={online}
            onDecide={handlers.openDecision}
            onReconcile={handlers.openReconciliation}
            onInspectEvidence={onInspectEvidence}
            onFocused={() => { setSelectedId(selected.proposal.id); setQuery(""); setFilter("ALL"); handlers.clearFocus(); }}
          />
        ) : <p className={styles.empty}>Choose another filter to return to your records.</p>}
      </div>
    </section>
  );
}
