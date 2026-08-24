"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { buildGuestAuditSnapshot, guestAuditTransferKey, type TransferStatementSource } from "@/lib/guest-audit-transfer";
import { formatCalendarDate } from "@/lib/date-only";
import type { DecisionCycleAction } from "@/lib/recovery/contracts";
import { startCardsFromRecurringItems, type RecurringItemLike, type StartCard } from "@/lib/recovery/start-cards";
import {
  buildStartSessionRecord,
  writeStartSessionRecord,
  type StartSessionDecision,
} from "@/lib/recovery/start-session";
import { fetchReceiptLineProposal } from "@/lib/recovery/image-receipt-proposal";
import {
  decisionArtefactText,
  guestDecisionHookCopy,
  isReceiptImageFile,
  keepIsPrimary,
  reminderOffer,
} from "@/lib/recovery/wow-first-session";
import { VognaryMark } from "../brand";
import { formatDay } from "../workspace/recovery/labels";
import { BillDropzone } from "../workspace/recovery/ui/dropzone";
import { ConfirmReceiptLine, type ImageDraft } from "../workspace/recovery/ui/confirm-receipt-line";

type IngestResponse = {
  sources?: Array<{ name: string; text: string; kind?: TransferStatementSource["kind"]; rowCount: number; warnings?: string[] }>;
  error?: string;
};

