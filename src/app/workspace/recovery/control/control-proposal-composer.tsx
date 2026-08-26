"use client";

import { commitmentControlStepLabel } from "@/lib/commitment-control-loop";
import type { CommitmentSummaryDto } from "@/lib/recovery/contracts";
import { formatDay } from "../labels";
import {
  controlCadenceLabels,
  controlCadences,
  controlCategories,
  controlCategoryLabels,
  controlCurrencies,
} from "./control-format";
import type { ControlDraftErrors, ControlProposalDraft } from "./control-state";

// The primary working surface. One instrument rail, no wizard: what are you
// considering committing to, how much, how often, and what already exists that
// this should be read against. The command is Evaluate, never Approve.

export type ControlComposerHandlers = {
  onChange: (draft: Partial<ControlProposalDraft>) => void;
  onToggleCommitment: (commitmentId: string) => void;
  onSubmit: () => void;
};

export function ControlProposalComposer({
  draft,
  errors,
  pending,
  online,
  primary,
  blockedReason,
  eligibleCommitments,
  handlers,
}: {
  draft: ControlProposalDraft;
  errors: ControlDraftErrors;
  pending: boolean;
  online: boolean;
  primary: boolean;
  blockedReason: string | null;
  eligibleCommitments: readonly CommitmentSummaryDto[];
  handlers: ControlComposerHandlers;
}) {
  const selectedCount = draft.existingCommitmentIds.length;
  return (
    <section aria-labelledby="control-composer-heading" className="control-band control-band-open">
      <div className="control-band-head">
        <h3 id="control-composer-heading" className="control-heading">What are you considering committing to?</h3>
        <p className="control-band-count">{commitmentControlStepLabel(2)}</p>
      </div>

      <form
        id="control-proposal-form"
        noValidate
        className="control-form"
        onSubmit={(event) => {
          event.preventDefault();
          handlers.onSubmit();
        }}
      >
        <ControlField
          label="Merchant or counterparty"
          htmlFor="control-merchant"
          error={errors.merchant}
          className="control-field-merchant"
        >
          <input
            id="control-merchant"
            name="merchant"
            className="field"
            autoComplete="off"
            enterKeyHint="next"
            maxLength={240}
            value={draft.merchant}
            aria-invalid={errors.merchant ? true : undefined}
            aria-describedby={errors.merchant ? "control-merchant-error" : undefined}
            onChange={(event) => handlers.onChange({ merchant: event.target.value })}
          />
        </ControlField>

        <ControlField label="Purpose" htmlFor="control-purpose" error={errors.purpose} className="control-field-purpose">
          <input
            id="control-purpose"
            name="purpose"
            className="field"
            autoComplete="off"
            enterKeyHint="next"
            maxLength={500}
            value={draft.purpose}
            aria-invalid={errors.purpose ? true : undefined}
            aria-describedby={errors.purpose ? "control-purpose-error" : undefined}
            onChange={(event) => handlers.onChange({ purpose: event.target.value })}
          />
        </ControlField>

        <ControlField label="Category" htmlFor="control-category" className="control-field-category">
          <select
            id="control-category"
            name="category"
            className="field"
            value={draft.category}
            onChange={(event) => handlers.onChange({ category: event.target.value as ControlProposalDraft["category"] })}
          >
            {controlCategories.map((category) => (
              <option key={category} value={category}>{controlCategoryLabels[category]}</option>
            ))}
          </select>
        </ControlField>

        <ControlField label="Cadence" htmlFor="control-cadence" className="control-field-cadence">
          <select
            id="control-cadence"
            name="cadence"
            className="field"
            value={draft.cadence}
            onChange={(event) => handlers.onChange({ cadence: event.target.value as ControlProposalDraft["cadence"] })}
          >
            {controlCadences.map((cadence) => (
              <option key={cadence} value={cadence}>{controlCadenceLabels[cadence]}</option>
            ))}
          </select>
        </ControlField>

        <ControlField
          label="Amount per charge"
          htmlFor="control-amount"
          error={errors.amountText}
          className="control-field-amount"
        >
          <input
            id="control-amount"
            name="amountMinor"
            className="field font-data tnum"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="next"
            value={draft.amountText}
            aria-invalid={errors.amountText ? true : undefined}
            aria-describedby={errors.amountText ? "control-amount-error" : undefined}
            onChange={(event) => handlers.onChange({ amountText: event.target.value })}
          />
        </ControlField>

        <ControlField label="Currency" htmlFor="control-currency" className="control-field-currency">
          <select
            id="control-currency"
            name="currency"
            className="field"
            value={draft.currency}
            onChange={(event) => handlers.onChange({ currency: event.target.value })}
          >
            {controlCurrencies.map((currency) => (
              <option key={currency} value={currency}>{currency}</option>
            ))}
          </select>
        </ControlField>

        <ControlField
          label="First charge date"
          htmlFor="control-first-charge"
          error={errors.firstChargeDate}
          className="control-field-date"
        >
          <input
            id="control-first-charge"
            name="firstChargeDate"
            className="field font-data"
            type="date"
            value={draft.firstChargeDate}
            aria-invalid={errors.firstChargeDate ? true : undefined}
            aria-describedby={errors.firstChargeDate ? "control-first-charge-error" : undefined}
            onChange={(event) => handlers.onChange({ firstChargeDate: event.target.value })}
          />
        </ControlField>

        <details className="control-disclosure">
          <summary>
            Existing exposure to count with it
            <span className="control-band-count">
              {selectedCount === 0 ? "None cited" : `${selectedCount} cited`}
            </span>
          </summary>
          <div className="control-disclosure-body">
            {eligibleCommitments.length ? (
              <fieldset className="control-exposure-set">
                <legend className="sr-only">Existing commitments to cite alongside this proposal</legend>
                {eligibleCommitments.map((commitment) => (
                  <label key={commitment.id} className="control-exposure-row" htmlFor={`control-exposure-${commitment.id}`}>
                    <input
                      id={`control-exposure-${commitment.id}`}
                      className="tick"
                      type="checkbox"
                      checked={draft.existingCommitmentIds.includes(commitment.id)}
                      onChange={() => handlers.onToggleCommitment(commitment.id)}
                    />
                    <span className="control-exposure-name">{commitment.merchant}</span>
                    <span className="font-data tnum control-exposure-amount">{commitment.amount.display}</span>
                    <span>
                      {commitment.amount.currency} · {commitment.evidenceCount} receipt{commitment.evidenceCount === 1 ? "" : "s"}
                      {commitment.nextExpectedDate ? ` · next ${formatDay(commitment.nextExpectedDate)}` : ""}
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : (
              <p className="control-note">
                No saved commitment yet carries a settled cadence, a next charge date, and a receipt, so none can be cited here.
              </p>
            )}
          </div>
        </details>

        <div className="control-form-actions">
          <button
            type="submit"
            className={primary ? "btn btn-primary" : "btn btn-seal"}
            disabled={pending || blockedReason !== null || !online}
          >
            {pending ? "Evaluating…" : "Evaluate proposal"}
          </button>
          {blockedReason ? (
            <p className="control-note">{blockedReason}</p>
          ) : !online ? (
            <p className="control-note">This device is offline. Nothing will be sent until the connection returns.</p>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function ControlField({
  label,
  htmlFor,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className ? `control-field ${className}` : "control-field"}>
      <label className="field-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <p id={`${htmlFor}-error`} className="control-error">{error}</p> : null}
    </div>
  );
}
