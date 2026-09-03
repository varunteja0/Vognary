import { MoneyValue } from "@/components/ui/money-value";
import {
  syntheticControlBrief,
  syntheticDemoBranchLabels,
  syntheticDemoCitedEvidence,
  syntheticDemoExistingCommitment,
  syntheticDemoObservedEvidence,
  syntheticDemoPolicy,
  SYNTHETIC_DEMO_LABEL,
  type SyntheticDemoBranch,
} from "@/lib/synthetic-control-demo";

/**
 * The record sheet.
 *
 * Commitment Control's own artifacts are the product's visual material: a
 * request, the invoices that make its history a fact, the rule that annotates
 * it, the cap a person froze, and the invoice that arrived afterwards. So the
 * public surfaces do not illustrate the product — they render it, from the same
 * fixture and through the same money renderer as the workspace.
 *
 * Two rules hold these components together:
 *   - no amount, verdict, policy version or status is written here; every one
 *     is read off the brief the engines produced;
 *   - provenance travels on the same line as the figure, never by colour alone.
 */

const PROPOSED = syntheticControlBrief("PROPOSED").proposals[0];

function reasonText(code: string): string {
  return code.toLowerCase().replace(/_/g, " ");
}

function statusText(status: string): string {
  return status.toLowerCase().replace(/_/g, " ");
}

/** Header used by every sheet: who is asking, and of whom. */
function SheetHead({ left, right }: { left: string; right: string }) {
  return (
    <p className="sheet-head">
      <span>{left}</span>
      <span>{right}</span>
    </p>
  );
}

export function SyntheticStamp({ className = "" }: { className?: string }) {
  return (
    <p className={`sheet-stamp ${className}`.trim()} data-testid="synthetic-demonstration-label">
      {SYNTHETIC_DEMO_LABEL}
    </p>
  );
}

/**
 * The request as it stands before anyone has decided: an assumption, the cited
 * history around it, the limit it crosses, and the fact that only a person can
 * settle it.
 */
export function RequestSheet({ headingId }: { headingId?: string }) {
  const { proposal, evaluation } = PROPOSED;
  const limit = evaluation?.currencyResults.find((entry) => entry.currency === proposal.currency);
  // Read off the policy, never typed here: a presentation component that carries
  // its own copy of a limit is a second source of truth waiting to drift.
  const perCharge = syntheticDemoPolicy.currencyLimits
    .find((entry) => entry.currency === proposal.currency)?.maxPerChargeMinor ?? null;

  return (
    <article className="sheet" aria-labelledby={headingId}>
      <SheetHead left={proposal.merchant} right={proposal.submittedByDisplayName ?? "—"} />

      <MoneyValue
        minor={proposal.amountMinor}
        currency={proposal.currency}
        provenance={{ kind: "assumed" }}
        size="lead"
        layout="stacked"
        className="sheet-figure"
      />
      <p className="sheet-purpose">{proposal.purpose}</p>

      <dl className="sheet-rows">
        <div className="sheet-row">
          <dt>Already committed</dt>
          <dd>
            <MoneyValue
              minor={syntheticDemoExistingCommitment.minor}
              currency={syntheticDemoExistingCommitment.currency}
              provenance={{ kind: "cited", source: `${syntheticDemoCitedEvidence.length} invoices` }}
              size="data"
            />
          </dd>
        </div>
        <div className="sheet-row">
          <dt>Your per-charge limit</dt>
          <dd>
            <MoneyValue
              minor={perCharge}
              currency={proposal.currency}
              provenance={perCharge
                ? { kind: "frozen", label: `Policy v${evaluation?.policyVersion}` }
                : { kind: "unknown", reason: "No policy recorded" }}
              size="data"
            />
          </dd>
        </div>
        {limit ? (
          <div className="sheet-row">
            <dt>Thirteen-week headroom left</dt>
            <dd>
              <MoneyValue
                minor={limit.thirteenWeekHeadroomMinor}
                currency={proposal.currency}
                provenance={{ kind: "projected" }}
                size="data"
              />
            </dd>
          </div>
        ) : null}
      </dl>

      {evaluation ? (
        <p className="sheet-verdict sheet-verdict-breach">
          <span className="sheet-verdict-mark" aria-hidden="true" />
          <span>
            <b>{statusText(evaluation.status)}</b>
            {" — "}
            {evaluation.reasonCodes.map(reasonText).join(", ")}. A rule cannot approve this. A person has to.
          </span>
        </p>
      ) : null}

      <SyntheticStamp />
    </article>
  );
}

/**
 * The authorization-to-outcome sheet. The request stays where it is, the cap
 * appears beneath it as a separate exact string, and the later invoice is
 * appended below both. No number ever morphs into another number.
 */
export function FreezeSheet({
  branch = "APPROVE_WITH_CAP",
  headingId,
  animate = true,
}: {
  branch?: SyntheticDemoBranch;
  headingId?: string;
  animate?: boolean;
}) {
  const entry = syntheticControlBrief("RECONCILED", branch).proposals[0];
  const { proposal, decision } = entry;
  const outcome = entry.reconciliations[0] ?? null;

  return (
    <article className="sheet" aria-labelledby={headingId} data-animate={animate ? "true" : undefined}>
      <SheetHead left="Requested" right={syntheticDemoBranchLabels[branch]} />

      <MoneyValue
        minor={proposal.amountMinor}
        currency={proposal.currency}
        provenance={{ kind: "assumed" }}
        size="record"
        layout="stacked"
        className="sheet-figure sheet-figure-quiet"
      />

      {decision ? (
        <>
          {/* The signature change: a line resolving under the request. It draws
              itself in; it never travels a number from one value to another. */}
          <div className="sheet-cap-rule" aria-hidden="true" />
          {decision.approvedCapMinor ? (
            <MoneyValue
              minor={decision.approvedCapMinor}
              currency={decision.currency}
              provenance={{ kind: "frozen", label: `Frozen by ${decision.decidedByDisplayName}` }}
              size="lead"
              layout="stacked"
              className="sheet-figure sheet-figure-frozen"
            />
          ) : (
            <p className="sheet-refusal">
              <b>Declined by {decision.decidedByDisplayName}.</b> No cap exists, so a later invoice
              has nothing to be measured against. The refusal is the whole record.
            </p>
          )}
          {decision.overrideReason ? (
            <p className="sheet-reason">“{decision.overrideReason}”</p>
          ) : null}
        </>
      ) : null}

      {outcome ? (
        <div className="sheet-observed">
          <dl className="sheet-rows">
            <div className="sheet-row">
              <dt>{syntheticDemoObservedEvidence.period} invoice</dt>
              <dd>
                <MoneyValue
                  minor={outcome.observedAmountMinor}
                  currency={outcome.observedCurrency ?? proposal.currency}
                  provenance={{ kind: "observed" }}
                  size="data"
                />
              </dd>
            </div>
          </dl>
          <p
            className={`sheet-verdict ${outcome.verdict === "OVER_CAP" ? "sheet-verdict-breach" : "sheet-verdict-ok"}`}
          >
            <span className="sheet-verdict-mark" aria-hidden="true" />
            <span>
              <b>{statusText(outcome.verdict)}</b> against the cap that was frozen. The cap did not move.
            </span>
          </p>
        </div>
      ) : null}

      <SyntheticStamp />
    </article>
  );
}
