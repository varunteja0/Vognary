"use client";

import { recoveryLimits, type EvidenceSubmissionDto } from "@/lib/recovery/contracts";
import { errorCopy, formatMoment, sourceLabels } from "./labels";
import { FailureBlock } from "./recovery-states";
import type { EvidenceDraft, RecoveryFailure } from "./state";

export type AddEvidenceHandlers = {
  onModeChange: (mode: EvidenceDraft["mode"]) => void;
  onReceiptChange: (text: string) => void;
  onFilesChosen: (files: readonly File[]) => void;
  onRemoveSource: (clientRef: string) => void;
  onSubmit: (mode: EvidenceDraft["mode"]) => void;
};

// Receipt paste is the primary and only headline input. File import stays folded
// away as the secondary fallback. No external-account surface appears here at all.
export function RecoveryAddEvidence({
  draft,
  submission,
  failure,
  pending,
  online,
  variant,
  handlers,
}: {
  draft: EvidenceDraft;
  submission: EvidenceSubmissionDto | null;
  failure: RecoveryFailure | null;
  pending: boolean;
  online: boolean;
  variant: "EMPTY_WORKSPACE" | "FULL";
  handlers: AddEvidenceHandlers;
}) {
  const receiptLength = draft.receiptText.length;
  const overReceiptLimit = receiptLength > recoveryLimits.maxReceiptCharacters;

  return (
    <div className="grid gap-5">
      <section aria-labelledby="recovery-paste-heading" className="panel p-4 sm:p-6">
        <h3 id="recovery-paste-heading" className="font-display text-xl font-semibold text-(--ink) sm:text-2xl">
          {variant === "EMPTY_WORKSPACE" ? "Paste your first receipt" : "Paste a receipt or invoice"}
        </h3>
        {variant === "EMPTY_WORKSPACE" ? (
          <ol className="mt-4 grid max-w-2xl gap-2 text-sm leading-6 text-(--muted)">
            <li><strong className="text-(--ink-soft)">1.</strong> Paste 2-3 billing emails or invoices.</li>
            <li><strong className="text-(--ink-soft)">2.</strong> Use the same service twice so Vognary can test a cadence.</li>
            <li><strong className="text-(--ink-soft)">3.</strong> See monthly burn, the next expected charge, and one decision when the receipts support them.</li>
          </ol>
        ) : (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">Paste the receipt text exactly as you received it. It is stored as evidence and never edited.</p>
        )}

        <label htmlFor="recovery-receipt-input" className="field-label mt-4 block">Receipt or invoice text</label>
        <textarea
          id="recovery-receipt-input"
          value={draft.receiptText}
          onChange={(event) => {
            handlers.onReceiptChange(event.target.value);
            if (draft.mode !== "RECEIPT_PASTE") handlers.onModeChange("RECEIPT_PASTE");
          }}
          className="field mt-1 min-h-44 resize-y text-base leading-6"
          placeholder="Paste receipt text with the merchant, amount, and date. Separate several receipts with a blank line."
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
            disabled={!draft.receiptText.trim() || pending || !online || overReceiptLimit}
            className="btn btn-primary btn-lg"
          >
            {pending && draft.mode === "RECEIPT_PASTE" ? "Saving evidence…" : "Save this receipt as evidence"}
          </button>
          {!online ? <span className="font-data text-xs text-ochre">Offline — nothing can be sent right now.</span> : null}
        </div>

        <details className="mt-5 border-t border-line pt-4">
          <summary className="cursor-pointer select-none text-sm font-medium text-(--ink-soft)">
            Import a statement file instead (fallback)
          </summary>
          <div className="mt-4 grid gap-3">
            <p className="text-sm leading-6 text-(--muted)">
              Files are read into text first so you can see exactly what will be stored. Up to {recoveryLimits.maxCsvSources} files.
            </p>
            <input
              id="recovery-file-input"
              type="file"
              multiple
              className="field h-auto py-2 text-sm"
              aria-label="Choose statement files"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                if (files.length) {
                  handlers.onModeChange("CSV_IMPORT");
                  handlers.onFilesChosen(files);
                }
                event.target.value = "";
              }}
            />
            {draft.preparing ? <p role="status" className="font-data text-xs text-(--muted)">Reading the chosen files…</p> : null}
            {draft.csvSources.length ? (
              <>
                <ul className="grid gap-2">
                  {draft.csvSources.map((source) => (
                    <li key={source.clientRef} className="inset flex flex-wrap items-center justify-between gap-3 p-3">
                      <div>
                        <p className="text-sm font-semibold text-(--ink)">{source.name}</p>
                        <p className="font-data text-xs text-(--muted)">{source.rowCount} rows read · {source.text.length.toLocaleString("en-IN")} characters</p>
                        {source.warnings.map((warning) => (
                          <p key={warning} className="mt-1 text-xs leading-5 text-ochre">{warning}</p>
                        ))}
                      </div>
                      <button type="button" onClick={() => handlers.onRemoveSource(source.clientRef)} className="btn btn-sm btn-ghost">Remove</button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => handlers.onSubmit("CSV_IMPORT")}
                  disabled={pending || !online}
                  className="btn btn-ghost justify-self-start"
                >
                  {pending && draft.mode === "CSV_IMPORT" ? "Saving evidence…" : `Save ${draft.csvSources.length} file${draft.csvSources.length === 1 ? "" : "s"} as evidence`}
                </button>
              </>
            ) : null}
          </div>
        </details>
      </section>

      {failure ? <FailureBlock failure={failure} /> : null}

      {submission ? <SubmissionReceipt submission={submission} /> : null}
    </div>
  );
}

function SubmissionReceipt({ submission }: { submission: EvidenceSubmissionDto }) {
  return (
    <section aria-labelledby="recovery-submission-heading" className="panel p-4 sm:p-5">
      <h3 id="recovery-submission-heading" className="folio" data-folio="09">What the workspace did with it</h3>
      <p className="mt-3 font-data text-xs text-(--muted)">
        {sourceLabels[submission.type]} · submitted {formatMoment(submission.ingestedAt)} · {submission.acceptedEvidenceCount} accepted
      </p>
      <ul className="mt-4 grid gap-2">
        {submission.results.map((result) => (
          <li key={result.clientRef} className="inset p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-data text-xs text-(--muted)">{result.clientRef}</span>
              <span className={result.status === "ACCEPTED" ? "pill pill-ready" : "pill pill-blocked"}>
                {result.status === "ACCEPTED" ? "Accepted" : errorCopy[result.code].title}
              </span>
            </div>
            {result.status === "REJECTED" ? (
              <>
                <p className="mt-2 text-sm leading-6 text-(--ink-soft)">{errorCopy[result.code].detail}</p>
                <p className="mt-1 text-sm leading-6 text-(--muted)">Reported message: {result.message}</p>
              </>
            ) : (
              <p className="mt-2 text-sm leading-6 text-(--muted)">Stored as immutable evidence. You can inspect it from the commitment it supports.</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
