import { MoneyValue } from "./money-value";

/**
 * A frozen authorization cap.
 *
 * The cap is the one number in the product that cannot be rewritten by later
 * evidence, so it is rendered as a bounded object with a named authorizer and
 * a date — the things that make it defensible in an audit. Observed spend is
 * shown against it, with the delta stated rather than left to arithmetic.
 */
export function AuthorizationCap({
  capMinor,
  observedMinor = null,
  currency = "INR",
  authorizedBy,
  authorizedOn,
}: {
  capMinor: number;
  /** Later cited evidence, if any has arrived. */
  observedMinor?: number | null;
  currency?: string;
  /** The named human who froze it. A cap with no name is not an authorization. */
  authorizedBy: string;
  /** ISO date the cap was frozen. */
  authorizedOn: string;
}) {
  const over = observedMinor !== null && observedMinor > capMinor;
  const state = observedMinor === null ? "awaiting" : over ? "over" : "within";

  return (
    <div className="auth-cap" data-state={state}>
      <div className="auth-cap-head">
        <p className="eyebrow eyebrow-xs">Frozen authorization</p>
        <MoneyValue minor={capMinor} currency={currency} provenance={{ kind: "frozen" }} size="lead" />
      </div>

      <dl className="auth-cap-meta">
        <div>
          <dt>Authorized by</dt>
          <dd>{authorizedBy}</dd>
        </div>
        <div>
          <dt>Frozen on</dt>
          <dd>
            <time dateTime={authorizedOn}>{authorizedOn}</time>
          </dd>
        </div>
      </dl>

      <div className="auth-cap-observed">
        <p className="eyebrow eyebrow-xs">Observed against this cap</p>
        {observedMinor === null ? (
          <MoneyValue
            minor={null}
            provenance={{ kind: "unknown", reason: "No receipt cited yet" }}
            size="data"
          />
        ) : (
          <MoneyValue
            minor={observedMinor}
            currency={currency}
            provenance={{ kind: "observed" }}
            size="data"
          />
        )}
        {observedMinor === null ? null : (
          <p className="auth-cap-delta">
            {over ? "Over the frozen cap by " : "Under the frozen cap by "}
            <MoneyValue
              minor={Math.abs(observedMinor - capMinor)}
              currency={currency}
              provenance={{ kind: "observed" }}
              size="data"
            />
          </p>
        )}
      </div>
    </div>
  );
}
