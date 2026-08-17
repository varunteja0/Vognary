import type { Cadence } from "@/lib/recovery/contracts";
import type { MerchantIdentitySignalKind } from "@/lib/recovery/merchant-identity";
import type { SourceLivenessState } from "@/lib/recovery/source-liveness";

/**
 * Correction learning foundation.
 *
 * Every time a customer corrects the system, that is a labelled example. This
 * module defines the schema and the seam, nothing more. It deliberately refuses
 * to produce priors from a dataset that is too small: a system with four
 * corrections has no business claiming it learned anything, and inventing global
 * priors from zero data would be exactly the dishonesty this product exists to
 * avoid.
 *
 * Features are structural only. No merchant names, no addresses, no amounts, no
 * free text ever enters an example.
 */
export const correctionOutcomeKinds = [
  "MERCHANT_CORRECTED",
  "MERCHANT_ALIAS_ADDED",
  "CADENCE_CORRECTED",
  "AMOUNT_CORRECTED",
  "DUPLICATE_MERGE_ACCEPTED",
  "DUPLICATE_MERGE_REJECTED",
  "LIFECYCLE_CORRECTED",
  "CANCELLATION_OUTCOME_RECORDED",
] as const;
export type CorrectionOutcomeKind = (typeof correctionOutcomeKinds)[number];

/** Bumped whenever feature extraction changes, so old examples stay interpretable. */
export const learningFeatureVersion = "correction-features-1";

/** Below this, `derivePriors` refuses. Chosen to be a real sample, not a gesture. */
export const learningPriorMinimumExamples = 50;

export type CorrectionSystemProposal = {
  matchScore: number | null;
  strongestSignalKind: MerchantIdentitySignalKind | null;
  signalKinds: readonly MerchantIdentitySignalKind[];
  cadence: Cadence | null;
  currency: string;
  coverageState: SourceLivenessState;
};

export type CorrectionOutcome = {
  kind: CorrectionOutcomeKind;
  observedAt: string;
  citedEvidenceIds: readonly string[];
  systemProposed: CorrectionSystemProposal;
  userAnswer: "ACCEPTED" | "REJECTED" | "CHANGED";
};

export type LearningFeatures = Readonly<Record<string, string | number | boolean>>;

export type LearningExample = {
  kind: CorrectionOutcomeKind;
  label: CorrectionOutcome["userAnswer"];
  observedAt: string;
  featureVersion: string;
  features: LearningFeatures;
  citedEvidenceIds: readonly string[];
};

function scoreBucket(score: number | null) {
  if (score === null) return "UNKNOWN";
  if (score >= 80) return "80_100";
  if (score >= 60) return "60_79";
  if (score >= 40) return "40_59";
  return "0_39";
}

export function buildLearningExample(outcome: CorrectionOutcome): LearningExample {
  const signalKinds = [...new Set(outcome.systemProposed.signalKinds)].sort();
  return {
    kind: outcome.kind,
    label: outcome.userAnswer,
    observedAt: outcome.observedAt,
    featureVersion: learningFeatureVersion,
    features: {
      matchScoreBucket: scoreBucket(outcome.systemProposed.matchScore),
      strongestSignalKind: outcome.systemProposed.strongestSignalKind ?? "NONE",
      signalCount: signalKinds.length,
      hasDecisiveSignal: signalKinds.some((kind) => kind === "GSTIN" || kind === "EXPLICIT_MERCHANT_ID" || kind === "BILLING_DOMAIN"),
      onlyFuzzySignal: signalKinds.length === 1 && signalKinds[0] === "FUZZY_ALIAS",
      cadence: outcome.systemProposed.cadence ?? "UNKNOWN",
      currency: outcome.systemProposed.currency.trim().toUpperCase(),
      coverageState: outcome.systemProposed.coverageState,
    },
    citedEvidenceIds: [...new Set(outcome.citedEvidenceIds)].sort(),
  };
}

export type LearningDatasetSummary = {
  total: number;
  byKind: Readonly<Record<string, number>>;
  byLabel: Readonly<Record<string, number>>;
  readyForPriors: boolean;
  reasons: readonly string[];
};

export function summarizeLearningDataset(examples: readonly LearningExample[]): LearningDatasetSummary {
  const byKind: Record<string, number> = {};
  const byLabel: Record<string, number> = {};
  for (const example of examples) {
    byKind[example.kind] = (byKind[example.kind] ?? 0) + 1;
    byLabel[example.label] = (byLabel[example.label] ?? 0) + 1;
  }
  const readyForPriors = examples.length >= learningPriorMinimumExamples;
  return {
    total: examples.length,
    byKind,
    byLabel,
    readyForPriors,
    reasons: readyForPriors
      ? []
      : [`Not enough recorded corrections yet: ${examples.length} of ${learningPriorMinimumExamples}.`],
  };
}

export type LearningPriors = {
  available: boolean;
  featureVersion: string;
  sampleSize: number;
  /** Observed acceptance rate per feature value, in [0,1]. Never a fitted model. */
  weights: Readonly<Record<string, number>>;
  reasons: readonly string[];
};

/**
 * Reports what the recorded corrections actually say, once there are enough of
 * them. This is frequency, not machine learning, and it says so.
 */
export function derivePriors(examples: readonly LearningExample[]): LearningPriors {
  const summary = summarizeLearningDataset(examples);
  if (!summary.readyForPriors) {
    return { available: false, featureVersion: learningFeatureVersion, sampleSize: examples.length, weights: {}, reasons: summary.reasons };
  }
  const usable = examples.filter((example) => example.featureVersion === learningFeatureVersion);
  const totals = new Map<string, { accepted: number; seen: number }>();
  for (const example of usable) {
    for (const [feature, value] of Object.entries(example.features)) {
      const key = `${feature}=${String(value)}`;
      const entry = totals.get(key) ?? { accepted: 0, seen: 0 };
      entry.seen += 1;
      if (example.label === "ACCEPTED") entry.accepted += 1;
      totals.set(key, entry);
    }
  }
  const weights: Record<string, number> = {};
  for (const [key, entry] of [...totals.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    weights[key] = Math.round((entry.accepted / entry.seen) * 1_000) / 1_000;
  }
  return {
    available: true,
    featureVersion: learningFeatureVersion,
    sampleSize: usable.length,
    weights,
    reasons: ["These are observed acceptance rates from recorded corrections, not a trained model."],
  };
}
