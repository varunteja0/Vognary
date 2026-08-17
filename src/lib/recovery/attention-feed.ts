import type { ChangeMateriality, ChangeSignal, ChangeSignalKind } from "@/lib/recovery/change-intelligence";

/**
 * The Attention surface.
 *
 * One ordered list of decisions a person can actually act on. Everything here is
 * written in the words a customer would use: no state names, no scores, no
 * internal identifiers in anything that gets rendered as text.
 */
export const attentionUrgencies = ["NOW", "SOON", "WHENEVER"] as const;
export type AttentionUrgency = (typeof attentionUrgencies)[number];

export const attentionNextSteps = [
  "REVIEW_SUBSCRIPTION",
  "CONFIRM_SAME_SUBSCRIPTION",
  "RECONNECT_SOURCE",
  "CHECK_CANCELLATION",
  "DECIDE_BEFORE_RENEWAL",
] as const;
export type AttentionNextStep = (typeof attentionNextSteps)[number];

export type AttentionCard = {
  id: string;
  kind: ChangeSignalKind;
  commitmentId: string | null;
  sourceIds: readonly string[];
  headline: string;
  body: string;
  urgency: AttentionUrgency;
  nextStep: AttentionNextStep;
  dueDate: string | null;
  currency: string | null;
  amountMinor: bigint | null;
  deltaMinor: bigint | null;
  evidenceIds: readonly string[];
};

const materialityRank: Record<ChangeMateriality, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

const nextStepByKind: Record<ChangeSignalKind, AttentionNextStep> = {
  TRIAL_CONVERTING: "DECIDE_BEFORE_RENEWAL",
  ANNUAL_RENEWAL_APPROACHING: "DECIDE_BEFORE_RENEWAL",
  PRICE_INCREASE: "REVIEW_SUBSCRIPTION",
  NEW_RECURRING_COMMITMENT: "REVIEW_SUBSCRIPTION",
  DUPLICATE_SUSPECTED: "CONFIRM_SAME_SUBSCRIPTION",
  EXPECTED_CHARGE_MISSING: "REVIEW_SUBSCRIPTION",
  CANCELLATION_NOT_EFFECTIVE: "CHECK_CANCELLATION",
  COVERAGE_BROKEN: "RECONNECT_SOURCE",
};

const dayMs = 24 * 60 * 60 * 1_000;

function daysUntil(from: string, to: string | null) {
  if (!to) return null;
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / dayMs);
}

function urgencyFor(signal: ChangeSignal, evaluatedOn: string): AttentionUrgency {
  if (signal.materiality === "CRITICAL") return "NOW";
  const daysLeft = daysUntil(evaluatedOn, signal.dueDate);
  if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 7) return "NOW";
  if (signal.materiality === "HIGH") return "SOON";
  if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 30) return "SOON";
  return signal.materiality === "MEDIUM" ? "SOON" : "WHENEVER";
}

export function buildAttentionFeed(
  signals: readonly ChangeSignal[],
  options: { evaluatedOn: string },
): readonly AttentionCard[] {
  return signals
    .slice()
    .sort((left, right) =>
      materialityRank[left.materiality] - materialityRank[right.materiality]
      || (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31")
      || left.dedupeKey.localeCompare(right.dedupeKey))
    .map((signal) => ({
      id: signal.dedupeKey,
      kind: signal.kind,
      commitmentId: signal.commitmentId,
      sourceIds: signal.citation.kind === "SOURCE_HEALTH"
        ? signal.citation.sourceIds
        : signal.citation.kind === "COVERED_ABSENCE"
          ? signal.citation.coverageSourceIds
          : [],
      headline: signal.title,
      body: signal.detail,
      urgency: urgencyFor(signal, options.evaluatedOn),
      nextStep: nextStepByKind[signal.kind],
      dueDate: signal.dueDate,
      currency: signal.currency,
      amountMinor: signal.amountMinor,
      deltaMinor: signal.deltaMinor,
      evidenceIds: signal.citation.kind === "EVIDENCE" ? signal.citation.evidenceIds : [],
    }));
}
