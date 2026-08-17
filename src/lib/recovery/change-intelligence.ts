import type { ChargeWindow } from "@/lib/recovery/absence";
import type { CommitmentBelief } from "@/lib/recovery/commitment-state";
import type { Cadence } from "@/lib/recovery/contracts";
import type { SourceLiveness, WorkspaceCoverageHealth } from "@/lib/recovery/source-liveness";

/**
 * Change intelligence.
 *
 * Exactly eight things are worth interrupting someone for. Every one of them
 * must cite either persisted evidence or an absence that trustworthy coverage
 * makes meaningful, must be reproducible from the same facts, must deduplicate
 * against what is already stored, and must carry a lifecycle so it can be
 * acknowledged, resolved or superseded rather than repeated forever.
 */
export const changeSignalKinds = [
  "TRIAL_CONVERTING",
  "ANNUAL_RENEWAL_APPROACHING",
  "PRICE_INCREASE",
  "NEW_RECURRING_COMMITMENT",
  "DUPLICATE_SUSPECTED",
  "EXPECTED_CHARGE_MISSING",
  "CANCELLATION_NOT_EFFECTIVE",
  "COVERAGE_BROKEN",
] as const;
export type ChangeSignalKind = (typeof changeSignalKinds)[number];

export const changeSignalStates = ["OPEN", "ACKNOWLEDGED", "RESOLVED", "SUPERSEDED", "EXPIRED"] as const;
export type ChangeSignalState = (typeof changeSignalStates)[number];

export const changeMaterialities = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type ChangeMateriality = (typeof changeMaterialities)[number];

export const trialNoticeDays = 14;
export const annualRenewalNoticeDays = 30;
export const newCommitmentNoticeDays = 45;

const dayMs = 24 * 60 * 60 * 1_000;

export type ChangeCitation =
  | { kind: "EVIDENCE"; evidenceIds: readonly string[] }
  | { kind: "COVERED_ABSENCE"; window: ChargeWindow; coverageSourceIds: readonly string[] }
  | { kind: "SOURCE_HEALTH"; sourceIds: readonly string[] };

export type ChangeSignal = {
  dedupeKey: string;
  kind: ChangeSignalKind;
  commitmentId: string | null;
  merchant: string | null;
  title: string;
  detail: string;
  confidence: number;
  materiality: ChangeMateriality;
  currency: string | null;
  amountMinor: bigint | null;
  deltaMinor: bigint | null;
  dueDate: string | null;
  citation: ChangeCitation;
};

export type CommitmentChangeContext = {
  belief: CommitmentBelief;
  merchant: string;
  currency: string;
  amountMinor: bigint;
  cadence: Cadence;
  nextExpectedDate: string | null;
  firstDetectedAt: string;
  observationCount: number;
  trial: { endsOn: string; evidenceIds: readonly string[] } | null;
};

export type DuplicateSuspicion = {
  commitmentId: string;
  otherCommitmentId: string;
  merchant: string;
  otherMerchant: string;
  score: number;
  evidenceIds: readonly string[];
  reasons: readonly string[];
};

function daysUntil(from: string, to: string) {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / dayMs);
}

