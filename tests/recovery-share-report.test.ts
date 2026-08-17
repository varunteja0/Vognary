import assert from "node:assert/strict";
import test from "node:test";
import type { HomeProjectionDto } from "../src/lib/recovery/contracts";
import { renderRecoveryShareText } from "../src/lib/recovery/share-report";

const inr = { currency: "INR", minor: "199900", exponent: 2, display: "₹1,999.00" };
const usd = { currency: "USD", minor: "2000", exponent: 2, display: "$20.00" };
const confidence = { state: "HIGH", score: 94, scale: "PERCENT_0_100", reasons: ["Repeated receipts"] } as const;

const home: HomeProjectionDto = {
  workspace: { id: "workspace-1", name: "Founder workspace", role: "owner", version: 5 },
  generatedAt: "2026-08-12T09:00:00.000Z",
  recentObservations: [],
  monthlyTotals: [
    { amount: inr, commitmentIds: ["commitment-1"], evidenceIds: ["evidence-1"], provenance: "RECEIPT", correctionIds: [] },
    { amount: usd, commitmentIds: ["commitment-2"], evidenceIds: ["evidence-2"], provenance: "RECEIPT", correctionIds: [] },
  ],
  annualizedEstimateTotals: [
    { amount: { currency: "INR", minor: "2398800", exponent: 2, display: "₹23,988.00" }, commitmentIds: ["commitment-1"], evidenceIds: ["evidence-1"], provenance: "RECEIPT", correctionIds: [] },
    { amount: { currency: "USD", minor: "24000", exponent: 2, display: "$240.00" }, commitmentIds: ["commitment-2"], evidenceIds: ["evidence-2"], provenance: "RECEIPT", correctionIds: [] },
  ],
  next30DayTotals: [{ amount: inr, commitmentIds: ["commitment-1"], evidenceIds: ["evidence-1"], provenance: "RECEIPT", correctionIds: [] }],
  needsMe: [{
    id: "attention-1",
    commitmentId: "commitment-1",
    priority: "HIGH",
    reason: "DECISION_REQUIRED",
    title: "Decide on OpenAI",
    detail: "Choose keep, review later, or plan to cancel.",
    amount: inr,
    dueDate: "2026-08-18",
    evidenceIds: ["evidence-1"],
  }],
  changed: {
    state: "COMPARED",
    fromVersion: 4,
    toVersion: 5,
    items: [{
      id: "change-1",
      commitmentId: "commitment-1",
      merchant: "OpenAI",
      kind: "AMOUNT",
      before: { ...inr, minor: "189900", display: "₹1,899.00" },
      after: inr,
      detectedAt: "2026-08-12T08:00:00.000Z",
      provenance: { kind: "EVIDENCE", submissionId: "submission-2", evidenceIds: ["evidence-1"] },
    }],
  },
  next: [{
    commitmentId: "commitment-1",
    merchant: "OpenAI",
    date: "2026-08-18",
    daysAway: 6,
    amount: inr,
    decision: null,
    confidence,
    reminderEligible: true,
    evidenceIds: ["evidence-1"],
  }],
  coverage: {
    state: "CURRENT",
    sourceCount: 2,
    evidenceCount: 3,
    lastEvidenceAt: "2026-08-12T08:00:00.000Z",
    coverageStart: "2026-07-18",
    coverageEnd: "2026-08-12",
    limitations: ["Only submitted receipts are covered."],
  },
  activeCommitmentCount: 2,
  unknownCadenceCommitmentCount: 0,
  reviewItemCount: 1,
  evidenceSources: [],
};

test("Recovery share text projects server facts without combining currencies", () => {
  const text = renderRecoveryShareText(home);

  assert.match(text, /Monthly burn by currency from checked receipts:/);
  assert.match(text, /INR: ₹1,999\.00\/mo\./);
  assert.match(text, /USD: \$20\.00\/mo\./);
  assert.match(text, /Annualized estimate by currency \(12 × cited monthly equivalent, not a historical yearly total\):/);
  assert.match(text, /INR: ₹23,988\.00\/yr\./);
  assert.match(text, /USD: \$240\.00\/yr\./);
  assert.match(text, /Active commitments: 2\. Needs review: 1\./);
  assert.match(text, /Currencies stay separate; no exchange rate was invented\./);
  assert.match(text, /Changed since last visit: OpenAI — Amount changed\./);
  assert.match(text, /Next expected charge: OpenAI · ₹1,999\.00 · 18 Aug 2026 \(in 6 days\)\./);
  assert.match(text, /Needs attention: Decide on OpenAI — Choose keep, review later, or plan to cancel\./);
  assert.match(text, /Coverage: 3 receipts from 2 sources\. This is a floor from receipts checked, not every debit in India\./);
  assert.doesNotMatch(text, /₹3,999|converted|approximately|₹1,999\.00\/mo \+ \$20\.00\/mo/i);
});

