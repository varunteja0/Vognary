// The assistant brief — the default answer to "what needs my attention?".
//
// This is a pure, deterministic reducer over an already-computed audit. It never
// touches the database, the network, or a model: it takes the RecurringItem[]
// the engine produced and distils three honest signals a person actually acts
// on — money they can save, charges that are about to leave their account, and
// amounts that changed under them — then picks the single headline that leads.
//
// Every rupee total is primary-currency (₹ INR) only; a foreign charge is listed
// with its own currency but never silently summed into a rupee figure. That
// currency-safety rule is the same one renewal-timeline.ts and recurring-audit.ts
// enforce, and it is load-bearing for the honesty invariant.
import { buildRenewalTimeline } from "./renewal-timeline";
import { primaryCurrency, type RecommendationType, type RecurringItem } from "./recurring-audit";
import { formatMoney } from "./format";

/** Recommendation types that free up money when acted on. */
const savingActions = new Set<RecommendationType>(["cancel", "downgrade"]);
/** A renewal this close is "imminent" enough to lead the brief. */
const renewalSoonThresholdDays = 3;

const defaults = {
  horizonDays: 45,
  maxRenewals: 5,
  maxSavings: 5,
  maxAnomalies: 5,
} as const;

export type BriefSaving = {
  itemId: string;
  merchant: string;
  category: string;
  monthlyCost: number;
  annualCost: number;
  currency: string;
  action: "cancel" | "downgrade";
  reason: string;
  confidenceScore: number;
};

export type BriefRenewal = {
  itemId: string;
  merchant: string;
  amount: number;
  currency: string;
  date: string;
  daysAway: number;
  action: RecommendationType;
  confidenceScore: number;
};

export type BriefAnomaly = {
  itemId: string;
  merchant: string;
  kind: "price-increase" | "needs-verification";
  currency: string;
  detail: string;
  previousAmount: number | null;
  latestAmount: number | null;
  changePercent: number | null;
  confidenceScore: number;
};

export type BriefHeadlineKind = "renewal-soon" | "savings" | "anomaly" | "renewals" | "all-clear";

export type BriefHeadline = {
  kind: BriefHeadlineKind;
  /** Ready-to-render sentence, ₹-formatted; the UI may also re-render from fields. */
  text: string;
};

export type AssistantBrief = {
  generatedAt: string;
  /** The currency every rupee total in this brief is denominated in. */
  currency: string;
  headline: BriefHeadline;
  /** Primary-currency (₹) monthly spend that acting on `savings` would free up. */
  monthlySavings: number;
  annualSavings: number;
  savings: BriefSaving[];
  renewals: {
    dueNext7Days: number;
    dueNext30Days: number;
    /** The nearest renewals, soonest first; foreign charges carry their own currency. */
    next: BriefRenewal[];
    foreignTotals: Record<string, number>;
  };
  anomalies: BriefAnomaly[];
  /** How many recurring commitments the brief was computed from. */
  commitmentCount: number;
};

export type BriefInput = {
  recurringItems: RecurringItem[];
  today?: Date;
  horizonDays?: number;
  maxRenewals?: number;
  maxSavings?: number;
  maxAnomalies?: number;
  /**
   * User-chosen actions override the engine recommendation per item id, so a
   * commitment the person has decided to cancel counts as savings even if the
   * engine only said "watch". Same override map renewal-timeline.ts accepts.
   */
  actions?: Record<string, RecommendationType>;
};

export function buildAssistantBrief(input: BriefInput): AssistantBrief {
  const items = input.recurringItems;
  const horizonDays = input.horizonDays ?? defaults.horizonDays;
  const effectiveAction = (item: RecurringItem): RecommendationType =>
    input.actions?.[item.identityKey] ?? item.recommendationType;

  const savings = collectSavings(items, effectiveAction, input.maxSavings ?? defaults.maxSavings);
  const monthlySavings = sumPrimaryCurrency(savings, (saving) => saving.monthlyCost);
  const annualSavings = sumPrimaryCurrency(savings, (saving) => saving.annualCost);

  const timeline = buildRenewalTimeline(items, { today: input.today, horizonDays, actions: input.actions });
  const next = timeline.events.slice(0, input.maxRenewals ?? defaults.maxRenewals).map(toBriefRenewal);

  const anomalies = collectAnomalies(items, effectiveAction, input.maxAnomalies ?? defaults.maxAnomalies);

  const headline = selectHeadline({
    monthlySavings,
    savingsCount: savings.filter((saving) => saving.currency === primaryCurrency).length,
    anomalies,
    renewals: next,
    dueNext7Days: timeline.dueNext7Days,
  });

  return {
    generatedAt: new Date().toISOString(),
    currency: primaryCurrency,
    headline,
    monthlySavings,
    annualSavings,
    savings,
    renewals: {
      dueNext7Days: timeline.dueNext7Days,
      dueNext30Days: timeline.dueNext30Days,
      next,
      foreignTotals: timeline.foreignTotals,
    },
    anomalies,
    commitmentCount: items.length,
  };
}

// Money the user can free up: cancel/downgrade recommendations, biggest first.
// Foreign-currency opportunities stay in the list (each with its own currency)
// but are excluded from the ₹ totals by sumPrimaryCurrency.
function collectSavings(items: RecurringItem[], effectiveAction: (item: RecurringItem) => RecommendationType, max: number): BriefSaving[] {
  return items
    .filter((item) => savingActions.has(effectiveAction(item)))
    .map((item) => ({
      itemId: item.identityKey,
      merchant: item.merchant,
      category: item.category,
      monthlyCost: item.monthlyCost,
      annualCost: item.annualCost,
      currency: item.currency,
      action: effectiveAction(item) as "cancel" | "downgrade",
      reason: item.recommendationReason,
      confidenceScore: item.confidenceScore,
    }))
    .sort((left, right) => byPrimaryFirst(left.currency, right.currency) || right.monthlyCost - left.monthlyCost || left.merchant.localeCompare(right.merchant))
    .slice(0, max);
}