function daysSinceInstant(from: string, evaluatedOn: string) {
  const start = Date.parse(from);
  const end = Date.parse(`${evaluatedOn}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.floor((end - start) / dayMs);
}

function increaseMateriality(deltaBasisPoints: number): ChangeMateriality {
  if (deltaBasisPoints >= 2_500) return "CRITICAL";
  if (deltaBasisPoints >= 1_000) return "HIGH";
  if (deltaBasisPoints >= 300) return "MEDIUM";
  return "LOW";
}

function basisPoints(delta: bigint, base: bigint) {
  if (base === BigInt(0)) return 0;
  const scaled = (delta < BigInt(0) ? -delta : delta) * BigInt(100_000) / base;
  return Number((scaled + BigInt(5)) / BigInt(10));
}

export function detectChangeSignals(input: {
  evaluatedOn: string;
  commitments: readonly CommitmentChangeContext[];
  sources: readonly SourceLiveness[];
  workspaceCoverage: WorkspaceCoverageHealth;
  duplicateSuspicions: readonly DuplicateSuspicion[];
}): readonly ChangeSignal[] {
  const signals: ChangeSignal[] = [];

  for (const source of input.sources.filter((entry) => entry.state === "BROKEN")) {
    signals.push({
      dedupeKey: `COVERAGE_BROKEN:${source.sourceId}`,
      kind: "COVERAGE_BROKEN",
      commitmentId: null,
      merchant: null,
      title: "One of your sources stopped working",
      detail: "We are not seeing new receipts from it, so recent charges may be missing until you reconnect it.",
      confidence: 100,
      materiality: "CRITICAL",
      currency: null,
      amountMinor: null,
      deltaMinor: null,
      dueDate: null,
      citation: { kind: "SOURCE_HEALTH", sourceIds: [source.sourceId] },
    });
  }

  for (const commitment of input.commitments) {
    const { belief } = commitment;

    if (commitment.trial) {
      const daysLeft = daysUntil(input.evaluatedOn, commitment.trial.endsOn);
      if (daysLeft !== null && daysLeft >= 0 && daysLeft <= trialNoticeDays && commitment.trial.evidenceIds.length) {
        signals.push({
          dedupeKey: `TRIAL_CONVERTING:${belief.commitmentId}:${commitment.trial.endsOn}`,
          kind: "TRIAL_CONVERTING",
          commitmentId: belief.commitmentId,
          merchant: commitment.merchant,
          title: `${commitment.merchant} free trial ends soon`,
          detail: `Your free trial ends on ${commitment.trial.endsOn}. After that you will start being charged.`,
          confidence: 100,
          materiality: "HIGH",
          currency: commitment.currency,
          amountMinor: commitment.amountMinor,
          deltaMinor: null,
          dueDate: commitment.trial.endsOn,
          citation: { kind: "EVIDENCE", evidenceIds: [...commitment.trial.evidenceIds].sort() },
        });
      }
    }

    if (commitment.cadence === "YEARLY" && commitment.nextExpectedDate && belief.citedEvidenceIds.length) {
      const daysLeft = daysUntil(input.evaluatedOn, commitment.nextExpectedDate);
      if (daysLeft !== null && daysLeft >= 0 && daysLeft <= annualRenewalNoticeDays) {
        signals.push({
          dedupeKey: `ANNUAL_RENEWAL_APPROACHING:${belief.commitmentId}:${commitment.nextExpectedDate}`,
          kind: "ANNUAL_RENEWAL_APPROACHING",
          commitmentId: belief.commitmentId,
          merchant: commitment.merchant,
          title: `${commitment.merchant} renews for another year soon`,
          detail: `The next yearly charge is expected on ${commitment.nextExpectedDate}.`,
          confidence: 100,
          materiality: daysLeft <= 7 ? "HIGH" : "MEDIUM",
          currency: commitment.currency,
          amountMinor: commitment.amountMinor,
          deltaMinor: null,
          dueDate: commitment.nextExpectedDate,
          citation: { kind: "EVIDENCE", evidenceIds: [...belief.citedEvidenceIds].sort() },
        });
      }
    }

    const previousPrice = belief.priceHistory.at(-2);
    const currentPrice = belief.priceHistory.at(-1);
    if (previousPrice && currentPrice && currentPrice.amountMinor > previousPrice.amountMinor) {
      const delta = currentPrice.amountMinor - previousPrice.amountMinor;
      signals.push({
        dedupeKey: `PRICE_INCREASE:${belief.commitmentId}:${previousPrice.amountMinor}:${currentPrice.amountMinor}`,
        kind: "PRICE_INCREASE",
        commitmentId: belief.commitmentId,
        merchant: commitment.merchant,
        title: `${commitment.merchant} costs more than it did`,
        detail: `The charge on ${currentPrice.fromDate} was higher than the one before it.`,
        confidence: 100,
        materiality: increaseMateriality(basisPoints(delta, previousPrice.amountMinor)),
        currency: currentPrice.currency,
        amountMinor: currentPrice.amountMinor,
        deltaMinor: delta,
        dueDate: null,
        citation: { kind: "EVIDENCE", evidenceIds: [...currentPrice.evidenceIds].sort() },
      });
    }

    const ageDays = daysSinceInstant(commitment.firstDetectedAt, input.evaluatedOn);
    if (
      commitment.observationCount >= 2
      && ageDays !== null && ageDays >= 0 && ageDays <= newCommitmentNoticeDays
      && belief.citedEvidenceIds.length
    ) {
      signals.push({
        dedupeKey: `NEW_RECURRING_COMMITMENT:${belief.commitmentId}`,
        kind: "NEW_RECURRING_COMMITMENT",
        commitmentId: belief.commitmentId,
        merchant: commitment.merchant,
        title: `${commitment.merchant} looks like a new regular charge`,
        detail: "We have now seen it bill you more than once, so we started tracking it.",
        confidence: 100,
        materiality: "MEDIUM",
        currency: commitment.currency,
        amountMinor: commitment.amountMinor,
        deltaMinor: null,
        dueDate: commitment.nextExpectedDate,
        citation: { kind: "EVIDENCE", evidenceIds: [...belief.citedEvidenceIds].sort() },
      });
    }

    if (belief.conflictState === "CANCELLATION_NOT_EFFECTIVE" && belief.citedEvidenceIds.length) {
      signals.push({
        dedupeKey: `CANCELLATION_NOT_EFFECTIVE:${belief.commitmentId}:${[...belief.citedEvidenceIds].sort().join(",")}`,
        kind: "CANCELLATION_NOT_EFFECTIVE",
        commitmentId: belief.commitmentId,
        merchant: commitment.merchant,
        title: `${commitment.merchant} charged you after you cancelled`,
        detail: "The cancellation does not appear to have gone through.",
        confidence: 100,
        materiality: "CRITICAL",
        currency: commitment.currency,
        amountMinor: commitment.amountMinor,
        deltaMinor: null,
        dueDate: null,
        citation: { kind: "EVIDENCE", evidenceIds: [...belief.citedEvidenceIds].sort() },
      });
    }

    const evaluation = belief.chargeEvaluation;
    if (
      evaluation.status === "EVALUATED"
      && evaluation.outcome === "NOT_OBSERVED"
      && belief.cancellationState === "NONE"
      && belief.coverageState === "CURRENT"
    ) {
      signals.push({
        dedupeKey: `EXPECTED_CHARGE_MISSING:${belief.commitmentId}:${evaluation.window.start}`,
        kind: "EXPECTED_CHARGE_MISSING",
        commitmentId: belief.commitmentId,
        merchant: commitment.merchant,
        title: `${commitment.merchant} did not charge you this time`,
        detail: `Nothing arrived between ${evaluation.window.start} and ${evaluation.window.end}. That is not proof it ended.`,
        confidence: 80,
        materiality: "MEDIUM",
        currency: commitment.currency,
        amountMinor: commitment.amountMinor,
        deltaMinor: null,
        dueDate: evaluation.window.end,
        citation: {
          kind: "COVERED_ABSENCE",
          window: evaluation.window,
          coverageSourceIds: [...belief.coverageSourceIds].sort(),
        },
      });
    }
  }

  const seenPairs = new Set<string>();
  for (const suspicion of input.duplicateSuspicions) {
    const pair = [suspicion.commitmentId, suspicion.otherCommitmentId].sort();
    const key = `DUPLICATE_SUSPECTED:${pair.join(":")}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    signals.push({
      dedupeKey: key,
      kind: "DUPLICATE_SUSPECTED",
      commitmentId: pair[0]!,
      merchant: suspicion.merchant,
      title: `${suspicion.merchant} may be the same as ${suspicion.otherMerchant}`,
      detail: "We are not sure these are the same subscription, so we kept them separate. Tell us and we will fix it.",
      confidence: Math.max(0, Math.min(100, Math.round(suspicion.score))),
      materiality: "MEDIUM",
      currency: null,
      amountMinor: null,
      deltaMinor: null,
      dueDate: null,
      citation: { kind: "EVIDENCE", evidenceIds: [...new Set(suspicion.evidenceIds)].sort() },
    });
  }

  return signals.sort((left, right) => left.dedupeKey.localeCompare(right.dedupeKey));
}

