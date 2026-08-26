"use client";

import { RecoveryDialog } from "../recovery-dialog";
import { FailureBlock } from "../recovery-states";
import type { RecoveryFailure } from "../state";
import {
  controlCategories,
  controlCategoryLabels,
  controlCurrencies,
  controlPostureLabels,
  controlPostures,
} from "./control-format";
import type { ControlPolicyDraft, ControlPolicyDraftLimit } from "./control-state";

// Policy is versioned and immutable. This dialog never edits a published
// version: it composes the next one, and asks for an explicit review first.

export function ControlPolicyDialog({
  draft,
  currentVersion,
  pending,
  online,
  failure,
  returnFocusId,
  onChange,
  onClose,
  onSubmit,
}: {
  draft: ControlPolicyDraft;
  currentVersion: number | null;
  pending: boolean;
  online: boolean;
  failure: RecoveryFailure | null;
  returnFocusId: string | null;
  onChange: (draft: Partial<ControlPolicyDraft>) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const postureFor = (category: (typeof controlCategories)[number]) =>
    draft.categoryRules.find((rule) => rule.category === category)?.posture ?? "";

  const setPosture = (category: (typeof controlCategories)[number], value: string) => {
    const withoutCategory = draft.categoryRules.filter((rule) => rule.category !== category);
    onChange({
      categoryRules: value === ""
        ? withoutCategory
        : [...withoutCategory, { category, posture: value as (typeof controlPostures)[number] }],
      error: null,
    });
  };

  const setLimit = (index: number, patch: Partial<ControlPolicyDraftLimit>) => {
    onChange({
      currencyLimits: draft.currencyLimits.map((limit, position) => (position === index ? { ...limit, ...patch } : limit)),
      error: null,
    });
  };

  const availableCurrencies = controlCurrencies.filter(
    (currency) => !draft.currencyLimits.some((limit) => limit.currency === currency),
  );

  return (
    <RecoveryDialog
      title={draft.step === "EDIT" ? "Compose the next policy version" : "Review before recording"}
      description={
        currentVersion === null
          ? "This workspace has no policy yet. Recording creates version 1."
          : `Version ${currentVersion} is published and stays unchanged. Recording creates version ${currentVersion + 1}.`
      }
      onClose={onClose}
      returnFocusId={returnFocusId}
      footer={
        <>
          {draft.error ? <p role="alert" className="mr-auto text-sm text-ember">{draft.error}</p> : null}
          {draft.step === "REVIEW" ? (
            <button type="button" className="btn btn-ghost" onClick={() => onChange({ step: "EDIT" })}>Back to editing</button>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          )}
          {draft.step === "EDIT" ? (
            <button type="button" className="btn btn-primary" onClick={() => onChange({ step: "REVIEW", error: null })}>
              Review this policy
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={pending || !online} onClick={onSubmit}>
              {pending ? "Recording…" : "Record new version"}
            </button>
          )}
        </>
      }
    >
      {draft.step === "EDIT" ? (
        <div className="grid gap-5">
          <fieldset>
            <legend className="field-label">Category posture</legend>
            <div className="control-policy-grid">
              {controlCategories.map((category) => (
                <div key={category} className="control-field">
                  <label className="field-label" htmlFor={`control-posture-${category}`}>{controlCategoryLabels[category]}</label>
                  <select
                    id={`control-posture-${category}`}
                    className="field"
                    value={postureFor(category)}
                    onChange={(event) => setPosture(category, event.target.value)}
                  >
                    <option value="">Not set</option>
                    {controlPostures.map((posture) => (
                      <option key={posture} value={posture}>{controlPostureLabels[posture]}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="field-label">Limits per currency</legend>
            {draft.currencyLimits.length === 0 ? (
              <p className="control-note">No currency carries limits yet. Add one below.</p>
            ) : null}
            <div className="grid gap-4">
              {draft.currencyLimits.map((limit, index) => (
                <div key={limit.currency} className="control-policy-limit">
                  <p className="font-data text-(--ink)">{limit.currency}</p>
                  <div className="control-policy-grid">
                    <div className="control-field">
                      <label className="field-label" htmlFor={`control-limit-charge-${limit.currency}`}>Maximum per charge</label>
                      <input
                        id={`control-limit-charge-${limit.currency}`}
                        className="field font-data tnum"
                        type="text"
                        inputMode="decimal"
                        value={limit.maxPerChargeText}
                        onChange={(event) => setLimit(index, { maxPerChargeText: event.target.value })}
                      />
                    </div>
                    <div className="control-field">
                      <label className="field-label" htmlFor={`control-limit-13w-${limit.currency}`}>Maximum 13-week exposure</label>
                      <input
                        id={`control-limit-13w-${limit.currency}`}
                        className="field font-data tnum"
                        type="text"
                        inputMode="decimal"
                        value={limit.maxThirteenWeekText}
                        onChange={(event) => setLimit(index, { maxThirteenWeekText: event.target.value })}
                      />
                    </div>
                    <div className="control-field">
                      <label className="field-label" htmlFor={`control-limit-annual-${limit.currency}`}>Maximum annual exposure</label>
                      <input
                        id={`control-limit-annual-${limit.currency}`}
                        className="field font-data tnum"
                        type="text"
                        inputMode="decimal"
                        value={limit.maxAnnualText}
                        onChange={(event) => setLimit(index, { maxAnnualText: event.target.value })}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => onChange({ currencyLimits: draft.currencyLimits.filter((_, position) => position !== index), error: null })}
                  >
                    Remove {limit.currency} limits
                  </button>
                </div>
              ))}
            </div>

            {availableCurrencies.length ? (
              <div className="control-field mt-4">
                <label className="field-label" htmlFor="control-add-currency">Add a currency</label>
                <select
                  id="control-add-currency"
                  className="field"
                  value=""
                  onChange={(event) => {
                    if (!event.target.value) return;
                    onChange({
                      currencyLimits: [
                        ...draft.currencyLimits,
                        { currency: event.target.value, maxPerChargeText: "", maxThirteenWeekText: "", maxAnnualText: "" },
                      ],
                      error: null,
                    });
                  }}
                >
                  <option value="">Choose a currency…</option>
                  {availableCurrencies.map((currency) => (
                    <option key={currency} value={currency}>{currency}</option>
                  ))}
                </select>
                <p className="field-hint">A currency is only added when you choose it here.</p>
              </div>
            ) : null}
          </fieldset>
        </div>
      ) : (
        <div className="grid gap-4">
          <section>
            <p className="truth-label truth-policy">Category posture</p>
            <ul className="control-review-list mt-2">
              {controlCategories.map((category) => (
                <li key={category}>
                  <span>{controlCategoryLabels[category]}</span>
                  <span className="font-data text-(--ink)">
                    {postureFor(category) === "" ? "Not set" : controlPostureLabels[postureFor(category) as (typeof controlPostures)[number]]}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <p className="truth-label truth-frozen">Limits per currency</p>
            {draft.currencyLimits.length === 0 ? (
              <p className="control-note mt-2">No currency limits. Every proposal will report a missing currency policy.</p>
            ) : (
              <ul className="control-review-list mt-2">
                {draft.currencyLimits.map((limit) => (
                  <li key={limit.currency}>
                    <span className="font-data text-(--ink)">{limit.currency}</span>
                    <span className="font-data tnum text-(--ink-soft)">
                      per charge {limit.maxPerChargeText || "—"} · 13 weeks {limit.maxThirteenWeekText || "—"} · annual {limit.maxAnnualText || "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="control-note">
            Recording appends a new version. No published version is edited, and no earlier evaluation or decision changes.
          </p>
        </div>
      )}

      {failure ? <div className="mt-4"><FailureBlock failure={failure} /></div> : null}
      {!online ? <p className="control-note mt-3">This device is offline. Nothing will be sent until the connection returns.</p> : null}
    </RecoveryDialog>
  );
}
