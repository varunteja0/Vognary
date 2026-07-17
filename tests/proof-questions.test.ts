import assert from "node:assert/strict";
import test from "node:test";

import {
  answerProofQuestion,
  assertEveryClaimIsCited,
  compileProofQuestion,
  type ProofQuestionDataset,
} from "../src/lib/proof-questions";

const dataset: ProofQuestionDataset = {
  graphRevision: 42,
  asOf: "2026-07-17T12:00:00.000Z",
  commitments: [
    {
      id: "commitment-openai",
      merchant: "OpenAI",
      normalizedMerchant: "openai",
      category: "AI tools",
      frequency: "monthly",
      currency: "INR",
      monthlyCost: 1999,
      annualCost: 23988,
      nextExpectedDate: "2026-08-06",
      lastChargeDate: "2026-07-06",
      confidenceScore: 91,
      proofDensity: 1,
      sourceDiversity: 0.82,
      freshness: 0.95,
      cadenceStability: 0.98,
      evidenceCount: 4,
      sourceNames: ["Bank statement", "Gmail receipt"],
      newestEvidenceDate: "2026-07-06",
    },
    {
      id: "commitment-canva",
      merchant: "Canva",
      normalizedMerchant: "canva",
      category: "Design",
      frequency: "monthly",
      currency: "INR",
      monthlyCost: 499,
      annualCost: 5988,
      nextExpectedDate: "2026-07-21",
      lastChargeDate: "2026-06-21",
      confidenceScore: 58,
      proofDensity: 0.34,
      sourceDiversity: 0.55,
      freshness: 0.45,
      cadenceStability: 0.45,
      evidenceCount: 1,
      sourceNames: ["Bank statement"],
      newestEvidenceDate: "2026-06-21",
    },
    {
      id: "commitment-github",
      merchant: "GitHub",
      normalizedMerchant: "github",
      category: "Developer tools",
      frequency: "monthly",
      currency: "USD",
      monthlyCost: 10,
      annualCost: 120,
      nextExpectedDate: "2026-07-25",
      lastChargeDate: "2026-06-25",
      confidenceScore: 87,
      proofDensity: 1,
      sourceDiversity: 0.82,
      freshness: 0.9,
      cadenceStability: 0.96,
      evidenceCount: 3,
      sourceNames: ["Card statement", "GitHub billing"],
      newestEvidenceDate: "2026-06-25",
    },
  ],
  savings: [{
    id: "saving-canva",
    actionCaseId: "case-canva",
    merchant: "Canva",
    currency: "INR",
    verifiedMonthlySaving: 499,
    verifiedAnnualSaving: 5988,
    cleanCycles: 2,
    requiredCleanCycles: 2,
    coverageStart: "2026-05-18",
    coverageEnd: "2026-07-24",
    mintedAt: "2026-07-25T04:00:00.000Z",
  }],
};

test("natural questions compile to bounded Proof Graph intents", () => {
  assert.equal(compileProofQuestion("What is my total recurring spend?"), "overview");
  assert.equal(compileProofQuestion("Which proof has gone stale?"), "stale-proof");
  assert.equal(compileProofQuestion("What have I verifiably stopped paying?"), "verified-savings");
  assert.equal(compileProofQuestion("Tell me a joke"), "unsupported");
});

test("overview keeps unlike currencies separate and cites every claim", () => {
  const answer = answerProofQuestion("How much recurring spend do I have?", dataset);
  assert.equal(answer.answerable, true);
  assert.equal(answer.claims.length, 2);
  assert.match(answer.summary.text, /never|does not add|kept separate/i);
  assert.doesNotThrow(() => assertEveryClaimIsCited(answer));
});

test("weak-proof answer ranks evidence weakness and links the commitment", () => {
  const answer = answerProofQuestion("Which commitments have the weakest proof?", dataset);
  assert.equal(answer.intent, "weak-proof");
  assert.match(answer.summary.text, /Canva/);
  assert.equal(answer.citations[0].entityId, "commitment-canva");
  assert.ok(answer.claims.every((claim) => claim.citationIds.length > 0));
});

test("merchant and verified-saving answers never invent uncited claims", () => {
  const merchant = answerProofQuestion("What do we know about OpenAI?", dataset);
  assert.equal(merchant.intent, "merchant");
  assert.equal(merchant.citations[0].sourceNames.length, 2);
  const savings = answerProofQuestion("How much have I verifiably stopped paying?", dataset);
  assert.equal(savings.intent, "verified-savings");
  assert.match(savings.claims[0].value, /5,988/);
  assert.doesNotThrow(() => assertEveryClaimIsCited(savings));
});

test("unsupported questions fail closed instead of guessing", () => {
  const answer = answerProofQuestion("Who will win the next election?", dataset);
  assert.equal(answer.answerable, false);
  assert.equal(answer.citations.length, 0);
  assert.match(answer.summary.text, /will not guess/i);
});

test("citation guard rejects any data claim without evidence", () => {
  const answer = answerProofQuestion("What is my total recurring spend?", dataset);
  assert.throws(() => assertEveryClaimIsCited({
    ...answer,
    claims: [{ ...answer.claims[0], citationIds: [] }],
  }), /no citation/i);
});
