"use client";

import { useState, type DragEvent, type ReactNode } from "react";

const acceptedExtensions = ".pdf,.txt,.csv,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.heic,.heif,image/*";

export function BillDropzone({
  disabled,
  preparing,
  onFilesChosen,
  children,
}: {
  disabled: boolean;
  preparing: boolean;
  onFilesChosen: (files: readonly File[]) => void;
  children?: ReactNode;
}) {
  const [over, setOver] = useState(false);

  function takeFiles(fileList: FileList | null) {
    const files = [...(fileList ?? [])];
    if (files.length) onFilesChosen(files);
  }

  function onDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (!disabled) setOver(true);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setOver(false);
    if (!disabled) takeFiles(event.dataTransfer.files);
  }

  return (
    <label
      htmlFor="recovery-file-input"
      onDragOver={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`relative grid min-h-40 cursor-pointer place-items-center rounded-(--radius) border border-dashed px-(--space-4) py-(--space-6) text-center ${
        over ? "border-(--gold) bg-(--card-3)" : "border-line bg-(--card-2)"
      } ${disabled ? "pointer-events-none opacity-60" : ""}`}
    >
      <input
        id="recovery-file-input"
        type="file"
        multiple
        accept={acceptedExtensions}
        className="file-target"
        disabled={disabled}
        aria-label="Upload invoices or receipts"
        onChange={(event) => {
          takeFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <span className="font-display text-lg font-semibold text-(--ink)">Drop bills or receipts here</span>
      <span className="mt-2 max-w-md text-sm leading-6 text-(--muted)">
        {preparing
          ? "Reading the bill…"
          : "PDF, CSV, spreadsheet, or bill photo. Vognary extracts the merchant, amount, and date it can verify; you confirm the line."}
      </span>
      {children}
    </label>
  );
}
