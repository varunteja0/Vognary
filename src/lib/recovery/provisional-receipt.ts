/**
 * One observed receipt is enough to ask for a decision.
 *
 * Cadence is a hypothesis, never a proven rhythm. Monthly totals still require
 * a repeated observation. Absence is never cancellation.
 */
import { formatCalendarDate, parseIsoDateOnly } from "@/lib/date-only";
import type { ManualRecurringInput } from "@/lib/recurring-audit";

export const PROVISIONAL_SINGLE_REASON =
  "Seen once. If this repeats monthly, the next charge is a hypothesis, not a proven cadence.";

export const PROVISIONAL_RISK_TAG = "provisional single observation";

export type OrphanReceiptObservation = {
  id: string;
  merchant: string;
  normalizedMerchant: string;
  amountDecimal: string;
  amount: number;
  currency: string;
  observedDate: string;
  excerpt: string;
  sourceName: string;
  category?: string;
};

export function isProvisionalSingleReason(reason: string): boolean {
  return reason.includes(PROVISIONAL_SINGLE_REASON);
}

export function hypothesizedMonthlyNextDate(observedDate: string, today: string): string | null {
  const observed = parseIsoDateOnly(observedDate);
  if (!observed) return null;
  const next = new Date(observed.getFullYear(), observed.getMonth() + 1, observed.getDate());
  if (next.getDate() !== observed.getDate()) {
    next.setDate(0);
  }
  const todayDate = parseIsoDateOnly(today);
  if (todayDate && next <= todayDate) {
    const rolled = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, observed.getDate());
    if (rolled.getDate() !== observed.getDate()) rolled.setDate(0);
    return formatCalendarDate(rolled);
  }
  return formatCalendarDate(next);
}

export function provisionalManualFromSingleReceipt(
  observation: OrphanReceiptObservation,
  today: string,
): ManualRecurringInput | null {
  if (!observation.merchant.trim() || !observation.currency || observation.amount <= 0) return null;
  const nextExpectedDate = hypothesizedMonthlyNextDate(observation.observedDate, today);
  if (!nextExpectedDate) return null;
  return {
    id: observation.id,
    merchant: observation.merchant,
    amount: observation.amount,
    amountDecimal: observation.amountDecimal,
    currency: observation.currency,
    frequency: "monthly",
    nextExpectedDate,
    observedDate: observation.observedDate,
    category: observation.category || "Software",
    sourceName: observation.sourceName,
    evidenceDescription: observation.excerpt || observation.merchant,
    provisional: true,
  };
}

export function observationIdentityKey(observation: Pick<OrphanReceiptObservation, "normalizedMerchant" | "currency">): string {
  return `${observation.normalizedMerchant.trim().toLowerCase()}::${observation.currency}`;
}

export function provisionalManualsFromOrphans(
  observations: readonly OrphanReceiptObservation[],
  coveredKeys: ReadonlySet<string>,
  today: string,
): ManualRecurringInput[] {
  return orphanReceiptsNotCoveredByCommitments(observations, coveredKeys).flatMap((observation) => {
    const manual = provisionalManualFromSingleReceipt(observation, today);
    return manual ? [manual] : [];
  });
}

export function orphanReceiptsNotCoveredByCommitments(
  observations: readonly OrphanReceiptObservation[],
  coveredKeys: ReadonlySet<string>,
): OrphanReceiptObservation[] {
  const byKey = new Map<string, OrphanReceiptObservation[]>();
  for (const observation of observations) {
    const key = `${observation.normalizedMerchant.trim().toLowerCase()}::${observation.currency}`;
    if (coveredKeys.has(key)) continue;
    const group = byKey.get(key) ?? [];
    group.push(observation);
    byKey.set(key, group);
  }
  const orphans: OrphanReceiptObservation[] = [];
  for (const group of byKey.values()) {
    if (group.length !== 1) continue;
    const observation = group[0];
    if (observation) orphans.push(observation);
  }
  return orphans;
}
