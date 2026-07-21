import { getFrequencyMonthlyMultiplier, primaryCurrency, type RecurringItem } from "../recurring-audit";
import { parseCalendarDate, startOfLocalDay } from "../date-only";
import {
  projectCashflow,
  type CashflowProjection,
  type ProjectedDebit,
  type ProjectionOptions,
} from "./project";
import { computeRunway, type RunwayInputs, type RunwayResult } from "./runway";

// The decision layer. A what-if is a set of deltas the user proposes ("cancel
// Cursor", "buy a MacBook in August", "my salary changes"); we re-project and
// re-run the runway with those deltas applied and hand back the difference.
// The math is deterministic — the AI layer only narrates this diff, it never
// produces the numbers.

const dayInMs = 24 * 60 * 60 * 1000;

export type WhatIfDelta =
  | { type: "cancel"; itemId: string }
  | { type: "downgrade"; itemId: string; newAmount: number }
  | { type: "add-onetime"; at: string; amount: number; label: string; currency?: string }
  | { type: "adjust-income"; monthlyIncome: number };

export type ScenarioSide = {
  projection: CashflowProjection;
  runway: RunwayResult;
};

export type ScenarioDiff = {
  monthlyOutflowBefore: number;
  monthlyOutflowAfter: number;
  /** after − before. Negative means the scenario saves money. */
  monthlyOutflowChange: number;
  runwayDaysBefore: number | null;
  runwayDaysAfter: number | null;
  /**
   * A floor on days of runway gained. When either side runs past the horizon
   * the true gain is larger; the UI should read this as "at least".
   */
  runwayDaysGained: number;
  runwayMonthsGained: number;
  firstNegativeBefore: string | null;
  firstNegativeAfter: string | null;
  /** identityKeys of the commitments the scenario touched — the citation anchors. */
  affectedItemIds: string[];
};

export type ScenarioResult = ScenarioDiff & {
  before: ScenarioSide;
  after: ScenarioSide;
};

export function simulateScenario(
  items: RecurringItem[],
  deltas: WhatIfDelta[],
  runwayInputs: RunwayInputs,
  projectionOptions: ProjectionOptions = {},
): ScenarioResult {
  const baseProjection = projectCashflow(items, projectionOptions);
  const baseRunway = computeRunway(baseProjection, runwayInputs);

  const applied = applyWhatIf(items, deltas);
  const today = startOfLocalDay(projectionOptions.today ?? parseCalendarDate(baseProjection.today) ?? new Date());

  const scenarioProjection = mergeInjectedDebits(
    projectCashflow(applied.items, projectionOptions),
    applied.injectedDebits,
    today,
  );
  const scenarioRunway = computeRunway(scenarioProjection, {
    ...runwayInputs,
    monthlyIncome: applied.incomeOverride ?? runwayInputs.monthlyIncome,
  });

  const horizonDays = baseProjection.horizonDays;
  const effectiveBefore = baseRunway.runwayDays ?? horizonDays;
  const effectiveAfter = scenarioRunway.runwayDays ?? horizonDays;
  const runwayDaysGained = Math.round(effectiveAfter - effectiveBefore);

  return {
    before: { projection: baseProjection, runway: baseRunway },
    after: { projection: scenarioProjection, runway: scenarioRunway },
    monthlyOutflowBefore: baseProjection.monthlyOutflow,
    monthlyOutflowAfter: scenarioProjection.monthlyOutflow,
    monthlyOutflowChange: round2(scenarioProjection.monthlyOutflow - baseProjection.monthlyOutflow),
    runwayDaysBefore: baseRunway.runwayDays,
    runwayDaysAfter: scenarioRunway.runwayDays,
    runwayDaysGained,
    runwayMonthsGained: round1(runwayDaysGained / 30.44),
    firstNegativeBefore: baseRunway.firstNegativeDate,
    firstNegativeAfter: scenarioRunway.firstNegativeDate,
    affectedItemIds: applied.affectedItemIds,
  };
}

type AppliedWhatIf = {
  items: RecurringItem[];
  injectedDebits: Array<{ at: string; amount: number; label: string; currency: string }>;
  incomeOverride: number | null;
  affectedItemIds: string[];
};

function applyWhatIf(items: RecurringItem[], deltas: WhatIfDelta[]): AppliedWhatIf {
  const cancelled = new Set<string>();
  const downgrades = new Map<string, number>();
  const injectedDebits: AppliedWhatIf["injectedDebits"] = [];
  const affected = new Set<string>();
  let incomeOverride: number | null = null;

  for (const delta of deltas) {
    switch (delta.type) {
      case "cancel":
        cancelled.add(delta.itemId);
        affected.add(delta.itemId);
        break;
      case "downgrade":
        downgrades.set(delta.itemId, Math.max(0, delta.newAmount));
        affected.add(delta.itemId);
        break;
      case "add-onetime":
        injectedDebits.push({
          at: delta.at,
          amount: Math.max(0, delta.amount),
          label: delta.label,
          currency: delta.currency ?? primaryCurrency,
        });
        break;
      case "adjust-income":
        incomeOverride = Math.max(0, delta.monthlyIncome);
        break;
    }
  }

  const nextItems: RecurringItem[] = [];
  for (const item of items) {
    if (cancelled.has(item.identityKey)) continue;
    const newAmount = downgrades.get(item.identityKey);
    if (newAmount === undefined) {
      nextItems.push(item);
      continue;
    }
    const monthlyCost = newAmount * getFrequencyMonthlyMultiplier(item.frequency);
    nextItems.push({
      ...item,
      amountMin: newAmount,
      amountMax: newAmount,
      averageAmount: newAmount,
      monthlyCost,
      annualCost: monthlyCost * 12,
    });
  }

  return { items: nextItems, injectedDebits, incomeOverride, affectedItemIds: [...affected] };
}

// One-time purchases aren't recurring commitments, so they never touch monthly
// outflow — but they do move the balance on their date. Fold them into the
// projected debit series (inside the horizon only) so the runway sees them.
function mergeInjectedDebits(
  projection: CashflowProjection,
  injected: AppliedWhatIf["injectedDebits"],
  today: Date,
): CashflowProjection {
  if (injected.length === 0) return projection;

  const todayTime = today.getTime();
  const extras: ProjectedDebit[] = [];
  for (const entry of injected) {
    const date = parseCalendarDate(entry.at);
    if (!date) continue;
    const daysAway = Math.round((date.getTime() - todayTime) / dayInMs);
    if (daysAway < 0 || daysAway > projection.horizonDays) continue;
    extras.push({
      itemId: `onetime:${entry.label}`,
      merchant: entry.label,
      category: "One-time",
      amount: entry.amount,
      currency: entry.currency,
      date: entry.at,
      daysAway,
      frequency: "irregular",
    });
  }
  if (extras.length === 0) return projection;

  const debits = [...projection.debits, ...extras].sort(
    (left, right) => left.daysAway - right.daysAway || right.amount - left.amount,
  );

  const foreignTotals: Record<string, number> = {};
  let totalProjectedOutflow = 0;
  for (const debit of debits) {
    if (debit.currency === primaryCurrency) {
      totalProjectedOutflow += debit.amount;
    } else {
      foreignTotals[debit.currency] = (foreignTotals[debit.currency] ?? 0) + debit.amount;
    }
  }
  for (const code of Object.keys(foreignTotals)) foreignTotals[code] = round2(foreignTotals[code]);

  return {
    ...projection,
    debits,
    totalProjectedOutflow: round2(totalProjectedOutflow),
    foreignTotals,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