test("Recovery share text names a saved correction when the monthly total is not receipt-only", () => {
  const text = renderRecoveryShareText({
    ...home,
    monthlyTotals: [{
      ...home.monthlyTotals[0],
      provenance: "USER_CORRECTED",
      correctionIds: ["correction-amount-1"],
    }],
    annualizedEstimateTotals: [{
      ...home.annualizedEstimateTotals[0],
      provenance: "USER_CORRECTED",
      correctionIds: ["correction-amount-1"],
    }],
    next30DayTotals: [{
      ...home.next30DayTotals[0],
      provenance: "USER_CORRECTED",
      correctionIds: ["correction-amount-1"],
    }],
  });

  assert.match(text, /Monthly burn including a saved correction: ₹1,999\.00\/mo\./);
  assert.doesNotMatch(text, /Monthly burn from checked receipts/);
  assert.match(text, /INR monthly total includes a saved correction/);
  assert.doesNotMatch(text, /INR monthly total includes a saved correction[\s\S]*INR monthly total includes a saved correction/);
});

test("Recovery share text names a saved correction on the annualized estimate when that total is corrected", () => {
  const text = renderRecoveryShareText({
    ...home,
    monthlyTotals: [{
      ...home.monthlyTotals[0],
      provenance: "USER_CORRECTED",
      correctionIds: ["correction-amount-1"],
    }],
    annualizedEstimateTotals: [{
      ...home.annualizedEstimateTotals[0],
      provenance: "USER_CORRECTED",
      correctionIds: ["correction-amount-1"],
    }],
  });

  assert.match(text, /INR annualized estimate includes a saved correction/);
});

test("Recovery share text does not call mixed-currency totals receipt-only when one currency is corrected", () => {
  const text = renderRecoveryShareText({
    ...home,
    monthlyTotals: [
      { ...home.monthlyTotals[0], provenance: "USER_CORRECTED", correctionIds: ["correction-amount-1"] },
      home.monthlyTotals[1],
    ],
  });

  assert.match(text, /Monthly burn by currency, including a saved correction:/);
  assert.doesNotMatch(text, /Monthly burn by currency from checked receipts:/);
  assert.match(text, /INR monthly total includes a saved correction/);
});

test("Recovery share text names a saved first observation without calling it recurring", () => {
  const text = renderRecoveryShareText({
    ...home,
    recentObservations: [{ evidenceId: "evidence-once-1", merchant: "Figma", amount: inr, date: "2026-08-08" }],
    monthlyTotals: [],
    annualizedEstimateTotals: [],
    next30DayTotals: [],
    next: [],
    needsMe: [],
    activeCommitmentCount: 0,
    unknownCadenceCommitmentCount: 0,
    reviewItemCount: 0,
    changed: { state: "NO_PRIOR_BASELINE", fromVersion: null, toVersion: 1, items: [] },
    coverage: {
      state: "BASELINE_ONLY",
      sourceCount: 1,
      evidenceCount: 1,
      lastEvidenceAt: "2026-08-12T08:00:00.000Z",
      coverageStart: "2026-08-08",
      coverageEnd: "2026-08-08",
      limitations: ["One receipt has been checked; no repeated service is proven."],
    },
  });

  assert.match(text, /Saved receipt observation \(not yet recurring\): Figma · ₹1,999\.00 · 8 Aug 2026\./);
  assert.match(text, /No monthly recurring total is published from these receipts\./);
  assert.doesNotMatch(text, /Annualized estimate|\/yr\./);
  assert.doesNotMatch(text, /Figma.*\/mo|Figma.*renews|savings?|money saved/i);
});

test("Recovery share text degrades honestly when no next charge or action is published", () => {
  const text = renderRecoveryShareText({
    ...home,
    next: [],
    needsMe: [],
    changed: { state: "NO_PRIOR_BASELINE", fromVersion: null, toVersion: 1, items: [] },
  });

  assert.match(text, /No expected charge is published from these receipts\./);
  assert.match(text, /No decision is waiting from the receipts checked\./);
  assert.doesNotMatch(text, /Nothing to cut|savings?|money saved/i);
});