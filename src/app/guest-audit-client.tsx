"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { findActionableCancelAction, manageUrlHostname } from "@/lib/cancel-actions";
import { scrollIntoViewWithMotion } from "@/lib/client-motion";
import { rankFirstAction } from "@/lib/first-action";
import { formatMoney, formatShortDate } from "@/lib/format";
import {
  buildGuestAuditSnapshot,
  guestAuditTransferKey,
  guestAuditTransferTtlMs,
  parseGuestAuditSnapshot,
  type TransferStatementSource,
} from "@/lib/guest-audit-transfer";
import {
  analyzeStatements,
  type Frequency,
  type ManualRecurringInput,
  type RecurringItem,
} from "@/lib/recurring-audit";
import { receiptTextToManualInputs, splitReceiptSnippets } from "@/lib/receipt-parser";
import { sampleReceiptText } from "@/lib/sample-audit";
import { VognaryMark } from "./brand";
import { Nakul } from "./character";
import { RunwayStrip } from "./runway-strip";

import type { GmailConnectAvailability } from "./app/experience-client";

export default function GuestAuditClient({ gmailConnect }: { gmailConnect?: GmailConnectAvailability }) {
  const gmailAvailable = gmailConnect?.available ?? false;
  const [receiptText, setReceiptText] = useState("");
  const [statementSources, setStatementSources] = useState<TransferStatementSource[]>([]);
  const [manualItems, setManualItems] = useState<ManualRecurringInput[]>([]);
  const [manualDraft, setManualDraft] = useState({ merchant: "", amount: "", frequency: "monthly" as Frequency, nextExpectedDate: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [transferHydrated, setTransferHydrated] = useState(false);
  const [transferReady, setTransferReady] = useState(false);
  const [sampleMode, setSampleMode] = useState(false);
  const transferExportedAtRef = useRef<Date | null>(null);

  const receiptItems = useMemo(() => receiptTextToManualInputs(receiptText), [receiptText]);
  const audit = useMemo(() => analyzeStatements(
    statementSources.map(({ name, text }) => ({ name, text })),
    [...manualItems, ...receiptItems],
  ), [manualItems, receiptItems, statementSources]);
  const firstAction = useMemo(() => rankFirstAction(audit.recurringItems), [audit.recurringItems]);
  const nextRenewal = useMemo(() => findNextRenewal(audit.recurringItems), [audit.recurringItems]);
  const proofExcerpt = useMemo(() => findProofExcerpt(receiptText, firstAction?.item ?? null), [firstAction, receiptText]);
  const cancelAction = useMemo(
    () => (firstAction ? findActionableCancelAction(firstAction.item.merchant, firstAction.item.category, firstAction.action) : null),
    [firstAction],
  );
  const monthlyTotals = useMemo(() => buildMonthlyTotals(audit.recurringItems), [audit.recurringItems]);
  const hasEvidence = Boolean(receiptText.trim() || statementSources.length || manualItems.length);
  const hasResult = audit.recurringItems.length > 0;

  useEffect(() => {
    let cancelled = false;
    const raw = window.sessionStorage.getItem(guestAuditTransferKey);
    const snapshot = parseGuestAuditSnapshot(raw);
    queueMicrotask(() => {
      if (cancelled) return;
      if (snapshot) {
        transferExportedAtRef.current = new Date(snapshot.exportedAt);
        setReceiptText(snapshot.receiptText);
        setStatementSources(snapshot.statementSources);
        setManualItems(snapshot.manualItems);
        setTransferReady(true);
      } else if (raw) {
        window.sessionStorage.removeItem(guestAuditTransferKey);
        setNotice("The previous same-tab transfer expired or was invalid and has been cleared.");
      }
      setTransferHydrated(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (!transferHydrated) return;
    if (sampleMode) {
      window.sessionStorage.removeItem(guestAuditTransferKey);
      transferExportedAtRef.current = null;
      queueMicrotask(() => setTransferReady(false));
      return;
    }
    if (!hasEvidence) {
      window.sessionStorage.removeItem(guestAuditTransferKey);
      transferExportedAtRef.current = null;
      queueMicrotask(() => setTransferReady(false));
      return;
    }
    transferExportedAtRef.current ??= new Date();
    const snapshot = buildGuestAuditSnapshot({ receiptText, statementSources, manualItems }, transferExportedAtRef.current);
    try {
      const serialized = JSON.stringify(snapshot);
      if (!parseGuestAuditSnapshot(serialized)) throw new Error("Guest audit transfer exceeds its safety bounds.");
      window.sessionStorage.setItem(guestAuditTransferKey, serialized);
      if (window.sessionStorage.getItem(guestAuditTransferKey) !== serialized) throw new Error("Guest audit transfer could not be verified.");
      queueMicrotask(() => setTransferReady(true));
    } catch {
      window.sessionStorage.removeItem(guestAuditTransferKey);
      queueMicrotask(() => setTransferReady(false));
      queueMicrotask(() => setNotice("This tab could not stage the audit for sign-in. Keep this page open and retry after freeing browser storage."));
    }
  }, [hasEvidence, manualItems, receiptText, sampleMode, statementSources, transferHydrated]);

  useEffect(() => {
    if (!transferReady || !transferExportedAtRef.current) return;
    const remainingMs = transferExportedAtRef.current.getTime() + guestAuditTransferTtlMs - Date.now();
    const expire = () => {
      window.sessionStorage.removeItem(guestAuditTransferKey);
      transferExportedAtRef.current = null;
      setTransferReady(false);
      setNotice("The two-hour sign-in transfer expired and was cleared. Your current audit remains in this open tab.");
    };
    if (remainingMs <= 0) {
      queueMicrotask(expire);
      return;
    }
    const timer = window.setTimeout(expire, remainingMs);
    return () => window.clearTimeout(timer);
  }, [transferReady]);

  function clearGuestAudit() {
    setReceiptText("");
    setStatementSources([]);
    setManualItems([]);
    setSampleMode(false);
    window.sessionStorage.removeItem(guestAuditTransferKey);
    transferExportedAtRef.current = null;
    setTransferReady(false);
    setNotice("This tab's guest evidence has been cleared.");
  }

  function loadSampleAudit() {
    setReceiptText(sampleReceiptText);
    setStatementSources([]);
    setManualItems([]);
    setSampleMode(true);
    setNotice("Sample audit loaded. These eight example subscriptions are not your data and will not be staged for sign-in.");
    window.setTimeout(() => scrollIntoViewWithMotion(document.getElementById("guest-result"), { block: "start" }), 0);
  }

  function addManualItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number.parseFloat(manualDraft.amount);
    if (!manualDraft.merchant.trim() || !Number.isFinite(amount) || amount <= 0 || !manualDraft.nextExpectedDate) {
      setNotice("Add a merchant, positive amount, and next renewal date.");
      return;
    }
    setManualItems((current) => [...current, {
      id: `guest-manual-${Date.now()}`,
      merchant: manualDraft.merchant.trim(),
      amount,
      currency: "INR",
      frequency: manualDraft.frequency,
      nextExpectedDate: manualDraft.nextExpectedDate,
      category: "Other",
      sourceName: "Manual entry (user confirmed)",
    }]);
    setSampleMode(false);
    setManualDraft({ merchant: "", amount: "", frequency: "monthly", nextExpectedDate: "" });
    setNotice("Manual renewal added to this tab.");
  }

  return (
    <main className="guest-shell px-4 py-4 text-foreground sm:px-6 sm:py-6">
      <div className="mx-auto w-full max-w-3xl">
        <header className="flex items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={24} /> Vognary
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/guide" className="btn btn-sm btn-ghost">How it works</Link>
            <Link href="/privacy" className="btn btn-sm btn-ghost">Privacy</Link>
          </div>
        </header>

        <section aria-label="Choose how to start" className="mt-5 rounded-2xl border border-line bg-card p-5 shadow-[0_18px_70px_rgba(0,0,0,0.28)] sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-data text-[0.66rem] uppercase tracking-[0.16em] text-verdict">Private by default · no login</p>
              <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-(--ink) sm:text-4xl">Know what renews before it charges</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-(--muted) sm:text-base">
                Start with connected sources or evidence you already have. Pasted receipts work immediately in this private tab.
              </p>
            </div>
            <Nakul pose="guide" size={92} className="hidden shrink-0 text-(--ink) sm:block" title="Nakul, the ledger mongoose, showing the way in" />
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {gmailAvailable ? (
              <a href="/login?next=/app" className="group rounded-xl border border-(--gold-line) bg-(--card-2) p-4 transition hover:border-(--gold)">
                <p className="font-data text-[0.6rem] uppercase tracking-[0.16em] text-(--gold)">Connect · read-only</p>
                <p className="mt-2 font-display text-lg font-semibold text-(--ink)">Connect Gmail</p>
                <p className="mt-1 text-xs leading-5 text-(--muted)">Sign in, grant revocable receipt access, and see freshness beside the connection.</p>
                <p className="mt-3 text-xs font-semibold text-(--gold) transition group-hover:translate-x-0.5">Sign in to connect →</p>
              </a>
            ) : (
              <div className="rounded-xl border border-line bg-(--card-2) p-4">
                <p className="font-data text-[0.6rem] uppercase tracking-[0.16em] text-(--muted)">Gmail · {gmailConnect?.label ?? "Not available yet"}</p>
                <p className="mt-2 font-display text-lg font-semibold text-(--ink-soft)">Gmail sync is coming</p>
                <p className="mt-1 text-xs leading-5 text-(--muted)">{gmailConnect?.meaning ?? "Provider approval for this deployment is still in progress."}</p>
                <p className="mt-3 text-xs font-semibold text-(--muted)">Paste works today →</p>
              </div>
            )}
            <a href="#paste" className={`group rounded-xl border ${gmailAvailable ? "border-line" : "border-(--gold-line)"} bg-(--card-2) p-4 transition hover:border-(--gold)`}>
              <p className={`font-data text-[0.6rem] uppercase tracking-[0.16em] ${gmailAvailable ? "text-(--muted)" : "text-(--gold)"}`}>Paste · instant</p>
              <p className="mt-2 font-display text-lg font-semibold text-(--ink)">Paste a receipt</p>
              <p className="mt-1 text-xs leading-5 text-(--muted)">Two receipts are enough for your first result — monthly burn, next renewal, one action. Nothing leaves this tab.</p>
              <p className="mt-3 text-xs font-semibold text-(--ink-soft) transition group-hover:translate-x-0.5">Start below →</p>
            </a>
            <button type="button" onClick={loadSampleAudit} className="group rounded-xl border border-line bg-(--card-2) p-4 text-left transition hover:border-(--line-strong)">
              <p className="font-data text-[0.6rem] uppercase tracking-[0.16em] text-(--muted)">Explore · no setup</p>
              <p className="mt-2 font-display text-lg font-semibold text-(--ink)">See a sample audit</p>
              <p className="mt-1 text-xs leading-5 text-(--muted)">Open eight clearly labelled example subscriptions, their burn, next renewal, and proof.</p>
              <p className="mt-3 text-xs font-semibold text-(--ink-soft) transition group-hover:translate-x-0.5">Load sample →</p>
            </button>
          </div>
        </section>

        <section id="paste" className="guest-capture mt-5 rounded-2xl border border-line bg-card p-5 shadow-[0_18px_70px_rgba(0,0,0,0.28)] sm:p-7">
          <h2 className="font-display text-xl font-semibold tracking-tight text-(--ink)">Paste receipts or invoices</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">
            Paste two or more receipts. Vognary shows your monthly burn, next renewal, one action, and the proof behind it.
          </p>
          {sampleMode ? (
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-(--gold-line) bg-(--gold-tint) p-3 sm:flex-row sm:items-center sm:justify-between" role="status">
              <p className="text-sm leading-6 text-(--ink)"><strong>Sample audit.</strong> These are example subscriptions, not your data, and they will not transfer when you sign in.</p>
              <button type="button" onClick={clearGuestAudit} className="btn btn-ghost h-9 shrink-0 px-3 text-xs">Clear sample</button>
            </div>
          ) : null}

          <label htmlFor="guest-receipts" className="sr-only">Paste receipts or invoices</label>
          <textarea
            id="guest-receipts"
            value={receiptText}
            onChange={(event) => {
              setReceiptText(event.target.value);
              setSampleMode(false);
            }}
            className="field mt-2 min-h-44 resize-y text-base leading-6"
            placeholder="Paste receipt or renewal text with merchant, amount, and date. Separate receipts with a blank line."
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {hasEvidence ? <button type="button" onClick={clearGuestAudit} className="btn btn-sm btn-ondark">Clear this tab</button> : null}
          </div>
          <p className="mt-3 text-xs leading-5 text-(--muted)">
            Receipt text is analyzed in this tab and stays here unless you choose to save the audit after sign-in.
          </p>
          {!online ? <p role="status" className="mt-3 text-sm text-ochre">Offline: paste and manual entry work in this tab.</p> : null}
          {notice ? <p role="status" aria-live="polite" className="mt-3 rounded-lg border border-line bg-(--card-2) px-3 py-2 text-sm leading-6 text-(--ink-soft)">{notice}</p> : null}

          <details className="mt-4 border-t border-line pt-4">
            <summary className="cursor-pointer text-sm font-medium text-(--ink-soft)">Add one renewal manually</summary>
            <form onSubmit={addManualItem} className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5"><span className="field-label">Merchant</span><input className="field" value={manualDraft.merchant} onChange={(event) => setManualDraft({ ...manualDraft, merchant: event.target.value })} /></label>
              <label className="grid gap-1.5"><span className="field-label">Amount (INR)</span><input className="field" inputMode="decimal" value={manualDraft.amount} onChange={(event) => setManualDraft({ ...manualDraft, amount: event.target.value })} /></label>
              <label className="grid gap-1.5"><span className="field-label">Frequency</span><select className="field" value={manualDraft.frequency} onChange={(event) => setManualDraft({ ...manualDraft, frequency: event.target.value as Frequency })}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></label>
              <label className="grid gap-1.5"><span className="field-label">Next renewal</span><input className="field" type="date" value={manualDraft.nextExpectedDate} onChange={(event) => setManualDraft({ ...manualDraft, nextExpectedDate: event.target.value })} /></label>
              <button className="btn btn-ghost sm:col-span-2" type="submit">Add renewal</button>
            </form>
          </details>
        </section>

        {hasResult && firstAction && nextRenewal ? (
          <>
          <section id="guest-result" aria-label="Your first audit result" aria-live="polite" className="mt-5 scroll-mt-4 rounded-2xl border border-(--gold-line) bg-card p-5 sm:p-7">
            <div className={`grid gap-3 ${monthlyTotals.length === 1 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
              {monthlyTotals.map(([currency, amount]) => (
                <ResultMetric key={currency} label={monthlyTotals.length === 1 ? "Monthly burn" : `Monthly total · ${currency}`} value={formatMoney(amount, currency)} />
              ))}
              <ResultMetric label="Next renewal" value={formatShortDate(nextRenewal.nextExpectedDate)} detail={`${nextRenewal.merchant} · ${formatMoney(nextRenewal.averageAmount, nextRenewal.currency)}`} />
              <ResultMetric label="Do this first" value={firstAction.action} detail={firstAction.item.merchant} />
            </div>
            {monthlyTotals.length > 1 ? <p className="mt-3 text-xs text-(--muted)">Currencies stay separate because Vognary does not invent an exchange rate.</p> : null}
            <div className="mt-5 rounded-xl border border-line bg-(--card-2) p-4">
              <p className="font-data text-[0.64rem] uppercase tracking-[0.16em] text-verdict">Proof</p>
              <p className="mt-2 text-sm font-semibold text-(--ink)">{firstAction.item.merchant} · {firstAction.item.confidenceScore}% evidence confidence</p>
              <p className="mt-2 text-sm leading-6 text-(--ink-soft)">{proofExcerpt ?? firstAction.item.evidence[0]?.description ?? firstAction.proof}</p>
              <p className="mt-2 text-xs text-(--muted)">{firstAction.item.evidence[0]?.source ?? "User-confirmed evidence"}. {firstAction.reason}</p>
            </div>
            {cancelAction ? (
              <div className="mt-3 rounded-xl border border-line bg-(--card-2) p-4">
                <p className="font-data text-[0.64rem] uppercase tracking-[0.16em] text-verdict">{cancelAction.kind === "rail-guide" ? "How to stop this payment" : "Cancel on the provider's own page"}</p>
                {cancelAction.manageUrl ? (
                  <a href={cancelAction.manageUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-semibold text-(--ink) underline underline-offset-4">
                    Open {manageUrlHostname(cancelAction)} ↗
                  </a>
                ) : null}
                <ol className="mt-2 grid gap-1 text-sm leading-6 text-(--ink-soft)">
                  {cancelAction.steps.map((step, index) => (
                    <li key={step}>{index + 1}. {step}</li>
                  ))}
                </ol>
                {cancelAction.caveat ? <p className="mt-2 text-xs leading-5 text-(--muted)">{cancelAction.caveat}</p> : null}
              </div>
            ) : null}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Link href="/private-audit" prefetch={false} className="btn btn-primary btn-lg">Request private audit</Link>
              {sampleMode
                ? <button type="button" onClick={clearGuestAudit} className="btn btn-ghost btn-lg">Clear sample</button>
                : transferReady
                ? <a href="/login?next=/app" className="btn btn-ghost btn-lg">Save this audit</a>
                : <button type="button" className="btn btn-ghost btn-lg" disabled>Save unavailable in this tab</button>}
            </div>
            <p className="mt-3 text-xs leading-5 text-(--muted)">{sampleMode ? "Sample evidence is never staged for sign-in." : "Your exact evidence is staged only in this tab for the sign-in handoff and clears after encrypted workspace sync succeeds."}</p>
          </section>
          <RunwayStrip items={audit.recurringItems} />
          </>
        ) : hasEvidence ? (
          <p role="status" className="mt-4 rounded-xl border border-line bg-(--card-2) px-4 py-3 text-sm leading-6 text-(--muted)">No recurring result yet. Add another receipt with a merchant, amount, and renewal or subscription cue.</p>
        ) : null}
      </div>
    </main>
  );
}

function ResultMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="rounded-xl border border-line bg-(--card-2) p-4"><p className="font-data text-[0.62rem] uppercase tracking-[0.14em] text-(--muted)">{label}</p><p className="mt-2 font-display text-xl font-semibold capitalize text-(--ink)">{value}</p>{detail ? <p className="mt-1 text-xs text-(--muted)">{detail}</p> : null}</div>;
}

function findNextRenewal(items: RecurringItem[]) {
  return [...items].sort((left, right) => left.nextExpectedDate.localeCompare(right.nextExpectedDate) || left.identityKey.localeCompare(right.identityKey))[0] ?? null;
}

function findProofExcerpt(text: string, item: RecurringItem | null) {
  if (!item) return null;
  return splitReceiptSnippets(text).find((snippet) => snippet.toLowerCase().includes(item.merchant.toLowerCase()) || snippet.toLowerCase().includes(item.normalizedMerchant.toLowerCase())) ?? null;
}

function buildMonthlyTotals(items: RecurringItem[]) {
  const totals: Record<string, number> = {};
  for (const item of items) totals[item.currency] = (totals[item.currency] ?? 0) + item.monthlyCost;
  return Object.entries(totals).sort(([left], [right]) => left.localeCompare(right, "en"));
}

