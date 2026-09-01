"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { buildGuestAuditSnapshot, guestAuditTransferKey, type TransferStatementSource } from "@/lib/guest-audit-transfer";
import {
  formatDraftInr,
  getGuestProposalDraftServerSnapshot,
  getGuestProposalDraftSnapshot,
  subscribeGuestProposalDraft,
} from "@/lib/guest-proposal-draft";
import { formatCalendarDate } from "@/lib/date-only";
import { startCardsFromRecurringItems, type RecurringItemLike, type StartCard } from "@/lib/recovery/start-cards";
import { fetchReceiptLineProposal } from "@/lib/recovery/image-receipt-proposal";
import { knownMerchantsFromNames } from "@/lib/recovery/monthly-loop";
import { splitReceiptTexts } from "@/lib/recovery/receipt-input";
import { isReceiptImageFile } from "@/lib/recovery/wow-first-session";
import { AuthorizationLoop } from "../authorization-loop";
import { VognaryMark } from "../brand";
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
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const draft = useSyncExternalStore(
    subscribeGuestProposalDraft,
    getGuestProposalDraftSnapshot,
    getGuestProposalDraftServerSnapshot,
  );

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
          receiptTexts: splitReceiptTexts(trimmed),
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
        setStatus("We couldn't verify a merchant, amount, and date from that text. Put each bill on its own line, or separate them with a blank line.");
        setCards([]);
        return;
      }
      setCards(nextCards);
      persistTab(trimmed, sources);
    } catch {
      setStatus("The review could not run. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  function persistTab(
    text: string,
    sources: readonly TransferStatementSource[],
  ) {
    const snapshot = buildGuestAuditSnapshot({ receiptText: text, statementSources: [...sources], manualItems: [] });
    try {
      window.sessionStorage.setItem(guestAuditTransferKey, JSON.stringify(snapshot));
    } catch {
      // Sign-in can still proceed; the workspace will ask for the bills again.
    }
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
        const result = await fetchReceiptLineProposal(file, {
          knownMerchants: knownMerchantsFromNames(cards.map((card) => card.merchant)),
        });
        setImageDrafts((current) => current.map((item) => (
          item.clientRef === draft.clientRef
            ? {
                ...item,
                proposal: result.proposal,
                proposalReason: result.reason,
                proposalStatus: result.proposal ? "ready" : "unreadable",
              }
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
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 font-display text-lg font-semibold text-(--ink)">
          <VognaryMark size={24} />
          Vognary
        </Link>
        <Link href="/login?next=/app" className="btn btn-sm btn-ghost">Sign in</Link>
      </nav>

      <p className="truth-label truth-policy mt-10">Add cited evidence</p>
      <h1 className="mt-3 max-w-2xl font-display text-3xl font-semibold leading-tight text-(--ink) sm:text-4xl">
        See the charge. Sign in to authorize.
      </h1>
      {draft && !draft.usingExample ? (
        <p className="mt-4 max-w-2xl text-sm leading-6 text-(--ink-soft)" data-testid="guest-proposal-draft">
          {draft.amountInr === null
            ? `You named ${draft.merchant} as the next yes.`
            : `You named ${draft.merchant} as the next yes at ${formatDraftInr(draft.amountInr)}.`}
          {" "}That amount is an assumption. Cite a bill to ground existing exposure. This is not a recorded owner decision.
        </p>
      ) : null}
      {!cards.length ? (
        <>
          <p className="mt-3 max-w-2xl text-base leading-7 text-(--muted)">
            Upload or paste a receipt. Vognary cites the merchant, amount, and date. Sign in to remember the evidence and open the Control desk.
          </p>
          <p className="mt-2 text-sm leading-6 text-(--muted)">
            No account needed. Nothing is saved until you sign in.
          </p>
          <AuthorizationLoop activeStep={1} />
        </>
      ) : null}

      {/* Once a bill is cited the decision is the page; the form steps aside. */}
      <details open={!cards.length} className="mt-7 border-y border-line py-6">
        <summary className="flex min-h-11 cursor-pointer list-none items-center font-medium text-(--ink)">
          {cards.length ? "Add another bill" : "Upload or paste a bill"}
        </summary>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <BillDropzone disabled={pending} preparing={pending} onFilesChosen={(files) => void addFiles(files)} />
          <div className="grid content-start gap-3">
            <label htmlFor="start-receipt" className="field-label">Or paste the receipt</label>
            <textarea
              id="start-receipt"
              value={receiptText}
              onChange={(event) => setReceiptText(event.target.value)}
              className="field min-h-40 resize-y"
              placeholder={"Cursor Pro paid USD 20.00 on 28 August 2026.\nSeveral bills? Put each on its own line."}
            />
            <button
              type="button"
              className="btn btn-primary btn-lg justify-self-start"
              disabled={pending || (!receiptText.trim() && statementSources.length === 0)}
              onClick={() => void analyzeWith(receiptText, statementSources)}
            >
              {pending ? "Reading the bill…" : "Check this bill"}
            </button>
          </div>
        </div>
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
        {status ? <p role="alert" className="text-sm leading-6 text-ember">{status}</p> : null}
      </details>

      {cards.length ? (
        <section className="mt-10 grid gap-5" aria-live="polite">
          {cards.map((card) => (
          <article key={card.id} className="decision" data-lead="true">
            <div className="min-w-0">
              <p className="decision-cue">Cited evidence</p>
              <h2 className="decision-sentence mt-2">{card.merchant} · {card.amountDisplay}</h2>
              {card.whenLine && card.whenLine !== "Date not established" ? (
                <p className="decision-due mt-1">{card.whenLine}</p>
              ) : null}
            </div>
            {card.excerpt ? (
              <div className="decision-evidence">
                <p className="eyebrow eyebrow-xs">From your receipt</p>
                <blockquote className="decision-quote">“{card.excerpt}”</blockquote>
              </div>
            ) : null}
            {card.provisional ? <p className="text-sm leading-6 text-(--muted)">This is one cited charge. Its recurring cadence is not proven yet.</p> : null}
          </article>
          ))}
          <AuthorizationLoop completedThrough={1} activeStep={4} />
          <p className="text-sm leading-6 text-(--muted)">
            Sign in to remember this evidence. The next unique step is the Control desk: a named owner or admin freezes a cap before a new obligation exists. That is not Keep or Plan to cancel.
          </p>
          <Link href="/login?next=/app" className="btn btn-primary btn-lg justify-self-start">
            Sign in to remember this evidence
          </Link>
        </section>
      ) : null}
    </main>
  );
}
