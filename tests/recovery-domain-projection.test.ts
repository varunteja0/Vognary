import assert from "node:assert/strict";
import test from "node:test";

import {
  assertReconstructibleChanges,
  buildHomeProjection,
  currencyExponent,
  decimalToMinorUnits,
  minorUnitsToDecimal,
  toMoneyDto,
  type CanonicalCommitmentRecord,
} from "../src/lib/recovery/domain";
import type { ChangeItemDto } from "../src/lib/recovery/contracts";

const now = new Date("2026-08-09T10:00:00.000Z");

test("Recovery money uses exact bigint-safe minor strings and explicit currency exponents", () => {
  assert.equal(currencyExponent("INR"), 2);
  assert.equal(currencyExponent("JPY"), 0);
  assert.equal(currencyExponent("KWD"), 3);

  assert.equal(decimalToMinorUnits("1999.05", "INR"), "199905");
  assert.equal(decimalToMinorUnits("1999", "JPY"), "1999");
  assert.equal(decimalToMinorUnits("1.234", "KWD"), "1234");
  assert.equal(minorUnitsToDecimal("199905", 2), "1999.05");
  assert.equal(minorUnitsToDecimal("1234", 3), "1.234");

  assert.deepEqual(toMoneyDto("199905", "INR"), {
    currency: "INR",
    minor: "199905",
    exponent: 2,
    display: "₹1,999.05",
  });
  assert.equal(toMoneyDto("1999", "JPY").display, "JP¥1,999");
  assert.match(toMoneyDto("1234", "KWD").display, /1\.234/);
  const beyondJsSafeInteger = toMoneyDto("9007199254740993", "INR");
  assert.equal(beyondJsSafeInteger.minor, "9007199254740993");
  assert.equal(beyondJsSafeInteger.exponent, 2);

  assert.throws(() => decimalToMinorUnits("1.001", "INR"), /fraction/i);
  assert.throws(() => decimalToMinorUnits("92233720368547758.08", "INR"), /PostgreSQL bigint/i);
});

const commitments: CanonicalCommitmentRecord[] = [
  {
    id: "commitment-inr",
    version: 2,
    status: "ACTIVE",
    merchant: "OpenAI",
    category: "AI tools",
    cadence: "MONTHLY",
    currency: "INR",
    amountMinor: BigInt(199_900),
    monthlyEquivalentMinor: BigInt(199_900),
    nextExpectedDate: "2026-08-16",
    confidenceScore: 72,
    confidenceReasons: ["Two persisted observations support this commitment."],
    recommendedDecision: "MONITOR",
    recommendationReason: "Confirm the next renewal.",
    riskTags: ["renews soon"],
    decision: null,
    evidenceIds: ["evidence-inr-1", "evidence-inr-2"],
    updatedAt: now.toISOString(),
  },
  {
    id: "commitment-usd",
    version: 1,
    status: "ACTIVE",
    merchant: "GitHub",
    category: "Developer tools",
    cadence: "YEARLY",
    currency: "USD",
    amountMinor: BigInt(10_000),
    monthlyEquivalentMinor: BigInt(833),
    nextExpectedDate: "2026-09-30",
    confidenceScore: 91,
    confidenceReasons: ["Stable annual cadence."],
    recommendedDecision: "KEEP",
    recommendationReason: "No deterministic risk signal was found.",
    riskTags: [],
    decision: {
      value: "KEEP",
      decidedAt: "2026-08-08T10:00:00.000Z",
      updatedAt: "2026-08-08T10:00:00.000Z",
    },
    evidenceIds: ["evidence-usd-1"],
    updatedAt: now.toISOString(),
  },
  {
    id: "commitment-ignored",
    version: 3,
    status: "NOT_RECURRING",
    merchant: "One-off vendor",
    category: "Other",
    cadence: "IRREGULAR",
    currency: "INR",
    amountMinor: BigInt(50_000),
    monthlyEquivalentMinor: BigInt(50_000),
    nextExpectedDate: "2026-08-12",
    confidenceScore: 80,
    confidenceReasons: ["User correction marks this as not recurring."],
    recommendedDecision: "INVESTIGATE",
    recommendationReason: "Classification was corrected.",
    riskTags: [],
    decision: null,
    evidenceIds: ["evidence-once-1"],
    updatedAt: now.toISOString(),
  },
];