// Amounts that changed under the user. Both signals rest on the engine's own
// proof: priceChange compares actually-charged amounts, and an "investigate"
// flag is the engine saying it needs one more source before it will trust the
// cadence. Neither is invented here.
function collectAnomalies(items: RecurringItem[], effectiveAction: (item: RecurringItem) => RecommendationType, max: number): BriefAnomaly[] {
  const anomalies: BriefAnomaly[] = [];
  for (const item of items) {
    if (item.priceChange && item.priceChange.direction === "increase") {
      anomalies.push({
        itemId: item.identityKey,
        merchant: item.merchant,
        kind: "price-increase",
        currency: item.currency,
        detail: `${item.merchant} rose from ${formatMoney(item.priceChange.previousAmount, item.currency)} to ${formatMoney(item.priceChange.latestAmount, item.currency)} (+${item.priceChange.changePercent}%).`,
        previousAmount: item.priceChange.previousAmount,
        latestAmount: item.priceChange.latestAmount,
        changePercent: item.priceChange.changePercent,
        confidenceScore: item.confidenceScore,
      });
    } else if (effectiveAction(item) === "investigate") {
      anomalies.push({
        itemId: item.identityKey,
        merchant: item.merchant,
        kind: "needs-verification",
        currency: item.currency,
        detail: item.recommendationReason,
        previousAmount: null,
        latestAmount: null,
        changePercent: null,
        confidenceScore: item.confidenceScore,
      });
    }
  }
  // Price moves lead (largest jump first), then items awaiting verification.
  return anomalies
    .sort((left, right) => anomalyRank(left) - anomalyRank(right) || (right.changePercent ?? 0) - (left.changePercent ?? 0) || left.merchant.localeCompare(right.merchant))
    .slice(0, max);
}

function anomalyRank(anomaly: BriefAnomaly): number {
  return anomaly.kind === "price-increase" ? 0 : 1;
}

// The single line that leads the brief. This priority order is the product
// decision: what does a person most need to see first? The default puts an
// about-to-hit, money-saving renewal above everything (it is time-critical and
// actionable), then money on the table, then things that changed, then the
// week's renewals, then an honest "all clear".
export function selectHeadline(signals: {
  monthlySavings: number;
  savingsCount: number;
  anomalies: BriefAnomaly[];
  renewals: BriefRenewal[];
  dueNext7Days: number;
}): BriefHeadline {
  const imminent = signals.renewals.find(
    (renewal) => renewal.daysAway <= renewalSoonThresholdDays && savingActions.has(renewal.action),
  );
  if (imminent) {
    const verb = imminent.action === "cancel" ? "cancel" : "downgrade";
    return {
      kind: "renewal-soon",
      text: `${imminent.merchant} renews ${renewIn(imminent.daysAway)} — you flagged it to ${verb}. Act before ${formatMoney(imminent.amount, imminent.currency)} leaves your account.`,
    };
  }

  if (signals.monthlySavings > 0) {
    return {
      kind: "savings",
      text: `You can save ${formatMoney(signals.monthlySavings, primaryCurrency)}/mo across ${countLabel(signals.savingsCount, "subscription")}.`,
    };
  }

  if (signals.anomalies.length > 0) {
    const priceMoves = signals.anomalies.filter((anomaly) => anomaly.kind === "price-increase").length;
    if (priceMoves > 0) {
      return { kind: "anomaly", text: `${countLabel(priceMoves, "price")} went up since last cycle — worth a look.` };
    }
    return { kind: "anomaly", text: `${countLabel(signals.anomalies.length, "charge")} need a second source before we trust the cadence.` };
  }

  if (signals.dueNext7Days > 0) {
    return { kind: "renewals", text: `${formatMoney(signals.dueNext7Days, primaryCurrency)} renews in the next 7 days.` };
  }

  // Nothing urgent — but if charges are on the horizon, name the next one rather
  // than claim "nothing", which would contradict the renewals the brief lists.
  const nextUp = signals.renewals[0];
  if (nextUp) {
    return {
      kind: "renewals",
      text: `You're on track — ${nextUp.merchant} renews next, ${renewIn(nextUp.daysAway)} (${formatMoney(nextUp.amount, nextUp.currency)}).`,
    };
  }

  return { kind: "all-clear", text: "Nothing needs your attention right now." };
}

function toBriefRenewal(event: ReturnType<typeof buildRenewalTimeline>["events"][number]): BriefRenewal {
  return {
    itemId: event.itemId,
    merchant: event.merchant,
    amount: event.amount,
    currency: event.currency,
    date: event.date,
    daysAway: event.daysAway,
    action: event.action,
    confidenceScore: event.confidenceScore,
  };
}

// Sums cover primary-currency rows only; a USD amount must never add into a
// rupee total. Mirrors renewal-timeline.ts's sumAmounts.
function sumPrimaryCurrency<T extends { currency: string }>(rows: T[], value: (row: T) => number): number {
  return rows.filter((row) => row.currency === primaryCurrency).reduce((total, row) => total + value(row), 0);
}

function byPrimaryFirst(left: string, right: string): number {
  if (left === right) return 0;
  if (left === primaryCurrency) return -1;
  if (right === primaryCurrency) return 1;
  return left.localeCompare(right);
}

function renewIn(daysAway: number): string {
  if (daysAway <= 0) return "today";
  if (daysAway === 1) return "tomorrow";
  return `in ${daysAway} days`;
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
