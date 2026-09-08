"use client";

import "../public.css";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, CheckCheck, Clock3, RefreshCw, Trash2 } from "lucide-react";
import { formatExactMinorUnits } from "@/components/ui/money-value";
import { VognaryMark } from "../brand";
import styles from "../workspace/recovery/bill-review.module.css";

export default function BillReviewDemo() {
  const [revision, setRevision] = useState(2);
  const [disposition, setDisposition] = useState<"RESOLVED" | "FOLLOW_UP" | null>(null);
  const [history, setHistory] = useState<Array<{ revision: number; disposition: "RESOLVED" | "FOLLOW_UP" }>>([]);
  const [reason, setReason] = useState("EXPLAINED");
  const [discarded, setDiscarded] = useState(false);
  const previous = revision === 2 ? "12000" : "13000";
  const current = revision === 2 ? "13000" : "14000";
  function record(next: "RESOLVED" | "FOLLOW_UP") {
    setDisposition(next);
    setHistory(items => [...items, { revision, disposition: next }]);
  }
  return <main className="public-page min-h-screen px-4 py-6 sm:px-8">
    <div className="mx-auto grid max-w-5xl gap-8">
      <header className={styles.top}><Link href="/" aria-label="Vognary home" className="flex items-center gap-2 font-display text-xl"><VognaryMark size={28} />Vognary</Link><Link href="/login?next=%2Fapp%3Fview%3DBILL_REVIEW" className="btn btn-sm btn-primary">Open Bill review<ArrowRight size={16} aria-hidden /></Link></header>
      <section className={styles.desk} aria-label="Synthetic bill review">
        <header><p className="eyebrow">Fixed synthetic example / No provider reads</p><h1 className={styles.title}>Supplier bill review</h1><p className={styles.subtitle}>Bill-review evaluation. A changed bill, a human answer and a saved review. No financial authorization or payment.</p></header>
        <div className={styles.layout}>
          <aside className={styles.list}><div className={styles.row} aria-current="true"><strong>Synthetic supplier</strong><span>SYNTHETIC-001</span><span className={styles.money}>{formatExactMinorUnits(current, "INR")}</span><span>{disposition === "RESOLVED" ? "Review closed" : disposition === "FOLLOW_UP" ? "Follow-up due 10 Sep 2026" : "Bill change needs review"}</span></div><p className={styles.muted}>Synthetic organization / India<br />Revision {revision} / Supplier bill, not payment evidence</p></aside>
          <div className={styles.detail}>
            <h2 className={styles.title}>Synthetic supplier</h2>
            <dl className={styles.comparison}><div><dt>Previously observed</dt><dd className={styles.money}>{formatExactMinorUnits(previous, "INR")}</dd></div><div><dt>This bill total</dt><dd className={styles.money}>{formatExactMinorUnits(current, "INR")}</dd></div></dl>
            <p className={styles.muted}>The same bill increased by {formatExactMinorUnits((BigInt(current) - BigInt(previous)).toString(), "INR")}. Its total and outstanding balance changed. The source does not explain the cause; line items, tax breakdown and service periods are not supplied.</p>
            <details className={styles.source}><summary>Synthetic source facts</summary><p className={styles.muted}>Fixed synthetic Books-shaped bill, organization 100001, bill 200001. Outstanding balance equals this bill total; it is not cash paid. This is one bill revised, not two monthly invoices.</p></details>
            {!disposition ? <div className={styles.form}><label>Human explanation<select className="field" value={reason} onChange={event => setReason(event.target.value)}><option value="EXPLAINED">The synthetic supplier explained the amendment</option><option value="QUESTION">The synthetic supplier explanation is still needed</option></select></label><div className={styles.actions}><button type="button" className="btn btn-primary" onClick={() => record(reason === "EXPLAINED" ? "RESOLVED" : "FOLLOW_UP")}>{reason === "EXPLAINED" ? <CheckCheck size={16} aria-hidden /> : <Clock3 size={16} aria-hidden />}{reason === "EXPLAINED" ? "Close synthetic review" : "Record synthetic follow-up"}</button></div></div> : <div className={styles.notice} role="status"><strong>{disposition === "RESOLVED" ? "Synthetic review closed" : "Synthetic follow-up recorded"}</strong><p>{disposition === "RESOLVED" ? "A human explanation was recorded for this revision. No payment or saving is asserted." : "Responsible person: synthetic finance owner. Due 10 Sep 2026. No supplier message was sent."}</p></div>}
            {disposition && revision === 2 ? <button type="button" className="btn btn-ghost justify-self-start" onClick={() => { setRevision(3); setDisposition(null); }}><RefreshCw size={16} aria-hidden />Simulate a later bill amendment</button> : null}
            {revision === 3 && !disposition ? <p role="status" className={styles.notice}>Revision 3 needs its own review. The earlier human record is retained.</p> : null}
            {history.length ? <details className={styles.source}><summary>Synthetic review history</summary><div className={styles.history}>{history.map((item, index) => <div className={styles.event} key={index}><strong>Revision {item.revision}: {item.disposition === "RESOLVED" ? "review closed" : "follow-up recorded"}</strong><span className={styles.muted}>Synthetic finance owner / Human review, not payment evidence</span></div>)}</div></details> : null}
            <p className={styles.muted}>This example resets on reload. Workspace reviews keep the person, bill revision and history. Actual Zoho access and customer-data activation are not verified by this example. The paid offer remains the separate <Link href="/pay" className="link-quiet">Commitment Control pilot</Link>.</p>
          </div>
        </div>
      </section>
      <footer className="flex flex-wrap justify-between gap-4 border-t border-line pt-4 text-sm text-(--muted)"><Link className="link-quiet" href="/demo">Pre-spend Commitment Control</Link><Link className="link-quiet" href="/security">Customer-data restrictions</Link><Link className="link-quiet" href="/login?next=%2Fapp%3Fview%3DBILL_REVIEW">Continue to your bill desk</Link><button type="button" className="btn btn-sm btn-ghost" onClick={() => { sessionStorage.removeItem("vognary.guest-audit-transfer.v1"); sessionStorage.removeItem("vognary.guest-audit-transfer-binding.v1"); setDiscarded(true); }}><Trash2 size={16} aria-hidden />Discard tab evidence</button></footer>
      {discarded ? <p role="status">Tab evidence discarded. No receipt is queued for sign-in.</p> : null}
    </div>
  </main>;
}
