/**
 * Pre-renewal decision queue.
 *
 * Deterministic: next charge + money at stake + cited reasons → Keep /
 * Review later / Plan to cancel → remember the cycle → verify with
 * expected-vs-observed. No LLM. No opaque score. Absence is never cancellation.
 */
import type { ExpectedChargeEvaluation } from "./absence";
import { newCommitmentNoticeDays } from "./change-intelligence";
import { DUPLICATE_AMBIGUITY_REASON, IDENTITY_UNCERTAIN_REASON } from "./commitment-relationship";
import type {
  Cadence,
  CommitmentPurpose,
  Decision,
  DecisionCardDto,
  DecisionCycleAction,
  DecisionHistoryItemDto,
  DecisionOutcomeDto,
  DecisionOutcomeKind,
  DecisionReasonKey,
  DecisionReviewSnooze,
  DecisionVerificationOutcome,
  MoneyDto,
  QuietNextChargeDto,
} from "./contracts";
import { annualizedStake, toMoneyDto } from "./domain";

export const decisionWindowLeadDays: Record<Cadence, number | null> = {
  WEEKLY: 3,
  BIWEEKLY: 3,
  SEMIMONTHLY: 3,
  MONTHLY: 7,
  BIMONTHLY: 7,
  QUARTERLY: 10,
  YEARLY: 14,
  IRREGULAR: null,
};

const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const dayMs = 24 * 60 * 60 * 1_000;
const materialReasonKeys = new Set<DecisionReasonKey>([
  "PRICE_INCREASE",
  "OVERLAP_NO_PURPOSE",
  "IDENTITY_UNCERTAIN",
  "AMOUNT_CONFLICT",
  "NEW_COMMITMENT",
]);

export type SavedDecisionCycle = {
  dueDate: string;
  userAction: DecisionCycleAction;
  reviewAt: string | null;
  decidedAt: string;
  verificationOutcome: DecisionVerificationOutcome | null;
  verifiedAt: string | null;
  observedAmountMinor: bigint | null;
  observedDate: string | null;
  observedCurrency: string | null;
  observedEvidenceIds: readonly string[];
};

export type DecisionCycleFact = {
  commitmentId: string;
  merchant: string;
  status: "ACTIVE" | "NOT_RECURRING";
  cadence: Cadence;
  currency: string;
  amountMinor: bigint;
  nextExpectedDate: string | null;
  firstDetectedOn: string | null;
  observationCount: number;
  purpose: CommitmentPurpose | null;
  stamp: Decision | null;
  identityUncertain: boolean;
  amountConflict: boolean;
  priceChange: { previousMinor: bigint; currentMinor: bigint } | null;
  overlapPeers: readonly { merchant: string; purpose: CommitmentPurpose | null }[];
  evidenceIds: readonly string[];
  cycles: readonly SavedDecisionCycle[];
};

export type DecisionHomeProjection = {
  decisionQueue: readonly DecisionCardDto[];
  decisionOutcomes: readonly DecisionOutcomeDto[];
  nextQuietCharge: QuietNextChargeDto | null;
};

export function stampForCycleAction(action: DecisionCycleAction): Decision {
  if (action === "KEEP") return "KEEP";
  if (action === "REVIEW_LATER") return "MONITOR";
  return "CANCEL";
}

export function cycleActionFromStamp(decision: Decision): DecisionCycleAction | null {
  if (decision === "KEEP") return "KEEP";
  if (decision === "MONITOR") return "REVIEW_LATER";
  if (decision === "CANCEL") return "PLAN_TO_CANCEL";
  return null;
}

export function resolveDecisionWrite(
  request: { decision: Decision; action?: DecisionCycleAction; reviewSnooze?: DecisionReviewSnooze },
  today: string,
  dueDate: string | null,
): { stamp: Decision; action: DecisionCycleAction | null; reviewAt: string | null } {
  if (request.action) {
    return {
      stamp: stampForCycleAction(request.action),
      action: request.action,
      reviewAt: request.action === "REVIEW_LATER"
        ? computeReviewAt(today, dueDate, request.reviewSnooze ?? "TOMORROW")
        : null,
    };
  }
  const action = cycleActionFromStamp(request.decision);
  if (!action) return { stamp: request.decision, action: null, reviewAt: null };
  return {
    stamp: request.decision,
    action,
    reviewAt: action === "REVIEW_LATER"
      ? computeReviewAt(today, dueDate, request.reviewSnooze ?? "TOMORROW")
      : null,
  };
}

