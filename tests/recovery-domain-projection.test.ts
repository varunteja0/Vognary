import assert from "node:assert/strict";
import test from "node:test";

import {
  assertReconstructibleChanges,
  buildHomeProjection,
  currencyExponent,
  decimalToMinorUnits,
  hasCitedRecurringSpendPicture,
  minorUnitsToDecimal,
  projectCadenceMonthlyMinor,
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

  assert.throws(() => toMoneyDto("199900", ""));
  assert.throws(() => toMoneyDto("199900", "IN"));
  assert.deepEqual(toMoneyDto("199905", "INR"), {
    currency: "INR",
    minor: "199905",
    exponent: 2,
    display: "₹1,999.05",
  });
  assert.equal(toMoneyDto("1999", "JPY").display, "JP¥1,999");
  assert.match(toMoneyDto("1234", "KWD").display, /1\.234/);
  assert.match(toMoneyDto("150000000", "INR").display, /₹15,00,000\.00/);
  assert.match(toMoneyDto("150000000", "USD").display, /\$1,500,000\.00/);
  assert.doesNotMatch(toMoneyDto("150000000", "USD").display, /15,00,000/);
  const beyondJsSafeInteger = toMoneyDto("9007199254740993", "INR");
  assert.equal(beyondJsSafeInteger.minor, "9007199254740993");
  assert.equal(beyondJsSafeInteger.exponent, 2);

  assert.throws(() => decimalToMinorUnits("1.001", "INR"), /fraction/i);
  assert.throws(() => decimalToMinorUnits("92233720368547758.08", "INR"), /PostgreSQL bigint/i);
});

test("cadence projection uses exact billing-cycle ratios and never projects irregular evidence", () => {
  assert.equal(projectCadenceMonthlyMinor(BigInt(1_200_000), "YEARLY"), BigInt(100_000));
  assert.equal(projectCadenceMonthlyMinor(BigInt(100_000), "QUARTERLY"), BigInt(33_333));
  assert.equal(projectCadenceMonthlyMinor(BigInt(100_000), "WEEKLY"), BigInt(433_333));
  assert.equal(projectCadenceMonthlyMinor(BigInt(5_000_000), "IRREGULAR"), BigInt(0));
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
    factCorrections: [],
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
    factCorrections: [],
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
    factCorrections: [],
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
  assert.deepEqual(home.annualizedEstimateTotals.map((total) => [total.amount.currency, total.amount.minor]), [
    ["INR", "2398800"],
    ["USD", "9996"],
  ]);
  assert.equal(home.annualizedEstimateTotals[0]?.amount.display, "₹23,988.00");
  assert.deepEqual(home.monthlyTotals.map((total) => [total.provenance, total.correctionIds]), [
    ["RECEIPT", []],
    ["RECEIPT", []],
  ]);
  assert.equal(home.activeCommitmentCount, 2);
  assert.equal(home.reviewItemCount, 1);
  assert.equal(hasCitedRecurringSpendPicture(home), true);
  assert.deepEqual(home.confidenceLayers.map((layer) => [layer.layer, layer.commitmentCount, layer.totals.map((total) => [total.amount.currency, total.amount.minor])]), [
    ["CONFIRMED", 1, [["USD", "833"]]],
    ["LIKELY", 1, [["INR", "199900"]]],
  ]);
  assert.deepEqual(home.next30DayTotals.map((total) => [total.amount.currency, total.amount.minor]), [["INR", "199900"]]);
  assert.equal(home.needsMe.some((item) => item.commitmentId === "commitment-inr"), true);
  assert.equal(home.needsMe.some((item) => item.commitmentId === "commitment-ignored"), false);
  assert.deepEqual(home.next.map((item) => item.commitmentId), ["commitment-inr", "commitment-usd"]);
  assert.equal(home.coverage.state, "BASELINE_ONLY");
  assert.deepEqual(home.evidenceSources, []);
  assert.deepEqual(home.possibleOverlaps, []);
});

test("Home publishes possible overlap only for two distinct family members and cites yearly totals from cadence-established amounts", () => {
  const claude: CanonicalCommitmentRecord = {
    ...commitments[0],
    id: "commitment-claude",
    merchant: "Claude",
    amountMinor: BigInt(249_900),
    monthlyEquivalentMinor: BigInt(249_900),
    evidenceIds: ["evidence-claude-1"],
  };
  const home = buildHomeProjection({
    workspace: { id: "workspace-1", name: "Founder workspace", role: "owner", version: 1 },
    generatedAt: now,
    commitments: [commitments[0], claude, commitments[1]],
    sources: [],
    changed: { state: "NO_PRIOR_BASELINE", fromVersion: null, toVersion: 1, items: [] },
  });

  assert.equal(home.possibleOverlaps.length, 1);
  const overlap = home.possibleOverlaps[0];
  assert.equal(overlap?.family, "AI_RESEARCH");
  assert.equal(overlap?.label, "AI / Research");
  assert.deepEqual(overlap?.merchants, ["Claude", "OpenAI"]);
  assert.equal(overlap?.missingPurposeCount, 2);
  assert.equal(overlap?.sharedPurpose, false);
  assert.equal(overlap?.yearlyTotals[0]?.amount.minor, "5397600");
  assert.equal(overlap?.yearlyTotals[0]?.amount.display, "₹53,976.00");
});

