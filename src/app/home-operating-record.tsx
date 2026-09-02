import Link from "next/link";
import { MoneyValue } from "@/components/ui/money-value";
import { authorityFieldModel, type AuthorityFieldStage } from "@/lib/authority-field";
import { SYNTHETIC_DEMO_LABEL } from "@/lib/synthetic-control-demo";

/**
 * Where the field lives once it is work rather than a story.
 *
 * The same axis, laid flat. A queue row does not need a full scene — it needs
 * to answer "is this settled, and did it hold?" in one glance. Boundary is still
 * the only gold object, observed still travels in from the right, and the money
 * still renders through the canonical component, so a row here and a row in the
 * signed-in desk are the same object at two densities.
 */

const ROWS: readonly {
  stage: AuthorityFieldStage;
  branch: "APPROVE" | "APPROVE_WITH_CAP" | "DECLINE";
  merchant: string;
  state: string;
  next: string;
}[] = [
  {
    stage: "POLICY",
    branch: "APPROVE_WITH_CAP",
    merchant: "Model API vendor",
    state: "Waiting on a person",
    next: "Policy marked it. Nobody has decided.",
  },
  {
    stage: "AUTHORIZED",
    branch: "APPROVE_WITH_CAP",
    merchant: "Model API vendor",
    state: "Boundary frozen",
    next: "Authorized and waiting for the charge to arrive.",
  },
  {
    stage: "OBSERVED",
    branch: "APPROVE_WITH_CAP",
    merchant: "Model API vendor",
    state: "Landed over the boundary",
    next: "The overrun is recorded. The authorization is unchanged.",
  },
];

export function HomeOperatingRecord() {
  return (
    <section className="home-work" aria-labelledby="home-work-heading">
      <div className="home-measure">
        <p className="home-work-eyebrow">{SYNTHETIC_DEMO_LABEL}</p>
        <h2 id="home-work-heading" className="home-section-heading font-display">
          The same axis, once it becomes daily work
        </h2>
        <p className="home-work-lead">
          Inside a workspace the field lies flat and becomes a queue. One glance answers whether a
          commitment is still open, already bounded, or has come back over the line somebody drew.
        </p>

        <ul className="home-work-rows">
          {ROWS.map((row) => {
            const model = authorityFieldModel(row.stage, row.branch);
            const boundary = model.boundary;
            const observed = model.observed;
            return (
              <li key={row.stage} data-state={row.stage}>
                <div className="home-work-head">
                  <p className="home-work-merchant">{row.merchant}</p>
                  <p className="home-work-state" data-state={row.stage}>{row.state}</p>
                </div>

                <div className="home-work-axis" aria-hidden="true">
                  <span className="home-work-band" style={{ "--from": model.band.floor, "--to": model.band.roof } as React.CSSProperties} />
                  <span className="home-work-limit" style={{ "--x": model.limit.position } as React.CSSProperties} />
                  {boundary ? (
                    <span className="home-work-boundary" style={{ "--x": boundary.position } as React.CSSProperties} />
                  ) : null}
                  {observed ? (
                    <span className="home-work-observed" data-verdict={model.verdict ?? undefined} style={{ "--x": observed.position } as React.CSSProperties} />
                  ) : null}
                </div>

                <dl className="home-work-figures">
                  <div>
                    <dt>Requested</dt>
                    <dd>
                      <MoneyValue minor={model.band.requestMinor} currency={model.currency} provenance={{ kind: "assumed" }} size="data" />
                    </dd>
                  </div>
                  <div>
                    <dt>Boundary</dt>
                    <dd>
                      {boundary ? (
                        <MoneyValue minor={boundary.minor} currency={boundary.currency} provenance={{ kind: "frozen", label: "Frozen" }} size="data" />
                      ) : (
                        <MoneyValue minor={null} provenance={{ kind: "unknown", reason: "No decision yet" }} size="data" />
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Observed</dt>
                    <dd>
                      {observed ? (
                        <MoneyValue minor={observed.minor} currency={observed.currency} provenance={{ kind: "observed" }} size="data" />
                      ) : (
                        <MoneyValue minor={null} provenance={{ kind: "unknown", reason: "Not charged yet" }} size="data" />
                      )}
                    </dd>
                  </div>
                </dl>

                <p className="home-work-next">{row.next}</p>
              </li>
            );
          })}
        </ul>

        <p className="home-work-note">
          Figures above are placeholders in a fixed example, not customer activity.{" "}
          <Link href="/demo" className="home-quiet-inline">Drive the same record yourself</Link>.
        </p>
      </div>
    </section>
  );
}
