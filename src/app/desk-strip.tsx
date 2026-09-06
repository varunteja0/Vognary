import { MoneyValue } from "@/components/ui/money-value";
import { deskQueueGroups, syntheticDeskRecords, SYNTHETIC_DESK_AS_OF } from "@/lib/synthetic-control-desk";
import { SYNTHETIC_DEMO_LABEL } from "@/lib/synthetic-control-demo";

/**
 * The desk.
 *
 * Six constructed records in the states the product can hold, grouped by what
 * would have to happen rather than ranked by an invented score. Nothing here is
 * a metric: there is no total, no saving, no risk number, because the product
 * does not compute those.
 *
 * Every figure, verdict, status and age is read off the fixture the engines
 * produced. Age is derived from the record's own dates.
 *
 * These records were written, not observed. No customer has used Vognary, so
 * the synthetic banner leads the desk and stays pinned while the rows scroll:
 * a reader must not be able to reach a record without having passed it, and
 * must not be able to forget it by scrolling. Nothing on this surface may be
 * read as traffic, cadence, or a pattern of arrival.
 */

function ageFrom(createdAt: string): string {
  const days = Math.round((Date.parse(`${SYNTHETIC_DESK_AS_OF}T00:00:00.000Z`) - Date.parse(createdAt)) / 86_400_000);
  if (days <= 0) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

function label(value: string): string {
  return value.toLowerCase().replace(/_/g, " ");
}

export function DeskStrip({ headingId }: { headingId?: string }) {
  return (
    <div className="desk" aria-labelledby={headingId}>
      <p className="desk-banner" data-testid="synthetic-demonstration-label">
        <span className="desk-banner-tag">{SYNTHETIC_DEMO_LABEL}</span>
        <span>Written by Vognary, not observed from any customer.</span>
      </p>
      {deskQueueGroups.map((group) => {
        const rows = syntheticDeskRecords.filter((record) =>
          (group.states as readonly string[]).includes(record.queueState));
        if (!rows.length) return null;
        return (
          <section key={group.id} className="desk-group" aria-label={group.label}>
            <h3 className="desk-group-label">{group.label}</h3>
            <ul className="desk-list">
              {rows.map((record) => {
                const { proposal, decision, evaluation } = record.entry;
                const outcome = record.entry.reconciliations[0] ?? null;
                const shown = outcome ? outcome.observedAmountMinor : decision?.approvedCapMinor ?? proposal.amountMinor;
                const shownCurrency = outcome ? outcome.observedCurrency : proposal.currency;
                return (
                  <li key={record.key} className="desk-row" data-state={record.queueState}>
                    <span className="desk-row-name">
                      <b>{proposal.merchant.replace(/ \(placeholder\)$/, "")}</b>
                      <span className="desk-row-sub">
                        {record.nextAction} · {record.submittedByDisplayName.replace(/ \(placeholder\)$/, "")} · {ageFrom(proposal.createdAt)}
                      </span>
                    </span>
                    <span className="desk-row-figure">
                      <MoneyValue
                        minor={shown}
                        currency={shownCurrency ?? proposal.currency}
                        provenance={
                          outcome && (shown === null || shownCurrency === null)
                            ? { kind: "unknown", reason: "No comparable amount published" }
                            : outcome
                            ? { kind: "observed" }
                            : decision?.approvedCapMinor
                              ? { kind: "frozen", label: "Cap" }
                              : { kind: "assumed" }
                        }
                        size="data"
                        layout="stacked"
                      />
                      <span className={`desk-chip desk-chip-${chipTone(outcome?.verdict, record.queueState)}`}>
                        {decision?.action === "DECLINE" ? "Declined" : label(outcome?.verdict ?? evaluation?.status ?? "no policy")}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function chipTone(verdict: string | undefined, state: string): "breach" | "ok" | "quiet" | "open" {
  if (verdict === "OVER_CAP" || verdict === "CURRENCY_MISMATCH") return "breach";
  if (verdict === "MATCHED" || verdict === "WITHIN_CAP") return "ok";
  if (state === "CLOSED_REFUSED") return "quiet";
  return "open";
}