test("active commitments with unknown cadence stay upcoming but never inflate monthly or annual totals", () => {
  const irregular: CanonicalCommitmentRecord = {
    ...commitments[0],
    id: "commitment-irregular",
    merchant: "MAX BUPA HEALTH",
    category: "Insurance",
    cadence: "IRREGULAR",
    amountMinor: BigInt(5_000_000),
    monthlyEquivalentMinor: BigInt(5_000_000),
    nextExpectedDate: "2026-08-20",
    confidenceScore: 78,
    confidenceReasons: ["A pre-debit notice provides one dated amount but no recurring cadence."],
    evidenceIds: ["evidence-irregular-1"],
  };
  const home = buildHomeProjection({
    workspace: { id: "workspace-1", name: "Founder workspace", role: "owner", version: 1 },
    generatedAt: now,
    commitments: [commitments[0], irregular],
    sources: [],
    changed: { state: "NO_PRIOR_BASELINE", fromVersion: null, toVersion: 1, items: [] },
  });

  assert.deepEqual(home.monthlyTotals.map((total) => total.amount.minor), ["199900"]);
  assert.deepEqual(home.annualizedEstimateTotals.map((total) => total.amount.minor), ["2398800"]);
  assert.deepEqual(home.next30DayTotals.map((total) => total.amount.minor), ["5199900"]);
  assert.equal(home.unknownCadenceCommitmentCount, 1);
  assert.equal(home.next.some((item) => item.commitmentId === irregular.id), true);
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
  assert.deepEqual(home.annualizedEstimateTotals, []);
  assert.equal(home.activeCommitmentCount, 0);
  assert.equal(home.reviewItemCount, 0);
  assert.equal(hasCitedRecurringSpendPicture(home), false);
  assert.deepEqual(home.next, []);
  assert.deepEqual(home.needsMe, []);
});

test("a representable monthly total stays on Home when the annualized estimate exceeds the display bound", () => {
  const overflowingMonthly = BigInt("768614336404564651");
  const home = buildHomeProjection({
    workspace: { id: "workspace-1", name: "Founder workspace", role: "owner", version: 1 },
    generatedAt: now,
    commitments: [{
      ...commitments[0],
      monthlyEquivalentMinor: overflowingMonthly,
    }],
    sources: [{
      id: "source-1",
      ingestedAt: now.toISOString(),
      coverageStart: "2026-07-01",
      coverageEnd: "2026-08-09",
      evidenceCount: 2,
    }],
    changed: { state: "NO_PRIOR_BASELINE", fromVersion: null, toVersion: 1, items: [] },
  });

  assert.equal(home.monthlyTotals[0]?.amount.minor, overflowingMonthly.toString());
  assert.equal(home.monthlyTotals[0]?.provenance, "RECEIPT");
  assert.deepEqual(home.annualizedEstimateTotals, []);
  assert.equal(home.activeCommitmentCount, 1);
  assert.equal(hasCitedRecurringSpendPicture(home), true);
});

test("Home stays usable when 12 × monthly fits PostgreSQL bigint but exceeds the Intl display bound", () => {
  const monthly = BigInt("80000000000000000");
  const home = buildHomeProjection({
    workspace: { id: "workspace-1", name: "Founder workspace", role: "owner", version: 1 },
    generatedAt: now,
    commitments: [{
      ...commitments[0],
      monthlyEquivalentMinor: monthly,
    }],
    sources: [],
    changed: { state: "NO_PRIOR_BASELINE", fromVersion: null, toVersion: 1, items: [] },
  });

  assert.equal(home.monthlyTotals[0]?.amount.minor, monthly.toString());
  assert.deepEqual(home.annualizedEstimateTotals, []);
});

