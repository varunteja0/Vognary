"use client";

import { useState } from "react";
import { confirmLineInputLocked, receiptLineProposalIsPartial, type ImageProposalStatus, type ReceiptLineProposal } from "@/lib/recovery/image-receipt-proposal";
import { confirmedReceiptText } from "@/lib/recovery/wow-first-session";
import { customerPhrases } from "../present/customer-copy";

export type ImageDraft = {
  clientRef: string;
  name: string;
  previewUrl: string | null;
  proposal?: ReceiptLineProposal | null;
  proposalStatus?: ImageProposalStatus;
};

export function ConfirmReceiptLine({
  draft,
  disabled,
  onConfirm,
  onRemove,
}: {
  draft: ImageDraft;
  disabled: boolean;
  onConfirm: (text: string) => void;
  onRemove: () => void;
}) {
  const [edited, setEdited] = useState<{ merchant?: string; amount?: string; currency?: string; date?: string }>({});
  const merchant = edited.merchant ?? draft.proposal?.merchant ?? "";
  const amount = edited.amount ?? draft.proposal?.amount ?? "";
  const currency = edited.currency ?? draft.proposal?.currency ?? (draft.proposalStatus === "reading" ? "" : "INR");
  const date = edited.date ?? draft.proposal?.date ?? "";
  const text = confirmedReceiptText({ merchant, amount, currency, date });

  const reading = draft.proposalStatus === "reading";
  const unreadable = draft.proposalStatus === "unreadable";
  const locked = confirmLineInputLocked(disabled, draft.proposalStatus);
  const guidance = reading
    ? customerPhrases.readingInvoice
    : unreadable
      ? customerPhrases.imageUnreadable
      : draft.proposal?.zeroPaidVisible
        ? customerPhrases.confirmZeroPaid
        : draft.proposal && receiptLineProposalIsPartial(draft.proposal)
          ? customerPhrases.confirmPartial
          : draft.proposal
            ? customerPhrases.confirmPrefill
            : customerPhrases.confirmTheLine;

  return (
    <article className="inset grid gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm font-semibold text-(--ink)">{draft.name}</p>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onRemove} disabled={locked}>Remove</button>
      </div>
      {draft.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={draft.previewUrl} alt={`Preview of ${draft.name}`} className="max-h-48 w-auto rounded-(--radius) border border-line" />
      ) : null}
      <p className="text-sm leading-6 text-(--muted)">{guidance}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${draft.clientRef}-merchant`} className="field-label">Merchant</label>
          <input id={`${draft.clientRef}-merchant`} className="field mt-1" value={merchant} onChange={(event) => setEdited((current) => ({ ...current, merchant: event.target.value }))} disabled={locked} />
        </div>
        <div>
          <label htmlFor={`${draft.clientRef}-amount`} className="field-label">Amount</label>
          <input id={`${draft.clientRef}-amount`} className="field mt-1" inputMode="decimal" value={amount} onChange={(event) => setEdited((current) => ({ ...current, amount: event.target.value }))} disabled={locked} />
        </div>
        <div>
          <label htmlFor={`${draft.clientRef}-currency`} className="field-label">Currency</label>
          <input id={`${draft.clientRef}-currency`} className="field mt-1" value={currency} onChange={(event) => setEdited((current) => ({ ...current, currency: event.target.value }))} disabled={locked} maxLength={3} />
        </div>
        <div>
          <label htmlFor={`${draft.clientRef}-date`} className="field-label">Charge date</label>
          <input id={`${draft.clientRef}-date`} className="field mt-1" type="date" value={date} onChange={(event) => setEdited((current) => ({ ...current, date: event.target.value }))} disabled={locked} />
        </div>
      </div>
      <button
        type="button"
        className="btn btn-primary justify-self-start"
        disabled={locked || !text}
        onClick={() => {
          if (text) onConfirm(text);
        }}
      >
        Confirm this line
      </button>
    </article>
  );
}
