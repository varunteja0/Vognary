"use client";

import { useState } from "react";
import {
  captureApps,
  captureEntriesToManualInputs,
  getCaptureApp,
  type CaptureAppId,
  type CaptureEntry,
} from "@/lib/guided-capture";
import type { Frequency, ManualRecurringInput } from "@/lib/recurring-audit";

type EntryDraft = {
  merchant: string;
  amount: string;
  frequency: Frequency;
  nextDate: string;
};

const emptyDraft: EntryDraft = { merchant: "", amount: "", frequency: "monthly", nextDate: "" };

const frequencyOptions: { value: Frequency; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

// Guided Proof Capture: walks the user through their own official mandate and
// subscription screens (UPI apps, app stores, bank e-mandate lists) and turns
// what they read into user-confirmed ledger evidence. This is the honest
// answer to rails that expose no consumer API yet.
export default function GuidedCapturePanel({ onAdd }: { onAdd: (items: ManualRecurringInput[]) => void }) {
  const [appId, setAppId] = useState<CaptureAppId>("gpay");
  const [drafts, setDrafts] = useState<EntryDraft[]>([{ ...emptyDraft }]);
  const app = getCaptureApp(appId);

  function selectApp(nextId: CaptureAppId) {
    setAppId(nextId);
    setDrafts([{ ...emptyDraft, frequency: getCaptureApp(nextId).defaultFrequency }]);
  }

  function updateDraft(index: number, patch: Partial<EntryDraft>) {
    setDrafts((current) => current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...patch } : draft)));
  }

  function addRow() {
    setDrafts((current) => [...current, { ...emptyDraft, frequency: app.defaultFrequency }]);
  }

  function removeRow(index: number) {
    setDrafts((current) => (current.length > 1 ? current.filter((_, draftIndex) => draftIndex !== index) : current));
  }

  const validEntries: CaptureEntry[] = drafts
    .map((draft) => ({
      merchant: draft.merchant,
      amount: Number.parseFloat(draft.amount),
      frequency: draft.frequency,
      nextDate: draft.nextDate || undefined,
    }))
    .filter((entry) => entry.merchant.trim().length > 0 && Number.isFinite(entry.amount) && entry.amount > 0);

  function addToLedger() {
    const items = captureEntriesToManualInputs(appId, validEntries);
    if (!items.length) return;
    onAdd(items);
    setDrafts([{ ...emptyDraft, frequency: app.defaultFrequency }]);
  }

  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="folio" data-folio="1.3">Guided capture</span>
          <h2 className="mt-2 font-display text-[1.22rem] font-semibold text-(--ink)">Capture mandates from the official screens</h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-(--muted)">
            UPI apps, app stores, and banks expose no consumer API for your mandates. The honest path: read your own screens once, and Vognary keeps the inventory, the calendar, and the review.
          </p>
        </div>
        <span className="pill pill-partial shrink-0">User-confirmed evidence</span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {captureApps.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => selectApp(option.id)}
            className={`btn btn-sm ${option.id === appId ? "btn-primary" : "btn-ghost"}`}
          >
            {option.name}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <ol className="inset flex flex-col gap-2 p-4">
          {app.steps.map((step, index) => (
            <li key={step} className="flex items-start gap-3 text-sm leading-6 text-(--muted)">
              <span className="step-num shrink-0">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-2">
          {drafts.map((draft, index) => (
            <div key={index} className="inset grid gap-2 p-3 sm:grid-cols-[1.4fr_0.8fr_0.9fr_0.9fr_auto]">
              <input
                value={draft.merchant}
                onChange={(event) => updateDraft(index, { merchant: event.target.value })}
                className="field"
                placeholder="Merchant on screen"
                aria-label="Merchant"
              />
              <input
                value={draft.amount}
                onChange={(event) => updateDraft(index, { amount: event.target.value })}
                className="field"
                inputMode="decimal"
                placeholder="Amount"
                aria-label="Amount"
              />
              <select
                value={draft.frequency}
                onChange={(event) => updateDraft(index, { frequency: event.target.value as Frequency })}
                className="field"
                aria-label="Frequency"
              >
                {frequencyOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <input
                value={draft.nextDate}
                onChange={(event) => updateDraft(index, { nextDate: event.target.value })}
                className="field"
                placeholder="Next date (opt.)"
                aria-label="Next expected date"
              />
              <button
                type="button"
                onClick={() => removeRow(index)}
                disabled={drafts.length <= 1}
                className="btn btn-ghost h-9 self-center px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Remove row"
              >
                ×
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={addRow} className="btn btn-ghost">Add another row</button>
            <button
              type="button"
              onClick={addToLedger}
              disabled={!validEntries.length}
              className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              Add {validEntries.length || ""} to ledger
            </button>
            <p className="font-data text-[0.66rem] text-(--muted)">Saved as “{app.sourceLabel} (user-confirmed)”.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
