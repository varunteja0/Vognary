"use client";

import type { ControlEvaluationDto, ControlProposalDto } from "@/lib/commitment-control/contracts";
import { MoneyValue, type MoneyProvenance } from "@/components/ui/money-value";
import { formatDay } from "../labels";
import {
  controlCadenceLabels,
  controlCategoryLabels,
  controlReasonLabels,
  controlStatusLabels,
  controlStatusMeanings,
  controlStatusToneClass,
  formatControlMoney,
} from "./control-format";

// The server's evaluation, rendered without reinterpretation. Three truth
// classes are held apart by label, rule colour and position: what the reader
// assumed, what cited evidence already shows, and what policy recorded. Policy
// never decides; a person does. Only the secondary exposure projection is
// disclosed on demand — the verdict, its reasons and every citation stay on
// the page.

export function ControlEvaluation({
  proposal,
  evaluation,
  onInspectEvidence,
}: {
  proposal: ControlProposalDto;
  evaluation: ControlEvaluationDto;
  onInspectEvidence: ((evidenceId: string, buttonId: string) => void) | null;
}) {
  // A one-time charge projects to itself over every horizon. Printing the same
  // exact figure three times under three labels invites the reader to hunt for
  // a difference that cannot exist, so the identity is stated once instead.
  const flatHorizon = proposal.amountMinor === proposal.projectedThirteenWeekMinor
    && proposal.amountMinor === proposal.projectedAnnualMinor;
  return (
    <div className="control-evaluation">
      <section className="control-section" aria-labelledby={`assumption-${evaluation.id}`}>
        <p id={`assumption-${evaluation.id}`} className="truth-label truth-assumption">User-entered assumption</p>
        <dl className="control-facts" data-columns={flatHorizon ? "1" : undefined}>
          <ControlFact
            label={flatHorizon ? "Per charge, 13 weeks and 12 months" : "Per charge"}
            money={{ minor: proposal.amountMinor, currency: proposal.currency, provenance: { kind: "assumed" } }}
          />
          {flatHorizon ? null : (
            <>
              <ControlFact label="13 weeks" money={{ minor: proposal.projectedThirteenWeekMinor, currency: proposal.currency, provenance: { kind: "assumed" } }} />
              <ControlFact label="12 months" money={{ minor: proposal.projectedAnnualMinor, currency: proposal.currency, provenance: { kind: "assumed" } }} />
            </>
          )}
        </dl>
        <p className="control-card-meta">
          {controlCategoryLabels[proposal.category]} · {controlCadenceLabels[proposal.cadence]} · first charge {formatDay(proposal.firstChargeDate)} · projected from {formatDay(proposal.asOfDate)}
        </p>
      </section>

      <section
        className="control-section"
        aria-labelledby={`cited-${evaluation.id}`}
        data-empty={evaluation.citedEvidenceIds.length === 0 && evaluation.citedExposureBasis !== "OBSERVATION_ONLY" ? "true" : undefined}
      >
        <p id={`cited-${evaluation.id}`} className="truth-label truth-citation">Cited existing exposure</p>
        {evaluation.citedEvidenceIds.length ? (
          <ul className="control-evidence-list">
            {evaluation.citedEvidenceIds.map((evidenceId, index) => (
              <li key={evidenceId}>
                {onInspectEvidence ? (
                  <button
                    type="button"
                    id={`control-evidence-${evaluation.id}-${index}`}
                    className="link-quiet"
                    onClick={() => onInspectEvidence(evidenceId, `control-evidence-${evaluation.id}-${index}`)}
                  >
                    Open cited receipt {index + 1}
                  </button>
                ) : (
                  <span className="control-card-meta">Cited receipt {index + 1}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="control-note">None cited, so the exposure below counts this proposal alone.</p>
        )}
        {evaluation.citedExposureBasis === "OBSERVATION_ONLY" ? (
          <p className="control-note">Cited exposure is assumption-grade: last observed amount only. It is not a 13-week or annual projection.</p>
        ) : null}
      </section>

      <section className="control-verdict" aria-labelledby={`policy-${evaluation.id}`}>
        <p id={`policy-${evaluation.id}`} className="truth-label truth-policy">Deterministic policy context</p>
        <p className="proof-head">
          <span className={controlStatusToneClass[evaluation.status]}>{controlStatusLabels[evaluation.status]}</span>
          <span className="control-card-meta">Policy version {evaluation.policyVersion}</span>
        </p>
        <p className="control-note">{controlStatusMeanings[evaluation.status]}</p>
        {evaluation.reasonCodes.length ? (
          <ul className="control-reasons">
            {evaluation.reasonCodes.map((reason) => (
              <li key={reason}>{controlReasonLabels[reason]}</li>
            ))}
          </ul>
        ) : null}
        <p className="control-decision-required">Human decision required</p>
      </section>

      <details className="control-more">
        <summary>Exposure this proposal is read against</summary>
        <div className="control-more-body">
          {evaluation.currencyResults.map((result) => (
            <table key={result.currency} className="control-table">
              <caption className="control-table-caption">Exposure in {result.currency}</caption>
              <thead>
                <tr>
                  <th scope="col">Basis</th>
                  <th scope="col">13 weeks</th>
                  <th scope="col">12 months</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Cited now</th>
                  <td>{formatControlMoney(result.existingThirteenWeekMinor, result.currency)}</td>
                  <td>{formatControlMoney(result.existingAnnualMinor, result.currency)}</td>
                </tr>
                <tr>
                  <th scope="row">Proposed</th>
                  <td>{formatControlMoney(result.proposedThirteenWeekMinor, result.currency)}</td>
                  <td>{formatControlMoney(result.proposedAnnualMinor, result.currency)}</td>
                </tr>
                <tr>
                  <th scope="row">Combined</th>
                  <td>{formatControlMoney(result.combinedThirteenWeekMinor, result.currency)}</td>
                  <td>{formatControlMoney(result.combinedAnnualMinor, result.currency)}</td>
                </tr>
                <tr>
                  <th scope="row">Policy headroom</th>
                  <td>{result.thirteenWeekHeadroomMinor === null ? "No limit set" : formatControlMoney(result.thirteenWeekHeadroomMinor, result.currency)}</td>
                  <td>{result.annualHeadroomMinor === null ? "No limit set" : formatControlMoney(result.annualHeadroomMinor, result.currency)}</td>
                </tr>
              </tbody>
            </table>
          ))}
        </div>
      </details>
    </div>
  );
}

export function ControlFact({
  label,
  value,
  money,
  engraved = false,
  observed = false,
}: {
  label: string;
  value?: string;
  /** Preferred for currency: carries provenance instead of a bare string. */
  money?: { minor: string; currency: string; provenance: MoneyProvenance };
  engraved?: boolean;
  observed?: boolean;
}) {
  return (
    <div className="control-fact" data-observed={observed ? "true" : undefined}>
      <dt>{label}</dt>
      <dd className={!money && (engraved || observed) ? "font-data tnum" : undefined}>
        {money ? (
          <MoneyValue
            minor={money.minor}
            currency={money.currency}
            provenance={money.provenance}
            size="data"
            layout="stacked"
          />
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