test("projection totals cite user-correction provenance only for the facts that correction changed", () => {
  const sources = [] as const;
  const changed = { state: "NO_PRIOR_BASELINE" as const, fromVersion: null, toVersion: 1, items: [] as const };
  const workspace = { id: "workspace-1", name: "Founder workspace", role: "owner" as const, version: 1 };

  const nextDateHome = buildHomeProjection({
    workspace,
    generatedAt: now,
    commitments: [{ ...commitments[0], factCorrections: [{ id: "correction-date-1", field: "NEXT_EXPECTED_DATE" }] }],
    sources,
    changed,
  });
  assert.equal(nextDateHome.monthlyTotals[0]?.provenance, "RECEIPT");
  assert.deepEqual(nextDateHome.monthlyTotals[0]?.correctionIds, []);
  assert.equal(nextDateHome.annualizedEstimateTotals[0]?.provenance, "RECEIPT");
  assert.equal(nextDateHome.next30DayTotals[0]?.provenance, "USER_CORRECTED");
  assert.deepEqual(nextDateHome.next30DayTotals[0]?.correctionIds, ["correction-date-1"]);

  const cadenceHome = buildHomeProjection({
    workspace,
    generatedAt: now,
    commitments: [{ ...commitments[0], factCorrections: [{ id: "correction-cadence-1", field: "CADENCE" }] }],
    sources,
    changed,
  });
  assert.equal(cadenceHome.monthlyTotals[0]?.provenance, "USER_CORRECTED");
  assert.equal(cadenceHome.annualizedEstimateTotals[0]?.provenance, "USER_CORRECTED");
  assert.deepEqual(cadenceHome.monthlyTotals[0]?.correctionIds, ["correction-cadence-1"]);
  assert.equal(cadenceHome.next30DayTotals[0]?.provenance, "RECEIPT");
  assert.deepEqual(cadenceHome.next30DayTotals[0]?.correctionIds, []);

  const amountHome = buildHomeProjection({
    workspace,
    generatedAt: now,
    commitments: [
      { ...commitments[0], factCorrections: [{ id: "correction-amount-1", field: "AMOUNT" }] },
      commitments[1],
    ],
    sources,
    changed,
  });
  const inr = amountHome.monthlyTotals.find((total) => total.amount.currency === "INR");
  const usd = amountHome.monthlyTotals.find((total) => total.amount.currency === "USD");
  assert.equal(inr?.provenance, "USER_CORRECTED");
  assert.deepEqual(inr?.correctionIds, ["correction-amount-1"]);
  assert.equal(usd?.provenance, "RECEIPT");
  assert.deepEqual(usd?.correctionIds, []);
  assert.equal(amountHome.annualizedEstimateTotals.find((total) => total.amount.currency === "INR")?.provenance, "USER_CORRECTED");
  assert.equal(amountHome.next30DayTotals[0]?.provenance, "USER_CORRECTED");
  assert.deepEqual(amountHome.next30DayTotals[0]?.correctionIds, ["correction-amount-1"]);

  const merchantHome = buildHomeProjection({
    workspace,
    generatedAt: now,
    commitments: [{ ...commitments[0], factCorrections: [{ id: "correction-merchant-1", field: "MERCHANT" }] }],
    sources,
    changed,
  });
  assert.equal(merchantHome.monthlyTotals[0]?.provenance, "RECEIPT");
  assert.equal(merchantHome.next30DayTotals[0]?.provenance, "RECEIPT");

  const recurringHome = buildHomeProjection({
    workspace,
    generatedAt: now,
    commitments: [
      { ...commitments[0], factCorrections: [{ id: "correction-recurring-1", field: "IS_RECURRING" }] },
      commitments[1],
    ],
    sources,
    changed,
  });
  assert.equal(recurringHome.monthlyTotals.find((total) => total.amount.currency === "INR")?.provenance, "USER_CORRECTED");
  assert.deepEqual(recurringHome.monthlyTotals.find((total) => total.amount.currency === "INR")?.correctionIds, ["correction-recurring-1"]);
  assert.equal(recurringHome.annualizedEstimateTotals.find((total) => total.amount.currency === "INR")?.provenance, "USER_CORRECTED");
  assert.equal(recurringHome.next30DayTotals[0]?.provenance, "USER_CORRECTED");
  assert.deepEqual(recurringHome.next30DayTotals[0]?.correctionIds, ["correction-recurring-1"]);
  assert.equal(recurringHome.monthlyTotals.find((total) => total.amount.currency === "USD")?.provenance, "RECEIPT");

  const reversedHome = buildHomeProjection({
    workspace,
    generatedAt: now,
    commitments: [{
      ...commitments[0],
      factCorrections: [{ id: "correction-amount-reversed", field: "AMOUNT", status: "REVERSED" }],
    }],
    sources,
    changed,
  });
  assert.equal(reversedHome.monthlyTotals[0]?.provenance, "RECEIPT");
  assert.deepEqual(reversedHome.monthlyTotals[0]?.correctionIds, []);
  assert.equal(reversedHome.annualizedEstimateTotals[0]?.provenance, "RECEIPT");
  assert.equal(reversedHome.next30DayTotals[0]?.provenance, "RECEIPT");

  const supersededHome = buildHomeProjection({
    workspace,
    generatedAt: now,
    commitments: [{
      ...commitments[0],
      factCorrections: [
        { id: "correction-amount-old", field: "AMOUNT", status: "SUPERSEDED" },
        { id: "correction-amount-new", field: "AMOUNT", status: "ACTIVE" },
      ],
    }],
    sources,
    changed,
  });
  assert.equal(supersededHome.monthlyTotals[0]?.provenance, "USER_CORRECTED");
  assert.deepEqual(supersededHome.monthlyTotals[0]?.correctionIds, ["correction-amount-new"]);
  assert.deepEqual(supersededHome.next30DayTotals[0]?.correctionIds, ["correction-amount-new"]);
});

