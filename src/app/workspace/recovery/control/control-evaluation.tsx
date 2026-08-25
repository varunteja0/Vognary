"use client";

import type { ControlEvaluationDto, ControlProposalDto } from "@/lib/commitment-control/contracts";
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

// The server's evaluation, rendered without reinterpretation. Two things are
// permanently separated on screen: what the reader assumed, and what cited
// evidence already shows. Policy never decides; a person does.

export function ControlEvaluation({
  proposal,
  evaluation,
  onInspectEvidence,
}: {
  proposal: ControlProposalDto;
  evaluation: ControlEvaluationDto;
  onInspectEvidence: ((evidenceId: string, buttonId: string) => void) | null;
}) {
  return (
    <div className="control-evaluation">
      <div className="control-band-split">
        <section aria-labelledby={`assumption-${evaluation.id}`}>
          <p id={`assumption-${evaluation.id}`} className="eyebrow eyebrow-xs">User-entered assumption</p>
          <dl className="control-facts">
            <ControlFact label="Per charge" value={formatControlMoney(proposal.amountMinor, proposal.currency)} />
            <ControlFact label="Category" value={controlCategoryLabels[proposal.category]} />
            <ControlFact label="Cadence" value={controlCadenceLabels[proposal.cadence]} />
            <ControlFact label="First charge" value={formatDay(proposal.firstChargeDate)} />
            <ControlFact label="13 weeks" value={formatControlMoney(proposal.projectedThirteenWeekMinor, proposal.currency)} />
            <ControlFact label="12 months" value={formatControlMoney(proposal.projectedAnnualMinor, proposal.currency)} />
          </dl>
        </section>

        <section aria-labelledby={`cited-${evaluation.id}`}>
          <p id={`cited-${evaluation.id}`} className="eyebrow eyebrow-xs">Cited existing exposure</p>
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
                    <span className="font-data text-xs text-(--muted)">Cited receipt {index + 1}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="control-note">No existing commitment was cited, so the exposure below counts this proposal alone.</p>
          )}
        </section>
      </div>

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

      <div className="control-verdict">
        <div className="flex flex-wrap items-center gap-2">
          <span className={controlStatusToneClass[evaluation.status]}>{controlStatusLabels[evaluation.status]}</span>
          <span className="font-data text-xs text-(--muted)">Policy version {evaluation.policyVersion}</span>
        </div>
        <p className="control-note">{controlStatusMeanings[evaluation.status]}</p>
        {evaluation.reasonCodes.length ? (
          <ul className="control-reasons">
            {evaluation.reasonCodes.map((reason) => (
              <li key={reason}>{controlReasonLabels[reason]}</li>
            ))}
          </ul>
        ) : null}
        <p className="control-decision-required">Human decision required</p>
      </div>
    </div>
  );
}

export function ControlFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="control-fact">
      <dt>{label}</dt>
      <dd className="font-data tnum">{value}</dd>
    </div>
  );
}