export type StoredChangeSignal = {
  dedupeKey: string;
  kind: ChangeSignalKind;
  commitmentId: string | null;
  state: ChangeSignalState;
};

export type ChangeSignalPlan = {
  opened: readonly ChangeSignal[];
  reopened: readonly { dedupeKey: string; state: "OPEN"; at: string }[];
  closed: readonly { dedupeKey: string; state: "RESOLVED"; at: string }[];
  superseded: readonly { dedupeKey: string; state: "SUPERSEDED"; at: string }[];
};

const liveStates = new Set<ChangeSignalState>(["OPEN", "ACKNOWLEDGED"]);

/**
 * Turns "what is true now" plus "what we already told them" into the minimum
 * set of writes. Re-running with unchanged facts produces no writes at all.
 */
export function reconcileChangeSignals(input: {
  stored: readonly StoredChangeSignal[];
  detected: readonly ChangeSignal[];
  at: string;
}): ChangeSignalPlan {
  const storedByKey = new Map(input.stored.map((entry) => [entry.dedupeKey, entry]));
  const detectedByKey = new Map(input.detected.map((entry) => [entry.dedupeKey, entry]));

  const opened = input.detected.filter((signal) => !storedByKey.has(signal.dedupeKey));

  // A resolution only ever meant "this stopped being true". If the identical
  // occurrence is true again — a source outage ended and the charge is still
  // missing — the customer must see it, so resolution is reversible.
  // Supersession and expiry are judgements about the record itself and stay final.
  const reopened = input.stored
    .filter((stored) => stored.state === "RESOLVED" && detectedByKey.has(stored.dedupeKey))
    .map((stored) => ({ dedupeKey: stored.dedupeKey, state: "OPEN" as const, at: input.at }));

  const supersededKeys = new Set<string>();
  for (const signal of opened) {
    for (const stored of input.stored) {
      if (!liveStates.has(stored.state)) continue;
      if (stored.kind !== signal.kind) continue;
      if (stored.commitmentId !== signal.commitmentId) continue;
      if (stored.dedupeKey === signal.dedupeKey) continue;
      if (detectedByKey.has(stored.dedupeKey)) continue;
      supersededKeys.add(stored.dedupeKey);
    }
  }

  const closed = input.stored
    .filter((stored) => liveStates.has(stored.state))
    .filter((stored) => !detectedByKey.has(stored.dedupeKey))
    .filter((stored) => !supersededKeys.has(stored.dedupeKey))
    .map((stored) => ({ dedupeKey: stored.dedupeKey, state: "RESOLVED" as const, at: input.at }));

  return {
    opened,
    reopened,
    closed,
    superseded: [...supersededKeys].sort().map((dedupeKey) => ({ dedupeKey, state: "SUPERSEDED" as const, at: input.at })),
  };
}