test("upcoming reminders accept repeated established evidence and suppress KEEP decisions", () => {
  const home = buildHomeProjection({
    workspace: { id: "workspace-1", name: "Founder workspace", role: "owner", version: 1 },
    generatedAt: now,
    commitments,
    sources: [],
    changed: { state: "NO_PRIOR_BASELINE", fromVersion: null, toVersion: 1, items: [] },
  });

  assert.deepEqual(home.next.map((item) => [item.commitmentId, item.reminderEligible]), [
    ["commitment-inr", true],
    ["commitment-usd", false],
  ]);

  const irregular = buildHomeProjection({
    workspace: { id: "workspace-1", name: "Founder workspace", role: "owner", version: 1 },
    generatedAt: now,
    commitments: [{ ...commitments[0], cadence: "IRREGULAR", confidenceScore: 78 }],
    sources: [],
    changed: { state: "NO_PRIOR_BASELINE", fromVersion: null, toVersion: 1, items: [] },
  });
  assert.equal(irregular.next[0]?.reminderEligible, false);
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

test("unresolved duplicate suspicions are omitted from headline money totals without merging rows", () => {
  const workspace = { id: "workspace-1", name: "Founder workspace", role: "owner", version: 1 } as const;
  const sources = [{
    id: "source-1",
    ingestedAt: now.toISOString(),
    coverageStart: "2026-07-01",
    coverageEnd: "2026-08-09",
    evidenceCount: 4,
  }];
  const changed = { state: "NO_PRIOR_BASELINE" as const, fromVersion: null, toVersion: 1, items: [] as const };
  const duplicateOpenAi: CanonicalCommitmentRecord = {
    ...commitments[0],
    id: "commitment-inr-copy",
    evidenceIds: ["evidence-inr-copy"],
  };

  const uncertain = buildHomeProjection({
    workspace,
    generatedAt: now,
    commitments: [commitments[0], duplicateOpenAi, commitments[1]],
    sources,
    changed,
    duplicateState: {
      unresolvedCommitmentIds: [commitments[0].id, duplicateOpenAi.id],
    },
  });
  assert.equal(uncertain.activeCommitmentCount, 3);
  assert.equal(uncertain.uncertainDuplicateCommitmentCount, 2);
  assert.deepEqual(uncertain.monthlyTotals.map((total) => [total.amount.currency, total.amount.minor]), [["USD", "833"]]);
  assert.deepEqual(uncertain.annualizedEstimateTotals.map((total) => [total.amount.currency, total.amount.minor]), [["USD", "9996"]]);
  assert.ok(uncertain.coverage.limitations[0]?.includes("listed twice"));
  assert.equal(hasCitedRecurringSpendPicture(uncertain), true);
  assert.deepEqual(uncertain.confidenceLayers.map((layer) => [layer.layer, layer.commitmentCount]), [["CONFIRMED", 1]]);

  const allUncertain = buildHomeProjection({
    workspace,
    generatedAt: now,
    commitments: [commitments[0], duplicateOpenAi],
    sources,
    changed,
    duplicateState: {
      unresolvedCommitmentIds: [commitments[0].id, duplicateOpenAi.id],
    },
  });
  assert.deepEqual(allUncertain.monthlyTotals, []);
  assert.deepEqual(allUncertain.annualizedEstimateTotals, []);
  assert.deepEqual(allUncertain.next30DayTotals, []);
  assert.deepEqual(allUncertain.confidenceLayers, []);
  assert.equal(hasCitedRecurringSpendPicture(allUncertain), false);

  const confirmedSame = buildHomeProjection({
    workspace,
    generatedAt: now,
    commitments: [commitments[0], duplicateOpenAi, commitments[1]],
    sources,
    changed,
    duplicateState: {
      confirmedSameGroups: [[commitments[0].id, duplicateOpenAi.id]],
    },
  });
  assert.equal(confirmedSame.uncertainDuplicateCommitmentCount, 0);
  assert.deepEqual(confirmedSame.monthlyTotals.map((total) => [total.amount.currency, total.amount.minor]), [
    ["INR", "199900"],
    ["USD", "833"],
  ]);
});