export default function StartClient() {
  const [receiptText, setReceiptText] = useState("");
  const [statementSources, setStatementSources] = useState<TransferStatementSource[]>([]);
  const [imageDrafts, setImageDrafts] = useState<ImageDraft[]>([]);
  const [cards, setCards] = useState<StartCard[]>([]);
  const [decisions, setDecisions] = useState<StartSessionDecision[]>([]);
  const [hook, setHook] = useState<{
    title: string;
    body: string;
    artefact: string;
    card: StartCard;
    action: DecisionCycleAction;
  } | null>(null);
  const [reminderRequested, setReminderRequested] = useState(false);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const remaining = useMemo(() => {
    const decided = new Set(decisions.map((decision) => decision.merchant.toLowerCase()));
    return cards.filter((card) => !decided.has(card.merchant.toLowerCase()));
  }, [cards, decisions]);

  async function analyzeWith(text: string, sources: readonly TransferStatementSource[]) {
    const trimmed = text.trim();
    if (!trimmed && sources.length === 0) return;
    setPending(true);
    setStatus(null);
    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          receiptTexts: trimmed ? [trimmed] : [],
          sources: sources.map((source) => ({ name: source.name, text: source.text })),
          manualItems: [],
        }),
      });
      const payload = await response.json() as {
        audit?: { recurringItems?: RecurringItemLike[] };
        cards?: StartCard[];
        error?: string;
      };
      if (!response.ok) {
        setStatus(payload.error || "That bill could not be read. Paste the merchant, amount, and date.");
        return;
      }
      const nextCards = payload.cards?.length
        ? payload.cards
        : startCardsFromRecurringItems(payload.audit?.recurringItems ?? [], formatCalendarDate(new Date()));
      if (!nextCards.length) {
        setStatus("We couldn't verify a merchant, amount, and date from that text. Put them in one line and try again.");
        setCards([]);
        return;
      }
      setCards(nextCards);
      setDecisions([]);
      setHook(null);
      persistTab(trimmed, sources, [], reminderRequested);
    } catch {
      setStatus("The review could not run. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  function decide(card: StartCard, action: DecisionCycleAction) {
    const nextDecisions = [...decisions.filter((item) => item.merchant.toLowerCase() !== card.merchant.toLowerCase()), {
      merchant: card.merchant,
      action,
    }];
    setDecisions(nextDecisions);
    // The hook names a calendar date, not the card's spoken phrase.
    const copy = guestDecisionHookCopy({
      merchant: card.merchant,
      action,
      watchDate: card.dueDate ? formatDay(card.dueDate) : null,
    });
    setHook({
      title: copy.title,
      body: copy.body,
      artefact: decisionArtefactText({
        merchant: card.merchant,
        amountDisplay: card.amountDisplay,
        whenLine: card.whenLine,
        action,
        excerpt: card.excerpt,
        remembered: false,
      }),
      card,
      action,
    });
    persistTab(receiptText, statementSources, nextDecisions, reminderRequested);
  }

  function persistTab(
    text: string,
    sources: readonly TransferStatementSource[],
    nextDecisions: readonly StartSessionDecision[],
    reminder: boolean,
  ) {
    const snapshot = buildGuestAuditSnapshot({ receiptText: text, statementSources: [...sources], manualItems: [] });
    try {
      window.sessionStorage.setItem(guestAuditTransferKey, JSON.stringify(snapshot));
    } catch {
      // Sign-in can still proceed; the workspace will ask for the bills again.
    }
    writeStartSessionRecord(buildStartSessionRecord({ decisions: nextDecisions, reminderRequested: reminder }));
  }

  async function addFiles(files: readonly File[]) {
    const images = files.filter((file) => isReceiptImageFile(file));
    const documents = files.filter((file) => !isReceiptImageFile(file));
    if (images.length) {
      const drafts = images.map((file, index) => ({
        clientRef: `start-image-${Date.now()}-${index}`,
        name: file.name,
        previewUrl: URL.createObjectURL(file),
        proposalStatus: "reading" as const,
      }));
      setImageDrafts((current) => [...current, ...drafts]);
      void Promise.all(images.map(async (file, index) => {
        const draft = drafts[index];
        if (!draft) return;
        const proposal = await fetchReceiptLineProposal(file);
        setImageDrafts((current) => current.map((item) => (
          item.clientRef === draft.clientRef
            ? { ...item, proposal, proposalStatus: proposal ? "ready" : "unreadable" }
            : item
        )));
      }));
    }
    if (!documents.length) {
      if (!images.length) setStatus("Drop a PDF, CSV, spreadsheet, or a photo of the bill.");
      return;
    }
    setPending(true);
    setStatus(null);
    try {
      const body = new FormData();
      for (const file of documents) body.append("files", file);
      const response = await fetch("/api/ingest", { method: "POST", credentials: "same-origin", body });
      const payload = await response.json() as IngestResponse;
      if (!response.ok || !payload.sources?.length) {
        setStatus(payload.error || "That file could not be read as a bill. Paste the merchant, amount, and date.");
        return;
      }
      const nextSources: TransferStatementSource[] = payload.sources.map((source, index) => ({
        id: `start-file-${Date.now()}-${index}`,
        name: source.name,
        text: source.text,
        rowCount: source.rowCount,
        kind: source.kind,
        warnings: source.warnings,
      }));
      setStatementSources((current) => [...current, ...nextSources]);
      await analyzeWith(receiptText, [...statementSources, ...nextSources]);
    } catch {
      setStatus("That file could not be sent. Paste the receipt text instead.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <nav className="flex items-center justify-between gap-3">
        <Link href="/" className="inline-flex items-center gap-2 font-display text-lg font-semibold text-(--ink)">
          <VognaryMark size={24} />
          Vognary
        </Link>
        <Link href="/login?next=/app" className="btn btn-sm btn-ghost">Sign in</Link>
      </nav>

      <p className="eyebrow eyebrow-xs mt-10 text-ochre">Your first decision</p>
      <h1 className="mt-3 max-w-2xl font-display text-4xl font-semibold leading-tight tracking-tight text-(--ink) sm:text-5xl">
        See what this bill means before the next charge.
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-(--muted)">
        Drop or paste one real receipt. Vognary extracts only what it can verify, shows the evidence, and asks what you want remembered.
      </p>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-(--muted)">
        No account required. Nothing is saved to Vognary until you sign in. Google is only for sign-in; Vognary does not access Gmail.
      </p>

      <div className="mt-8 grid gap-4">
        <BillDropzone disabled={pending} preparing={pending} onFilesChosen={(files) => void addFiles(files)} />
        {imageDrafts.map((draft) => (
          <ConfirmReceiptLine
            key={draft.clientRef}
            draft={draft}
            disabled={pending}
            onConfirm={(text) => {
              const nextText = [receiptText.trim(), text].filter(Boolean).join("\n\n");
              setReceiptText(nextText);
              setImageDrafts((current) => current.filter((item) => item.clientRef !== draft.clientRef));
              void analyzeWith(nextText, statementSources);
            }}
            onRemove={() => setImageDrafts((current) => current.filter((item) => item.clientRef !== draft.clientRef))}
          />
        ))}
        <label htmlFor="start-receipt" className="field-label">Paste a receipt instead</label>
        <textarea
          id="start-receipt"
          value={receiptText}
          onChange={(event) => setReceiptText(event.target.value)}
          className="field min-h-40 resize-y"
          placeholder="Cursor Pro paid USD 20.00 on 28 August 2026."
        />
        <button
          type="button"
          className="btn btn-primary btn-lg justify-self-start"
          disabled={pending || (!receiptText.trim() && statementSources.length === 0)}
          onClick={() => void analyzeWith(receiptText, statementSources)}
        >
          {pending ? "Reading the bill…" : "Review this bill"}
        </button>
        {status ? <p role="alert" className="text-sm leading-6 text-ember">{status}</p> : null}
      </div>

      {hook ? (
        <section className="decision mt-10" data-lead="true" aria-live="polite">
          <div>
            <p className="eyebrow eyebrow-xs text-ochre">Ready to remember</p>
            <h2 className="decision-hook-title mt-2">{hook.title}</h2>
            <p className="mt-3 text-base leading-7 text-(--ink-soft)">{hook.body}</p>
          </div>
          <div className="decision-evidence">
            <p className="eyebrow eyebrow-xs">Decision artifact</p>
            <p className="decision-evidence-line">
              <strong className="font-display text-lg font-semibold text-(--ink)">{hook.card.amountDisplay}</strong>
              <span>{hook.card.whenLine}</span>
            </p>
            {hook.card.excerpt ? <blockquote className="decision-quote">“{hook.card.excerpt}”</blockquote> : null}
          </div>
          <p className="text-xs leading-5 text-(--muted)">
            This decision is still only in this browser tab. Sign in to save it and activate the next-window memory.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link href="/login?next=/app" className="btn btn-primary">
              Sign in to remember this decision
            </Link>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(hook.artefact);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Copied. Forward it in ten seconds." : "Copy this for my cofounder"}
            </button>
            <label className="flex items-center gap-2 text-sm leading-6 text-(--ink-soft)">
              <input
                type="checkbox"
                checked={reminderRequested}
                onChange={(event) => {
                  setReminderRequested(event.target.checked);
                  persistTab(receiptText, statementSources, decisions, event.target.checked);
                }}
              />
              {reminderOffer}
            </label>
          </div>
        </section>
      ) : null}

      {remaining.map((card) => {
        const keepPrimary = keepIsPrimary(card.reasonKeys);
        return (
          <article key={card.id} className="decision mt-6" data-lead="true">
            <div>
              <p className="decision-cue">Decision before the next charge</p>
              <h2 className="decision-sentence mt-2">{card.sentence}</h2>
            </div>
            {card.excerpt ? (
              <div className="decision-evidence">
                <p className="eyebrow eyebrow-xs">From your receipt</p>
                <blockquote className="decision-quote">“{card.excerpt}”</blockquote>
              </div>
            ) : null}
            <div>
              <p className="eyebrow eyebrow-xs">Why a decision is needed now</p>
              <ul className="reason-list mt-2">
                {card.overlapMerchants.length ? (
                  <li>{`${card.overlapMerchants.join(" and ")} also appears in the bills you added.`}</li>
                ) : null}
                {card.provisional ? <li>This is one cited charge. Its recurring cadence is not proven yet.</li> : null}
                {!card.overlapMerchants.length && !card.provisional ? <li>You have not recorded a decision for this charge.</li> : null}
              </ul>
            </div>
            <div className="decision-actions mt-5">
              <div role="group" aria-label="Your choice" className="flex flex-wrap items-center gap-2">
                <button type="button" className={`btn btn-sm ${keepPrimary ? "btn-primary" : "btn-ghost"}`} onClick={() => decide(card, "KEEP")}>Keep</button>
                <button type="button" className={`btn btn-sm ${keepPrimary ? "btn-ghost" : "btn-primary"}`} onClick={() => decide(card, "REVIEW_LATER")}>Review later</button>
                <button type="button" className="btn btn-sm btn-quiet-danger" onClick={() => decide(card, "PLAN_TO_CANCEL")}>Plan to cancel</button>
              </div>
            </div>
          </article>
        );
      })}
    </main>
  );
}
