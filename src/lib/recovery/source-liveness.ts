import type { SourceType } from "@/lib/recovery/contracts";

/**
 * Source liveness.
 *
 * Coverage is a property of each individual source, not of the workspace. A
 * workspace with one healthy feed and one dead feed is not "current" for the
 * subscriptions that only the dead feed could see, so absence reasoning always
 * asks this module about the sources a specific commitment actually cites.
 */
export const sourceLivenessStates = [
  "CURRENT",
  "PARTIAL",
  "STALE",
  "BROKEN",
  "BASELINE_ONLY",
  "NO_EVIDENCE",
] as const;
export type SourceLivenessState = (typeof sourceLivenessStates)[number];

/** Sources that keep producing evidence without a person doing anything. */
const automaticSourceKinds = new Set<SourceType>(["FORWARDED_EMAIL", "GMAIL_OAUTH"]);

export const sourceBrokenFailureThreshold = 3;
export const sourceStaleAfterDays = 45;
export const sourceCurrentWithinDays = 14;
export const sourceCurrentMinimumSpanDays = 60;

const dayMs = 24 * 60 * 60 * 1_000;

export type SourceLivenessInput = {
  sourceId: string;
  kind: SourceType;
  connected: boolean;
  credentialRevoked: boolean;
  consecutiveFailureCount: number;
  evidenceCount: number;
  lastEvidenceAt: string | null;
  /** The last time the channel produced anything at all, including an empty delivery. */
  lastDeliveryAt: string | null;
  coverageStart: string | null;
  coverageEnd: string | null;
};

export type SourceLiveness = {
  sourceId: string;
  kind: SourceType;
  state: SourceLivenessState;
  automatic: boolean;
  /** True only when this source can be relied on to have seen a recent charge. */
  trustworthy: boolean;
  lastEvidenceAt: string | null;
  lastDeliveryAt: string | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  ageDays: number | null;
  spanDays: number | null;
  limitations: readonly string[];
};

/**
 * Absence only means something when the source that would have carried the
 * charge was definitely watching. Anything short of current coverage makes
 * "we did not see it" unusable as a conclusion.
 */
export function isCoverageTrustworthy(state: SourceLivenessState) {
  return state === "CURRENT";
}

function daysSince(iso: string | null, now: Date) {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return null;
  return Math.floor((now.getTime() - at) / dayMs);
}

