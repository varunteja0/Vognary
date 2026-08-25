"use client";

import { useState } from "react";
import { recoveryLimits, type EvidenceSubmissionDto } from "@/lib/recovery/contracts";
import { rejectedSubmissionCopy } from "./present";
import { errorCopy } from "./labels";
import { FailureBlock } from "./recovery-states";
import type { EvidenceDraft, RecoveryFailure } from "./state";
import { fetchReceiptLineProposal, type ReceiptLineProposal } from "@/lib/recovery/image-receipt-proposal";
import { isReceiptImageFile } from "@/lib/recovery/wow-first-session";
import type { ImageDraft } from "./state";
import { BillDropzone } from "./ui/dropzone";
import { ConfirmReceiptLine } from "./ui/confirm-receipt-line";

export type AddEvidenceHandlers = {
  onModeChange: (mode: EvidenceDraft["mode"]) => void;
  onReceiptChange: (text: string) => void;
  onFilesChosen: (files: readonly File[]) => void;
  onImageDrafts: (drafts: readonly ImageDraft[]) => void;
  onImageProposal: (clientRef: string, proposal: ReceiptLineProposal | null) => void;
  onRemoveSource: (clientRef: string) => void;
  onConfirmImageLine: (clientRef: string, text: string) => void;
  onRemoveImageDraft: (clientRef: string) => void;
  onSubmit: (mode: EvidenceDraft["mode"]) => void;
};

