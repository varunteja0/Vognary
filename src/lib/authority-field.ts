import {
  syntheticControlBrief,
  syntheticDemoCitedEvidence,
  syntheticDemoObservedEvidence,
  syntheticDemoPolicy,
  type SyntheticDemoBranch,
} from "./synthetic-control-demo";

/**
 * The Authority Field — geometry only.
 *
 * One vertical value axis. Every consequential number in the loop is a position
 * on it: what was already proven, what is being asked for, what policy will not
 * pass, where a named human froze the boundary, and where the later receipt
 * actually landed.
 *
 * This module derives *position*, never money. Amounts pass through untouched as
 * exact minor-unit strings and are rendered by the canonical money component.
 * Positions are computed in BigInt and only converted to a number at the last
 * step, so ordering on the axis can never disagree with ordering of the money.
 */

export type AuthorityFieldStage =
  | "EVIDENCE"
  | "PROPOSED"
  | "POLICY"
  | "AUTHORIZED"
  | "OBSERVED"
  | "REFUSED";

/** The ordered sequence a reader walks. REFUSED is terminal and replaces OBSERVED. */
export const authorityFieldSequence: readonly AuthorityFieldStage[] = [
  "EVIDENCE",
  "PROPOSED",
  "POLICY",
  "AUTHORIZED",
  "OBSERVED",
];

export type AuthorityFieldRole = "cited" | "proposed" | "limit" | "boundary" | "observed";

export type AuthorityFieldMark = {
  id: string;
  role: AuthorityFieldRole;
  minor: string;
  currency: string;
  /** Short name of the object, e.g. "July invoice". */
  label: string;
  /** One line of provenance or meaning. Never a claim the record cannot support. */
  detail: string;
  /** Percent of the axis height, 0 at the floor. */
  position: number;
};

/**
 * The axis ceiling is the policy's own per-charge limit plus a fifth, so the
 * limit sits inside the frame with headroom above it. It is a presentation
 * ceiling, never a financial fact.
 */
function axisCeilingMinor(perChargeLimitMinor: string): string {
  return ((BigInt(perChargeLimitMinor) * BigInt(6)) / BigInt(5)).toString();
}

/** Percent position, two decimals, computed without ever creating a float amount. */
export function axisPosition(minor: string, ceilingMinor: string): number {
  const zero = BigInt(0);
  const ceiling = BigInt(ceilingMinor);
  if (ceiling <= zero) return 0;
  const raw = BigInt(minor);
  const clamped = raw < zero ? zero : raw > ceiling ? ceiling : raw;
  return Number((clamped * BigInt(10000)) / ceiling) / 100;
}

export type AuthorityFieldModel = {
  currency: string;
  ceilingMinor: string;
  policyVersion: number;
  /** Proven history. Present from the first stage; never removed. */
  cited: AuthorityFieldMark[];
  /** The unstable region: floor is the highest proven charge, roof is the request. */
  band: { floor: number; roof: number; requestMinor: string };
  /** What policy will not pass. Visible from POLICY onward, and never decisive. */
  limit: AuthorityFieldMark;
  /** The frozen boundary. Null on a refusal — a decline creates no boundary. */
  boundary: AuthorityFieldMark | null;
  /** The later receipt. Null until it arrives, and null forever on a refusal. */
  observed: AuthorityFieldMark | null;
  /** Set only on a refusal, so no surface can invent a comparison. */
  refusal: { reason: string; decidedAt: string } | null;
  /** Which way the receipt landed relative to the boundary. Null when there is no boundary. */
  verdict: "MATCHED" | "WITHIN_CAP" | "OVER_CAP" | "CURRENCY_MISMATCH" | "CANNOT_EVALUATE" | null;
};

export function authorityFieldModel(
  stage: AuthorityFieldStage,
  branch: SyntheticDemoBranch,
): AuthorityFieldModel {
  const decided = stage === "AUTHORIZED" || stage === "OBSERVED" || stage === "REFUSED";
  const brief = syntheticControlBrief(
    stage === "OBSERVED" ? "RECONCILED" : decided ? "DECIDED" : "PROPOSED",
    branch,
  );
  const entry = brief.proposals[0];
  const currency = entry.proposal.currency;
  const limitMinor = syntheticDemoPolicy.currencyLimits[0].maxPerChargeMinor;
  const ceilingMinor = axisCeilingMinor(limitMinor);
  const at = (minor: string) => axisPosition(minor, ceilingMinor);

  const cited: AuthorityFieldMark[] = syntheticDemoCitedEvidence.map((item) => ({
    id: item.id,
    role: "cited",
    minor: item.minor,
    currency: item.currency,
    label: `${item.period} charge`,
    detail: item.source,
    position: at(item.minor),
  }));

  const highestCited = cited.reduce(
    (top, mark) => (BigInt(mark.minor) > BigInt(top.minor) ? mark : top),
    cited[0],
  );

  const limit: AuthorityFieldMark = {
    id: "policy-per-charge",
    role: "limit",
    minor: limitMinor,
    currency,
    label: "Policy ceiling, per charge",
    detail: `Version ${syntheticDemoPolicy.policyVersion}. Policy marks a proposal; it never decides one.`,
    position: at(limitMinor),
  };

  const decision = entry.decision;
  const refused = decision?.action === "DECLINE";

  const boundary: AuthorityFieldMark | null = decision && decision.approvedCapMinor
    ? {
      id: decision.id,
      role: "boundary",
      minor: decision.approvedCapMinor,
      currency: decision.currency,
      label: "Authorized boundary",
      detail: `${decision.decidedByDisplayName ?? "A named authorizer"} froze this. It does not move again.`,
      position: at(decision.approvedCapMinor),
    }
    : null;

  const reconciliation = entry.reconciliations[0] ?? null;
  const observed: AuthorityFieldMark | null =
    stage === "OBSERVED" && reconciliation && reconciliation.observedAmountMinor
      ? {
        id: reconciliation.id,
        role: "observed",
        minor: reconciliation.observedAmountMinor,
        currency: reconciliation.observedCurrency ?? currency,
        label: "Observed charge",
        detail: syntheticDemoObservedEvidence.source,
        position: at(reconciliation.observedAmountMinor),
      }
      : null;

  return {
    currency,
    ceilingMinor,
    policyVersion: syntheticDemoPolicy.policyVersion,
    cited,
    band: {
      floor: highestCited.position,
      roof: at(entry.proposal.amountMinor),
      requestMinor: entry.proposal.amountMinor,
    },
    limit,
    boundary,
    observed,
    refusal: refused && decision
      ? { reason: decision.overrideReason ?? "No reason recorded.", decidedAt: decision.decidedAt }
      : null,
    verdict: reconciliation?.verdict ?? null,
  };
}