export function isInDecisionWindow(today: string, dueDate: string | null, cadence: Cadence): boolean {
  if (!dueDate) return false;
  const lead = decisionWindowLeadDays[cadence];
  if (lead === null) return false;
  const daysAway = daysBetween(today, dueDate);
  return daysAway !== null && daysAway >= 0 && daysAway <= lead;
}

export function computeReviewAt(today: string, dueDate: string | null, snooze: DecisionReviewSnooze): string {
  if (!dueDate || dueDate <= today) return today;
  const tomorrow = addDays(today, 1);
  const preferred = snooze === "TOMORROW"
    ? tomorrow
    : snooze === "THREE_DAYS_BEFORE"
      ? addDays(dueDate, -3)
      : addDays(dueDate, -1);
  if (preferred > today && preferred <= dueDate) return preferred;
  if (tomorrow <= dueDate) return tomorrow;
  return dueDate;
}

export function verificationFromEvaluation(
  evaluation: ExpectedChargeEvaluation,
): { persist: false; outcome: null } | { persist: true; outcome: DecisionVerificationOutcome } {
  if (evaluation.status === "PENDING_WINDOW") return { persist: false, outcome: null };
  if (evaluation.status !== "EVALUATED") return { persist: true, outcome: "CANNOT_EVALUATE" };
  if (evaluation.outcome === "CANNOT_EVALUATE_COVERAGE_BROKEN") return { persist: true, outcome: "CANNOT_EVALUATE" };
  if (evaluation.outcome === "NOT_OBSERVED") return { persist: true, outcome: "NO_CHARGE_IN_WINDOW" };
  return { persist: true, outcome: "CHARGE_ARRIVED" };
}

export function collectReasonKeys(fact: DecisionCycleFact, today: string): DecisionReasonKey[] {
  const keys: DecisionReasonKey[] = [];
  const dueDate = fact.nextExpectedDate;
  if (isInDecisionWindow(today, dueDate, fact.cadence)) keys.push("RENEWS_SOON");
  if (fact.priceChange && fact.priceChange.currentMinor > fact.priceChange.previousMinor) keys.push("PRICE_INCREASE");
  if (fact.overlapPeers.length > 0 && !fact.purpose) keys.push("OVERLAP_NO_PURPOSE");
  if (isNewCommitment(fact, today)) keys.push("NEW_COMMITMENT");
  if (fact.identityUncertain) keys.push("IDENTITY_UNCERTAIN");
  if (fact.amountConflict) keys.push("AMOUNT_CONFLICT");
  if (!cycleForDueDate(fact, dueDate) && !silencingStamp(fact, dueDate)) keys.push("NO_PRIOR_DECISION");
  return keys;
}

export function buildDecisionHome(facts: readonly DecisionCycleFact[], today: string): DecisionHomeProjection {
  const active = facts.filter((fact) => fact.status === "ACTIVE");
  const queue = active
    .map((fact) => toQueueCard(fact, today))
    .filter((card): card is DecisionCardDto => card !== null)
    .sort(compareQueueCards);
  const decisionOutcomes = active
    .flatMap((fact) => fact.cycles.map((cycle) => toOutcome(fact, cycle)))
    .filter((outcome): outcome is DecisionOutcomeDto => outcome !== null)
    .sort(compareOutcomes);
  return {
    decisionQueue: queue,
    decisionOutcomes,
    nextQuietCharge: nextQuietCharge(active, queue, today),
  };
}

export function decisionHistoryItems(cycles: readonly SavedDecisionCycle[]): readonly DecisionHistoryItemDto[] {
  return [...cycles]
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.decidedAt.localeCompare(right.decidedAt))
    .map((cycle) => ({
      dueDate: cycle.dueDate,
      action: cycle.userAction,
      decidedAt: cycle.decidedAt,
      reviewAt: cycle.reviewAt,
      verificationHeadline: historyVerificationHeadline(cycle),
    }));
}

export function identityLooksUncertain(recommendationReason: string): boolean {
  return recommendationReason.includes(IDENTITY_UNCERTAIN_REASON) || recommendationReason.includes(DUPLICATE_AMBIGUITY_REASON);
}