export function RecoveryAddEvidence({
  draft,
  submission,
  failure,
  pending,
  online,
  handlers,
}: {
  draft: EvidenceDraft;
  submission: EvidenceSubmissionDto | null;
  failure: RecoveryFailure | null;
  pending: boolean;
  online: boolean;
  variant?: "EMPTY_WORKSPACE" | "FULL";
  handlers: AddEvidenceHandlers;
}) {
  const [method, setMethod] = useState<"UPLOAD" | "PASTE">(draft.mode === "RECEIPT_PASTE" && draft.receiptText ? "PASTE" : "UPLOAD");
  const receiptLength = draft.receiptText.length;
  const overReceiptLimit = receiptLength > recoveryLimits.maxReceiptCharacters;
  const canPaste = Boolean(draft.receiptText.trim()) && !overReceiptLimit && online && !pending && draft.imageDrafts.length === 0;
  const canUpload = draft.csvSources.length > 0 && online && !pending;

  return (
    <div className="grid gap-5">
      <div role="tablist" aria-label="How to add bills" className="segmented">
        <button type="button" role="tab" aria-selected={method === "UPLOAD"} data-active={method === "UPLOAD"} onClick={() => setMethod("UPLOAD")}>
          Upload file
        </button>
        <button type="button" role="tab" aria-selected={method === "PASTE"} data-active={method === "PASTE"} onClick={() => setMethod("PASTE")}>
          Paste text
        </button>
      </div>

      {method === "UPLOAD" ? (
        <div className="grid gap-4">
          <BillDropzone
            disabled={!online || pending}
            preparing={draft.preparing}
            onFilesChosen={(files) => {
              const images = files.filter((file) => isReceiptImageFile(file));
              const documents = files.filter((file) => !isReceiptImageFile(file));
              if (images.length) {
                const drafts = images.map((file, index) => ({
                  clientRef: `image-${Date.now()}-${index}`,
                  name: file.name,
                  previewUrl: URL.createObjectURL(file),
                  proposalStatus: "reading" as const,
                }));
                handlers.onImageDrafts(drafts);
                void Promise.all(images.map(async (file, index) => {
                  const draft = drafts[index];
                  if (!draft) return;
                  const proposal = await fetchReceiptLineProposal(file);
                  handlers.onImageProposal(draft.clientRef, proposal);
                }));
              }
              if (documents.length) {
                handlers.onModeChange("CSV_IMPORT");
                handlers.onFilesChosen(documents);
              }
            }}
          />
          {draft.imageDrafts.length ? (
            <div className="grid gap-3">
              {draft.imageDrafts.map((image) => (
                <ConfirmReceiptLine
                  key={image.clientRef}
                  draft={image}
                  disabled={!online || pending}
                  onConfirm={(text) => handlers.onConfirmImageLine(image.clientRef, text)}
                  onRemove={() => handlers.onRemoveImageDraft(image.clientRef)}
                />
              ))}
            </div>
          ) : null}
          {draft.csvSources.length ? (
            <ul className="grid gap-2">
              {draft.csvSources.map((source) => (
                <li key={source.clientRef} className="inset flex flex-wrap items-center justify-between gap-3 p-3">
                  <div>
                    <p className="text-sm font-semibold text-(--ink)">{source.name}</p>
                    <p className="font-data text-xs text-(--muted)">{source.rowCount} rows · {source.text.length.toLocaleString("en-IN")} characters</p>
                    {source.warnings.map((warning) => (
                      <p key={warning} className="mt-1 text-xs leading-5 text-ochre">{warning}</p>
                    ))}
                  </div>
                  <button type="button" onClick={() => handlers.onRemoveSource(source.clientRef)} className="btn btn-sm btn-ghost">Remove</button>
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            onClick={() => handlers.onSubmit("CSV_IMPORT")}
            disabled={!canUpload}
            className="btn btn-primary btn-lg justify-self-start"
          >
            {pending && draft.mode === "CSV_IMPORT"
              ? "Reading your invoice…"
              : draft.csvSources.length > 1
                ? "Add bills"
                : "Add a bill"}
          </button>
        </div>
      ) : (
        <div>
          <label htmlFor="recovery-receipt-input" className="field-label block">Receipt or invoice text</label>
          <textarea
            id="recovery-receipt-input"
            value={draft.receiptText}
            onChange={(event) => {
              handlers.onReceiptChange(event.target.value);
              if (draft.mode !== "RECEIPT_PASTE") handlers.onModeChange("RECEIPT_PASTE");
            }}
            className="field mt-1 min-h-44 resize-y text-base leading-6"
            placeholder="Paste the merchant, amount, and date. Separate several bills with a blank line."
            aria-describedby="recovery-receipt-hint"
            aria-invalid={overReceiptLimit}
          />
          <p id="recovery-receipt-hint" className="field-hint">
            {receiptLength.toLocaleString("en-IN")} of {recoveryLimits.maxReceiptCharacters.toLocaleString("en-IN")} characters
            {overReceiptLimit ? " — too long to submit. Remove some text." : ""}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => handlers.onSubmit("RECEIPT_PASTE")}
              disabled={!canPaste}
              className="btn btn-primary btn-lg"
            >
              {pending && draft.mode === "RECEIPT_PASTE" ? "Reading your invoice…" : "Add a bill"}
            </button>
            {!online ? <span className="font-data text-xs text-ochre">Offline — nothing can be sent right now.</span> : null}
          </div>
        </div>
      )}

      {failure ? <FailureBlock failure={failure} /> : null}
      {submission ? <SubmissionReceipt submission={submission} /> : null}
    </div>
  );
}

function SubmissionReceipt({ submission }: { submission: EvidenceSubmissionDto }) {
  const rejected = submission.results.filter((result) => result.status === "REJECTED");
  if (!rejected.length && submission.acceptedEvidenceCount > 0) return null;
  return (
    <section aria-label="What happened" className="grid gap-3">
      {submission.acceptedEvidenceCount > 0 ? (
        <p className="text-sm leading-6 text-(--ink-soft)">
          {submission.acceptedEvidenceCount === 1 ? "1 bill was saved." : `${submission.acceptedEvidenceCount.toLocaleString("en-IN")} bills were saved.`}
        </p>
      ) : null}
      {rejected.map((result) => {
        const copy = result.status === "REJECTED" ? rejectedSubmissionCopy(result.code) : errorCopy.UNKNOWN;
        return (
          <div key={result.clientRef} className="inset border border-ember p-4" role="alert">
            <p className="font-display text-base font-semibold text-(--ink)">{copy.title}</p>
            <p className="mt-1 text-sm leading-6 text-(--muted)">{copy.detail}</p>
          </div>
        );
      })}
    </section>
  );
}
