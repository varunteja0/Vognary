import assert from "node:assert/strict";
import test from "node:test";
import { calendarDateInTimeZone, projectProposalExposure } from "../src/lib/commitment-control/project";

test("anchors India-first proposal dates to the Asia/Kolkata calendar", () => {
  assert.equal(calendarDateInTimeZone(new Date("2026-08-24T18:29:59.999Z"), "Asia/Kolkata"), "2026-08-24");
  assert.equal(calendarDateInTimeZone(new Date("2026-08-24T18:30:00.000Z"), "Asia/Kolkata"), "2026-08-25");
  assert.throws(() => calendarDateInTimeZone(new Date("invalid"), "Asia/Kolkata"), /valid instant/i);
});

test("projects exact minor units across 13-week and annual windows with month-end anchoring", () => {
  const projection = projectProposalExposure(
    [{
      proposalId: "proposal-cursor",
      amountMinor: "9007199254740993",
      currency: "INR",
      firstChargeDate: "2026-01-31",
      cadence: "MONTHLY",
    }],
    { asOfDate: "2026-01-01" },
  );

  assert.deepEqual(projection.totalsByCurrency, [{
    currency: "INR",
    thirteenWeekMinor: "27021597764222979",
    annualMinor: "108086391056891916",
  }]);
  assert.equal(projection.proposals[0].basis, "USER_ENTERED_ASSUMPTION");
  assert.deepEqual(
    projection.proposals[0].occurrences.map((occurrence) => occurrence.date),
    [
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
      "2026-07-31",
      "2026-08-31",
      "2026-09-30",
      "2026-10-31",
      "2026-11-30",
      "2026-12-31",
    ],
  );
});

test("keeps currencies separate and normalizes three-letter currency codes", () => {
  const projection = projectProposalExposure(
    [
      {
        proposalId: "proposal-hosting",
        amountMinor: "500000",
        currency: "inr",
        firstChargeDate: "2026-08-25",
        cadence: "QUARTERLY",
      },
      {
        proposalId: "proposal-model",
        amountMinor: "25000",
        currency: " usd ",
        firstChargeDate: "2026-09-01",
        cadence: "ONE_TIME",
      },
    ],
    { asOfDate: "2026-08-25" },
  );

  assert.deepEqual(projection.totalsByCurrency, [
    { currency: "INR", thirteenWeekMinor: "500000", annualMinor: "2000000" },
    { currency: "USD", thirteenWeekMinor: "25000", annualMinor: "25000" },
  ]);
  assert.equal(projection.proposals[1].basis, "USER_ENTERED_ASSUMPTION");
});

test("fails closed for invalid proposal assumptions and exact-total overflow", () => {
  const valid = {
    proposalId: "proposal-valid",
    amountMinor: "100",
    currency: "INR",
    firstChargeDate: "2026-09-01",
    cadence: "MONTHLY" as const,
  };

  assert.throws(
    () => projectProposalExposure([{ ...valid, amountMinor: "0" }], { asOfDate: "2026-08-25" }),
    /positive canonical decimal string/i,
  );
  assert.throws(
    () => projectProposalExposure([{ ...valid, firstChargeDate: "2026-02-30" }], { asOfDate: "2026-08-25" }),
    /calendar date/i,
  );
  assert.throws(
    () => projectProposalExposure([{ ...valid, firstChargeDate: "2026-08-24" }], { asOfDate: "2026-08-25" }),
    /before the projection date/i,
  );
  assert.throws(
    () => projectProposalExposure([{ ...valid, cadence: "IRREGULAR" as never }], { asOfDate: "2026-08-25" }),
    /cadence/i,
  );
  assert.throws(
    () => projectProposalExposure([{ ...valid, currency: "ZZZ" }], { asOfDate: "2026-08-25" }),
    /currency/i,
  );
  assert.throws(
    () => projectProposalExposure([{
      ...valid,
      amountMinor: "9223372036854775807",
      firstChargeDate: "2026-08-25",
    }], { asOfDate: "2026-08-25" }),
    /exceeds PostgreSQL bigint/i,
  );
});