export function outcomeCopyNeverClaimsCancellation(text: string): boolean {
  return !/\bcancelled\b/i.test(text) && !/\bcanceled successfully\b/i.test(text);
}

function toQueueCard(fact: DecisionCycleFact, today: string): DecisionCardDto | null {
  if (isSilenced(fact, today)) return null;
  const keys = collectReasonKeys(fact, today);
  const inWindow = isInDecisionWindow(today, fact.nextExpectedDate, fact.cadence);
  const material = keys.some((key) => materialReasonKeys.has(key));
  if (!inWindow && !material) return null;
  const shownKeys = keys.filter((key) => key !== "NO_PRIOR_DECISION" || keys.length > 1);
  if (shownKeys.length === 0) return null;
  const charge = toMoneyDto(fact.amountMinor, fact.currency);
  const stake = annualizedStake(fact.amountMinor, fact.cadence, fact.currency);
  const daysAway = fact.nextExpectedDate ? daysBetween(today, fact.nextExpectedDate) : null;
  const overlapMerchants = fact.overlapPeers.map((peer) => peer.merchant);
  return {
    commitmentId: fact.commitmentId,
    merchant: fact.merchant,
    dueDate: fact.nextExpectedDate,
    daysAway,
    charge,
    stake,
    headline: decideHeadline(fact.nextExpectedDate, daysAway),
    reasonKeys: shownKeys,
    reasons: shownKeys.map((key) => reasonSentence(key, fact, daysAway)),
    overlapMerchants,
    askPurpose: shownKeys.includes("OVERLAP_NO_PURPOSE"),
    evidenceIds: fact.evidenceIds,
  };
}

function isSilenced(fact: DecisionCycleFact, today: string): boolean {
  const dueDate = fact.nextExpectedDate;
  const cycle = cycleForDueDate(fact, dueDate);
  if (cycle?.userAction === "KEEP") return true;
  if (cycle?.userAction === "PLAN_TO_CANCEL") return true;
  if (cycle?.userAction === "REVIEW_LATER" && cycle.reviewAt && cycle.reviewAt > today) return true;
  if (!cycle && fact.stamp === "KEEP") return true;
  if (!cycle && fact.stamp === "CANCEL") return true;
  return false;
}

function silencingStamp(fact: DecisionCycleFact, dueDate: string | null): boolean {
  const cycle = cycleForDueDate(fact, dueDate);
  if (cycle) return true;
  return fact.stamp === "KEEP" || fact.stamp === "CANCEL" || fact.stamp === "MONITOR";
}

function cycleForDueDate(fact: DecisionCycleFact, dueDate: string | null): SavedDecisionCycle | null {
  if (!dueDate) return null;
  return fact.cycles.find((cycle) => cycle.dueDate === dueDate) ?? null;
}

function isNewCommitment(fact: DecisionCycleFact, today: string): boolean {
  if (fact.observationCount < 2 || !fact.firstDetectedOn) return false;
  const age = daysBetween(fact.firstDetectedOn, today);
  return age !== null && age >= 0 && age <= newCommitmentNoticeDays;
}

