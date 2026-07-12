import assert from "node:assert/strict";
import test from "node:test";

import { combineCorpusScores, evaluateCorpusCase } from "../src/lib/corpus-evaluation";

test("corpus scoring measures one-to-one precision and recall", () => {
  const score = evaluateCorpusCase([
    { merchant: "OpenAI", currency: "INR", frequency: "monthly", averageAmount: 1999 },
    { merchant: "Netflix", currency: "INR", frequency: "monthly", averageAmount: 649 },
  ], [
    { merchant: "OpenAI", currency: "INR", frequency: "monthly", averageAmount: 2000 },
    { merchant: "Unknown", currency: "INR", frequency: "monthly", averageAmount: 500 },
  ]);

  assert.equal(score.matched, 1);
  assert.equal(score.falsePositives, 1);
  assert.equal(score.falseNegatives, 1);
  assert.equal(score.precision, 0.5);
  assert.equal(score.recall, 0.5);
});

test("combined corpus scoring uses aggregate counts instead of averaging percentages", () => {
  const combined = combineCorpusScores([
    { expected: 1, detected: 1, matched: 1, falsePositives: 0, falseNegatives: 0, precision: 1, recall: 1 },
    { expected: 3, detected: 1, matched: 1, falsePositives: 0, falseNegatives: 2, precision: 1, recall: 1 / 3 },
  ]);
  assert.equal(combined.precision, 1);
  assert.equal(combined.recall, 0.5);
});