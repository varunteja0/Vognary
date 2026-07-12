export type CorpusCommitment = {
  merchant: string;
  currency: string;
  frequency: string;
  averageAmount?: number;
};

export type CorpusCaseScore = {
  expected: number;
  detected: number;
  matched: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
};

export function evaluateCorpusCase(expected: CorpusCommitment[], detected: CorpusCommitment[]): CorpusCaseScore {
  const unmatched = new Set(detected.map((_, index) => index));
  let matched = 0;

  for (const target of expected) {
    const match = [...unmatched].find((index) => commitmentsMatch(target, detected[index]));
    if (match === undefined) continue;
    unmatched.delete(match);
    matched += 1;
  }

  const falsePositives = detected.length - matched;
  const falseNegatives = expected.length - matched;
  return {
    expected: expected.length,
    detected: detected.length,
    matched,
    falsePositives,
    falseNegatives,
    precision: detected.length ? matched / detected.length : expected.length ? 0 : 1,
    recall: expected.length ? matched / expected.length : 1,
  };
}

export function combineCorpusScores(scores: CorpusCaseScore[]): CorpusCaseScore {
  const expected = scores.reduce((total, score) => total + score.expected, 0);
  const detected = scores.reduce((total, score) => total + score.detected, 0);
  const matched = scores.reduce((total, score) => total + score.matched, 0);
  const falsePositives = detected - matched;
  const falseNegatives = expected - matched;
  return {
    expected,
    detected,
    matched,
    falsePositives,
    falseNegatives,
    precision: detected ? matched / detected : expected ? 0 : 1,
    recall: expected ? matched / expected : 1,
  };
}

function commitmentsMatch(expected: CorpusCommitment, detected: CorpusCommitment) {
  if (normalizeMerchant(expected.merchant) !== normalizeMerchant(detected.merchant)) return false;
  if (expected.currency.toUpperCase() !== detected.currency.toUpperCase()) return false;
  if (expected.frequency !== detected.frequency) return false;
  if (expected.averageAmount === undefined) return true;
  if (detected.averageAmount === undefined) return false;
  const tolerance = Math.max(1, Math.abs(expected.averageAmount) * 0.05);
  return Math.abs(expected.averageAmount - detected.averageAmount) <= tolerance;
}

function normalizeMerchant(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
}