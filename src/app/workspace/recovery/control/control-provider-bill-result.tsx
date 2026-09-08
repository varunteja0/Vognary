"use client";

import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import type { ControlReconciliationDto } from "@/lib/commitment-control/contracts";
import { formatDay, formatMoment } from "../labels";
import { formatControlMoney } from "./control-format";
import { billedVerdictLabels } from "./control-provider-bill-picker";
import styles from "./control-provider-bill.module.css";

const sourceConditions = {
  ERASED: "Books imports were deleted. This admitted bill and saved comparison are retained.",
  CONSENT_WITHDRAWN: "Source access was withdrawn. New bills cannot be admitted; this saved comparison remains readable.",
  CONSENT_CHANGED: "Source consent changed. This comparison keeps the original consent and selection record.",
  ABSENCE_UNCONFIRMED: "The bill could not be located at the provider. Removal is unconfirmed; this original bill is not a zero balance.",
  REMOVED: "The source reports this bill removed. The original billed comparison has not changed.",
  VOIDED: "The source reports this bill voided. The original billed comparison has not changed.",
  UNAVAILABLE: "The current source is unavailable. This is a retained historical result, not current coverage.",
  STALE: "The current source is stale. This saved comparison still describes the selected revision.",
  AMENDED: "A newer bill revision exists. The original comparison and approved cap stay unchanged.",
  CURRENT: "This result describes the selected bill revision. It does not close bill-review work.",
};

export function ControlProviderBillResult({ reconciliation }: { reconciliation: ControlReconciliationDto }) {
  const bill = reconciliation.providerBill;
  const source = reconciliation.providerBillSource;
  const heading = useRef<HTMLHeadingElement>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const path = `/app?view=CONTROL&proposal=${reconciliation.proposalId}&comparison=${reconciliation.id}`;
  useEffect(() => {
    const focus = () => { if (new URL(window.location.href).searchParams.get("comparison") === reconciliation.id) heading.current?.focus(); };
    focus(); window.addEventListener("popstate", focus);
    return () => window.removeEventListener("popstate", focus);
  }, [reconciliation.id]);
  if (!bill) return null;
  return <section className={styles.result} aria-labelledby={`control-comparison-${reconciliation.id}`} data-verdict={reconciliation.verdict}>
    <h5 ref={heading} id={`control-comparison-${reconciliation.id}`} tabIndex={-1}>Saved billed comparison</h5>
    <dl className={styles.amounts}><div><dt>Approved cap per charge</dt><dd>{formatControlMoney(reconciliation.approvedCapMinor, reconciliation.authorizationCurrency)}</dd></div><div><dt>Bill total</dt><dd>{formatControlMoney(bill.totalMinor, bill.currency)}</dd></div></dl>
    <p className={styles.verdict}>{reconciliation.verdict === "CANNOT_EVALUATE" ? "Bill cannot be compared" : billedVerdictLabels[reconciliation.verdict]}</p>
    <p>{bill.vendorName} / {bill.billNumber} / bill date {formatDay(bill.billDate)}</p>
    <p className="control-note">Gross billed total, including tax, discounts and adjustments. Not proof of payment, usage, savings or business outcome.</p>
    <div className={styles.actions}>
      <a className="link-quiet" href={path}>Open this comparison</a>
      <button type="button" className="btn btn-sm btn-ghost" title="Copy comparison link" onClick={async () => {
        try { await navigator.clipboard.writeText(new URL(path, window.location.origin).href); setCopyStatus("Comparison link copied."); }
        catch { setCopyStatus("Copy is unavailable. Use Open this comparison and copy its address."); }
      }}><Copy size={16} aria-hidden />Copy comparison link</button>
    </div>
    {copyStatus ? <p role="status">{copyStatus}</p> : null}
    <div className={styles.health} aria-label="Bill source and remaining review">
      <p>{source ? sourceConditions[source.condition] : "Current source condition has not been checked. Reload to inspect available changes."}</p>
      {source?.pendingMaterialNewerCount ? <p>{source.pendingMaterialNewerCount} newer material revision{source.pendingMaterialNewerCount === 1 ? "" : "s"} still need{source.pendingMaterialNewerCount === 1 ? "s" : ""} review.</p> : null}
      {source?.pendingMaterialOlderCount ? <p>{source.pendingMaterialOlderCount} older material revision{source.pendingMaterialOlderCount === 1 ? "" : "s"} still need{source.pendingMaterialOlderCount === 1 ? "s" : ""} review.</p> : null}
      {source?.openFollowUpCount ? <p>{source.openFollowUpCount} open follow-up{source.openFollowUpCount === 1 ? "" : "s"} remain{source.openFollowUpCount === 1 ? "s" : ""} a separate responsibility.</p> : null}
      {source?.billReviewPath ? <a href={source.billReviewPath} className="link-quiet">Open bill review and remaining work</a> : null}
    </div>
    <details className="control-more"><summary>Original bill and selection record</summary><dl className={styles.lineage}>
      <div><dt>Agreed amount per charge</dt><dd>{formatControlMoney(reconciliation.expectedAmountMinor, reconciliation.authorizationCurrency)}</dd></div>
      <div><dt>Decision amount basis</dt><dd>Gross billed total per charge</dd></div>
      <div><dt>Evidence basis</dt><dd>Provider bill total</dd></div>
      <div><dt>Selected</dt><dd>{formatMoment(bill.selectedAt)} / {bill.selectedAt} / {bill.selectedByUserId ?? "Account no longer on record"}</dd></div>
      <div><dt>Captured</dt><dd>{formatMoment(bill.sourceObservedAt)} / {bill.sourceObservedAt}</dd></div>
      <div><dt>Provider modified</dt><dd>{formatMoment(bill.providerModifiedAt)} / {bill.providerModifiedAt}</dd></div>
      <div><dt>Original source</dt><dd>Zoho Books India / organization {bill.organizationId} / bill {bill.billId}</dd></div>
      <div><dt>Connection / version</dt><dd>{bill.connectionId} / {bill.connectionRevision}</dd></div>
      <div><dt>Revision / schema</dt><dd>{bill.sourceSequence} / {bill.sourceVersion}</dd></div>
      <div><dt>Fingerprint</dt><dd>{bill.sourceFingerprint}</dd></div>
      <div><dt>Original consent</dt><dd>{bill.consentReference} / generation {bill.consentGeneration} / {bill.consentNoticeVersion}</dd></div>
      <div><dt>Consent recorded</dt><dd>{bill.consentAuthorizedAt} / {bill.consentAuthorizedByUserId ?? "Account no longer on record"}</dd></div>
      <div><dt>Read scopes</dt><dd>{bill.consentScopes.join(" / ")}</dd></div>
      <div><dt>Selection meaning</dt><dd>The person confirmed this entire bill was for this approved charge.</dd></div>
      <div><dt>Retained record</dt><dd>The admitted bill and immutable consent, selection and comparison history remain after Books source deletion. Whole-workspace erasure removes the full chain, subject to backup retention.</dd></div>
      {source ? <><div><dt>Current source checked</dt><dd>{source.freshness.checkedAt} / {source.freshness.status.toLowerCase()}</dd></div><div><dt>Unresolved newer / older revisions</dt><dd>{source.pendingMaterialNewerSequences.join(", ") || "None reported"} / {source.pendingMaterialOlderSequences.join(", ") || "None reported"}</dd></div></> : null}
    </dl></details>
    <p className="control-note">Business outcome: not observed from this bill.</p>
  </section>;
}