function spanDaysBetween(start: string | null, end: string | null) {
  if (!start || !end) return null;
  const from = Date.parse(`${start}T00:00:00.000Z`);
  const to = Date.parse(`${end}T00:00:00.000Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.floor((to - from) / dayMs);
}

export function assessSourceLiveness(input: SourceLivenessInput, now: Date): SourceLiveness {
  const automatic = automaticSourceKinds.has(input.kind);
  const ageDays = daysSince(input.lastDeliveryAt ?? input.lastEvidenceAt, now);
  const spanDays = spanDaysBetween(input.coverageStart, input.coverageEnd);
  const base = {
    sourceId: input.sourceId,
    kind: input.kind,
    automatic,
    lastEvidenceAt: input.lastEvidenceAt,
    lastDeliveryAt: input.lastDeliveryAt,
    coverageStart: input.coverageStart,
    coverageEnd: input.coverageEnd,
    ageDays,
    spanDays,
  };

  if (input.credentialRevoked || !input.connected || input.consecutiveFailureCount >= sourceBrokenFailureThreshold) {
    return {
      ...base,
      state: "BROKEN",
      trustworthy: false,
      limitations: ["This source has stopped working, so reconnect it before trusting anything it would have seen."],
    };
  }

  if (input.evidenceCount <= 0 && !input.lastDeliveryAt) {
    return {
      ...base,
      state: "NO_EVIDENCE",
      trustworthy: false,
      limitations: ["This source has not produced anything yet."],
    };
  }

  if (!automatic) {
    return {
      ...base,
      state: "BASELINE_ONLY",
      trustworthy: false,
      limitations: ["This is a one-off import, so it will not pick up anything new on its own."],
    };
  }

  if (ageDays === null || ageDays > sourceStaleAfterDays) {
    return {
      ...base,
      state: "STALE",
      trustworthy: false,
      limitations: [`Nothing has arrived from this source in over ${sourceStaleAfterDays} days.`],
    };
  }

  if (ageDays <= sourceCurrentWithinDays && (spanDays ?? 0) >= sourceCurrentMinimumSpanDays) {
    return { ...base, state: "CURRENT", trustworthy: true, limitations: [] };
  }

  return {
    ...base,
    state: "PARTIAL",
    trustworthy: false,
    limitations: ["This source is working but has not been watching long enough to be sure nothing was missed."],
  };
}

const qualityOrder: readonly SourceLivenessState[] = ["NO_EVIDENCE", "BROKEN", "BASELINE_ONLY", "STALE", "PARTIAL", "CURRENT"];

function bestState(states: readonly SourceLivenessState[]): SourceLivenessState {
  let best: SourceLivenessState = "NO_EVIDENCE";
  for (const state of states) {
    if (qualityOrder.indexOf(state) > qualityOrder.indexOf(best)) best = state;
  }
  return best;
}

export type CommitmentCoverage = {
  state: SourceLivenessState;
  trustworthy: boolean;
  citedSourceIds: readonly string[];
  brokenSourceIds: readonly string[];
  staleSourceIds: readonly string[];
  limitations: readonly string[];
};

/**
 * Coverage for one commitment, computed only from the sources it cites. A
 * healthy feed elsewhere in the workspace cannot vouch for a merchant it never
 * carried.
 */
export function assessCommitmentCoverage(
  citedSourceIds: readonly string[],
  sources: readonly SourceLiveness[],
): CommitmentCoverage {
  const byId = new Map(sources.map((source) => [source.sourceId, source]));
  const cited = [...new Set(citedSourceIds)].sort().flatMap((id) => {
    const source = byId.get(id);
    return source ? [source] : [];
  });
  if (!cited.length) {
    return {
      state: "NO_EVIDENCE",
      trustworthy: false,
      citedSourceIds: [],
      brokenSourceIds: [],
      staleSourceIds: [],
      limitations: ["No working source is watching this subscription."],
    };
  }
  const state = bestState(cited.map((source) => source.state));
  const broken = cited.filter((source) => source.state === "BROKEN").map((source) => source.sourceId);
  const stale = cited.filter((source) => source.state === "STALE").map((source) => source.sourceId);
  return {
    state,
    trustworthy: isCoverageTrustworthy(state),
    citedSourceIds: cited.map((source) => source.sourceId),
    brokenSourceIds: broken,
    staleSourceIds: stale,
    limitations: [...new Set(cited.filter((source) => source.state === state).flatMap((source) => source.limitations))],
  };
}

export type WorkspaceCoverageHealth = {
  state: SourceLivenessState;
  coverageBroken: boolean;
  sourceCount: number;
  automaticSourceCount: number;
  liveAutomaticSourceCount: number;
  brokenSourceIds: readonly string[];
  staleSourceIds: readonly string[];
  lastEvidenceAt: string | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  limitations: readonly string[];
};

export function rollUpWorkspaceCoverage(sources: readonly SourceLiveness[]): WorkspaceCoverageHealth {
  const broken = sources.filter((source) => source.state === "BROKEN").map((source) => source.sourceId).sort();
  const stale = sources.filter((source) => source.state === "STALE").map((source) => source.sourceId).sort();
  const automatic = sources.filter((source) => source.automatic);
  const lastEvidenceAt = sources.map((source) => source.lastEvidenceAt)
    .filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const coverageStart = sources.map((source) => source.coverageStart)
    .filter((value): value is string => Boolean(value)).sort().at(0) ?? null;
  const coverageEnd = sources.map((source) => source.coverageEnd)
    .filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;

  const state: SourceLivenessState = !sources.length
    ? "NO_EVIDENCE"
    : automatic.length
      ? bestState(automatic.map((source) => source.state))
      : bestState(sources.map((source) => source.state === "BROKEN" ? "BROKEN" : "BASELINE_ONLY"));

  const limitations: string[] = [];
  if (!sources.length) limitations.push("Nothing is watching this account yet.");
  if (sources.length && !automatic.length) limitations.push("Nothing automatic is watching yet, so new charges will only appear when you add them.");
  if (broken.length) limitations.push("At least one source has stopped working, so recent charges may be missing.");
  if (stale.length) limitations.push("At least one source has gone quiet for a long time.");
  if (state === "PARTIAL") limitations.push("Totals are a floor backed by what we can see, not a complete picture.");

  return {
    state,
    coverageBroken: broken.length > 0,
    sourceCount: sources.length,
    automaticSourceCount: automatic.length,
    liveAutomaticSourceCount: automatic.filter((source) => source.state === "CURRENT" || source.state === "PARTIAL").length,
    brokenSourceIds: broken,
    staleSourceIds: stale,
    lastEvidenceAt,
    coverageStart,
    coverageEnd,
    limitations,
  };
}
