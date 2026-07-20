// The spend cap. AI is a cost center that must never surprise-bill: when the
// month's spend would cross the configured cap, the AI layer degrades to
// deterministic-only rather than keep charging. The persistent monthly counter
// is backed by the shared rate-limit store when this is wired to routes; this
// module is the pure, testable decision that gates every call.

export type BudgetSnapshot = {
  /** Spend so far this month, in the same unit as `cap` (e.g. paise). */
  spent: number;
  /** The monthly cap. A cap of 0 means AI is off. */
  cap: number;
};

export type BudgetDecision = {
  allowed: boolean;
  reason: "ok" | "cap-exceeded" | "cap-would-exceed";
  remaining: number;
};

export function evaluateBudget(snapshot: BudgetSnapshot, estimatedCost: number): BudgetDecision {
  const remaining = Math.max(0, snapshot.cap - snapshot.spent);
  if (snapshot.spent >= snapshot.cap) {
    return { allowed: false, reason: "cap-exceeded", remaining };
  }
  if (snapshot.spent + Math.max(0, estimatedCost) > snapshot.cap) {
    return { allowed: false, reason: "cap-would-exceed", remaining };
  }
  return { allowed: true, reason: "ok", remaining };
}