test("Recovery home is an honest first baseline and keeps currency totals separate", () => {
  const home = buildHomeProjection({
    workspace: { id: "workspace-1", name: "Founder workspace", role: "owner", version: 1 },
    generatedAt: now,
    commitments,
    sources: [{
      id: "source-1",
      ingestedAt: now.toISOString(),
      coverageStart: "2026-07-01",
      coverageEnd: "2026-08-09",
      evidenceCount: 4,
    }],
    changed: { state: "NO_PRIOR_BASELINE", fromVersion: null, toVersion: 1, items: [] },
  });

  assert.deepEqual(home.changed, {
    state: "NO_PRIOR_BASELINE",
    fromVersion: null,
    toVersion: 1,
    items: [],
  });
  assert.deepEqual(home.monthlyTotals.map((total) => [total.amount.currency, total.amount.minor]), [
    ["INR", "199900"],
    ["USD", "833"],
  ]);
  assert.deepEqual(home.next30DayTotals.map((total) => [total.amount.currency, total.amount.minor]), [["INR", "199900"]]);
  assert.equal(home.needsMe.some((item) => item.commitmentId === "commitment-inr"), true);
  assert.equal(home.needsMe.some((item) => item.commitmentId === "commitment-ignored"), false);
  assert.deepEqual(home.next.map((item) => item.commitmentId), ["commitment-inr", "commitment-usd"]);
  assert.equal(home.coverage.state, "BASELINE_ONLY");
});

test("Recovery home publishes saved observation facts without fabricating recurrence", () => {
  const home = buildHomeProjection({
    workspace: { id: "workspace-1", name: "Founder workspace", role: "owner", version: 1 },
    generatedAt: now,
    commitments: [],
    observations: [{
      evidenceId: "evidence-once-1",
      merchant: "Figma",
      amountMinor: BigInt(1_499_00),
      currency: "INR",
      date: "2026-08-08",
    }],
    sources: [{
      id: "source-1",
      ingestedAt: now.toISOString(),
      coverageStart: "2026-08-08",
      coverageEnd: "2026-08-08",
      evidenceCount: 1,
    }],
    changed: { state: "NO_PRIOR_BASELINE", fromVersion: null, toVersion: 1, items: [] },
  });

  assert.deepEqual(home.recentObservations, [{
    evidenceId: "evidence-once-1",
    merchant: "Figma",
    amount: { currency: "INR", minor: "149900", exponent: 2, display: "₹1,499.00" },
    date: "2026-08-08",
  }]);
  assert.deepEqual(home.monthlyTotals, []);
  assert.deepEqual(home.next, []);
  assert.deepEqual(home.needsMe, []);
});

test("upcoming items require reminder confidence and suppress KEEP decisions", () => {
  const home = buildHomeProjection({
    workspace: { id: "workspace-1", name: "Founder workspace", role: "owner", version: 1 },
    generatedAt: now,
    commitments,
    sources: [],
    changed: { state: "NO_PRIOR_BASELINE", fromVersion: null, toVersion: 1, items: [] },
  });

  assert.deepEqual(home.next.map((item) => [item.commitmentId, item.reminderEligible]), [
    ["commitment-inr", false],
    ["commitment-usd", false],
  ]);
});

test("Recovery rejects Changed items without reconstructible provenance", () => {
  const invalid = [{
    id: "change-1",
    commitmentId: "commitment-inr",
    merchant: "OpenAI",
    kind: "AMOUNT",
    before: { currency: "INR", minor: "199900", exponent: 2, display: "₹1,999.00" },
    after: { currency: "INR", minor: "209900", exponent: 2, display: "₹2,099.00" },
    detectedAt: now.toISOString(),
    provenance: { kind: "EVIDENCE", submissionId: "submission-1", evidenceIds: [] },
  }] as unknown as ChangeItemDto[];

  assert.throws(() => assertReconstructibleChanges(invalid), /persisted evidence/i);
  assert.throws(() => assertReconstructibleChanges([{
    ...invalid[0],
    provenance: { kind: "CORRECTION", correctionId: "correction-1", evidenceIds: ["old-evidence"] },
  }] as unknown as ChangeItemDto[]), /only its correction/i);
});