function toOutcome(fact: DecisionCycleFact, cycle: SavedDecisionCycle): DecisionOutcomeDto | null {
  if (cycle.userAction === "REVIEW_LATER") return null;

  const pending = cycle.verificationOutcome === null && cycle.userAction === "PLAN_TO_CANCEL";
  if (cycle.userAction === "PLAN_TO_CANCEL" && pending) {
    return {
      commitmentId: fact.commitmentId,
      merchant: fact.merchant,
      kind: "NO_CHARGE_SEEN",
      headline: "No new charge seen yet",
      detail: "The expected window is still open or has not been checked. This is not a cancellation.",
      amount: toMoneyDto(fact.amountMinor, fact.currency),
      date: cycle.dueDate,
      evidenceIds: fact.evidenceIds,
    };
  }

  if (!cycle.verificationOutcome) return null;

  if (cycle.userAction === "KEEP" && cycle.verificationOutcome === "CHARGE_ARRIVED") {
    return {
      commitmentId: fact.commitmentId,
      merchant: fact.merchant,
      kind: "CONTINUED_AS_PLANNED",
      headline: "Continued as planned",
      detail: observedDetail(cycle, "The matching charge arrived."),
      amount: observedAmount(cycle) ?? toMoneyDto(fact.amountMinor, fact.currency),
      date: cycle.observedDate ?? cycle.dueDate,
      evidenceIds: cycle.observedEvidenceIds.length ? cycle.observedEvidenceIds : fact.evidenceIds,
    };
  }

  if (cycle.userAction === "PLAN_TO_CANCEL" && cycle.verificationOutcome === "CHARGE_ARRIVED") {
    const amount = observedAmount(cycle);
    const date = cycle.observedDate ?? cycle.dueDate;
    return {
      commitmentId: fact.commitmentId,
      merchant: fact.merchant,
      kind: "CHARGE_AFTER_CANCEL_PLAN",
      headline: `${fact.merchant} charged again after you planned to cancel.`,
      detail: amount && date
        ? `${amount.display} arrived on ${date}. Vognary did not cancel this.`
        : "Another matching charge arrived. Vognary did not cancel this.",
      amount,
      date,
      evidenceIds: cycle.observedEvidenceIds.length ? cycle.observedEvidenceIds : fact.evidenceIds,
    };
  }

  if (cycle.userAction === "PLAN_TO_CANCEL" && cycle.verificationOutcome === "NO_CHARGE_IN_WINDOW") {
    return {
      commitmentId: fact.commitmentId,
      merchant: fact.merchant,
      kind: "NO_CHARGE_SEEN",
      headline: "We didn't see another charge in the expected window.",
      detail: "Missing evidence is not proof of cancellation.",
      amount: toMoneyDto(fact.amountMinor, fact.currency),
      date: cycle.dueDate,
      evidenceIds: fact.evidenceIds,
    };
  }

  if (cycle.verificationOutcome === "CANNOT_EVALUATE") {
    return {
      commitmentId: fact.commitmentId,
      merchant: fact.merchant,
      kind: "CANNOT_VERIFY",
      headline: "Cannot verify yet",
      detail: "The sources that would have shown this charge were not watching reliably, or there is not enough history.",
      amount: toMoneyDto(fact.amountMinor, fact.currency),
      date: cycle.dueDate,
      evidenceIds: fact.evidenceIds,
    };
  }

  return null;
}

function nextQuietCharge(
  facts: readonly DecisionCycleFact[],
  queue: readonly DecisionCardDto[],
  today: string,
): QuietNextChargeDto | null {
  const queued = new Set(queue.map((card) => card.commitmentId));
  const upcoming = facts
    .filter((fact) => fact.nextExpectedDate && !queued.has(fact.commitmentId))
    .map((fact) => ({ fact, daysAway: daysBetween(today, fact.nextExpectedDate!) }))
    .filter((entry): entry is { fact: DecisionCycleFact; daysAway: number } => entry.daysAway !== null && entry.daysAway >= 0)
    .sort((left, right) => left.daysAway - right.daysAway || left.fact.merchant.localeCompare(right.fact.merchant));
  const next = upcoming[0];
  if (!next?.fact.nextExpectedDate) return null;
  return {
    commitmentId: next.fact.commitmentId,
    merchant: next.fact.merchant,
    amount: toMoneyDto(next.fact.amountMinor, next.fact.currency),
    date: next.fact.nextExpectedDate,
  };
}

