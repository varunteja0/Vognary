import "server-only";

import type { BudgetSnapshot } from "./budget";

/**
 * Reads the founder-configured monthly AI cap from env.
 * `AI_MONTHLY_BUDGET_INR` is rupees (whole); budget arithmetic uses paise.
 * Cap 0 / missing / invalid → AI spend blocked (deterministic-only product).
 *
 * Persistent monthly spent counters are not wired yet; spent starts at 0 so the
 * cap still bounds a single process burst. When a durable counter lands, only
 * this function's spent source should change.
 */
export function readAiBudgetFromEnv(): BudgetSnapshot {
  const raw = process.env.AI_MONTHLY_BUDGET_INR?.trim();
  if (!raw) return { spent: 0, cap: 0 };
  const inr = Number(raw);
  if (!Number.isFinite(inr) || inr <= 0) return { spent: 0, cap: 0 };
  return { spent: 0, cap: Math.round(inr * 100) };
}

export function isAiBudgetOpen(snapshot: BudgetSnapshot = readAiBudgetFromEnv()): boolean {
  return snapshot.cap > 0 && snapshot.spent < snapshot.cap;
}