function compareQueueCards(left: DecisionCardDto, right: DecisionCardDto): number {
  const rank = queueRank(left) - queueRank(right);
  if (rank !== 0) return rank;
  const due = (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31");
  if (due !== 0) return due;
  if (left.charge.currency === right.charge.currency) {
    const stake = BigInt(right.stake?.minor ?? right.charge.minor) - BigInt(left.stake?.minor ?? left.charge.minor);
    if (stake < BigInt(0)) return -1;
    if (stake > BigInt(0)) return 1;
  }
  return left.merchant.localeCompare(right.merchant);
}

function queueRank(card: DecisionCardDto): number {
  const inWindow = card.reasonKeys.includes("RENEWS_SOON");
  if (card.reasonKeys.includes("PRICE_INCREASE") && inWindow) return 0;
  if (card.reasonKeys.includes("IDENTITY_UNCERTAIN") || card.reasonKeys.includes("AMOUNT_CONFLICT")) return 1;
  if (inWindow) return 2;
  if (card.reasonKeys.includes("OVERLAP_NO_PURPOSE")) return 3;
  if (card.reasonKeys.includes("NEW_COMMITMENT")) return 4;
  return 5;
}

function compareOutcomes(left: DecisionOutcomeDto, right: DecisionOutcomeDto): number {
  return outcomeRank(left.kind) - outcomeRank(right.kind) || left.merchant.localeCompare(right.merchant);
}

function outcomeRank(kind: DecisionOutcomeKind): number {
  if (kind === "CHARGE_AFTER_CANCEL_PLAN") return 0;
  if (kind === "NO_CHARGE_SEEN") return 1;
  if (kind === "CANNOT_VERIFY") return 2;
  if (kind === "DECISION_DUE_AGAIN") return 3;
  return 4;
}

function decideHeadline(dueDate: string | null, daysAway: number | null): string {
  if (daysAway === 0) return "Decide today";
  if (daysAway === 1) return "Decide tomorrow";
  if (dueDate) {
    const weekday = weekdayNames[utcWeekday(dueDate)];
    return weekday ? `Decide before ${weekday}` : `Decide before ${dueDate}`;
  }
  return "Decision needed";
}

function reasonSentence(key: DecisionReasonKey, fact: DecisionCycleFact, daysAway: number | null): string {
  if (key === "RENEWS_SOON") {
    if (daysAway === 0) return "Expected today.";
    if (daysAway === 1) return "Expected tomorrow.";
    return `Expected in ${daysAway} days.`;
  }
  if (key === "PRICE_INCREASE" && fact.priceChange) {
    const previous = toMoneyDto(fact.priceChange.previousMinor, fact.currency);
    const current = toMoneyDto(fact.priceChange.currentMinor, fact.currency);
    const delta = toMoneyDto(fact.priceChange.currentMinor - fact.priceChange.previousMinor, fact.currency);
    return `Last bill increased from ${previous.display} to ${current.display}. Price increased ${delta.display}.`;
  }
  if (key === "OVERLAP_NO_PURPOSE") {
    const names = fact.overlapPeers.map((peer) => peer.merchant);
    const named = names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
    return `You also pay for ${named} in the same category, and no unique purpose is recorded here.`;
  }
  if (key === "NEW_COMMITMENT") return "This is a newly observed recurring commitment.";
  if (key === "IDENTITY_UNCERTAIN") return IDENTITY_UNCERTAIN_REASON;
  if (key === "AMOUNT_CONFLICT") return "The latest bill does not match the usual amount.";
  return "You haven't reviewed this commitment before.";
}

function observedAmount(cycle: SavedDecisionCycle): MoneyDto | null {
  if (cycle.observedAmountMinor === null || !cycle.observedCurrency) return null;
  return toMoneyDto(cycle.observedAmountMinor, cycle.observedCurrency);
}

function observedDetail(cycle: SavedDecisionCycle, fallback: string): string {
  const amount = observedAmount(cycle);
  if (amount && cycle.observedDate) return `${amount.display} arrived on ${cycle.observedDate}.`;
  return fallback;
}

function historyVerificationHeadline(cycle: SavedDecisionCycle): string | null {
  if (cycle.userAction === "PLAN_TO_CANCEL" && cycle.verificationOutcome === "CHARGE_ARRIVED") {
    return "Charge still arrived";
  }
  if (cycle.userAction === "PLAN_TO_CANCEL" && cycle.verificationOutcome === "NO_CHARGE_IN_WINDOW") {
    return "No new charge seen";
  }
  if (cycle.userAction === "KEEP" && cycle.verificationOutcome === "CHARGE_ARRIVED") return "Continued as planned";
  if (cycle.verificationOutcome === "CANNOT_EVALUATE") return "Cannot verify yet";
  return null;
}

function parseDate(value: string): number | null {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function addDays(value: string, days: number): string {
  const parsed = parseDate(value);
  if (parsed === null) return value;
  return new Date(parsed + days * dayMs).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number | null {
  const start = parseDate(from);
  const end = parseDate(to);
  if (start === null || end === null) return null;
  return Math.round((end - start) / dayMs);
}

function utcWeekday(value: string): number {
  const parsed = parseDate(value);
  return parsed === null ? 0 : new Date(parsed).getUTCDay();
}
