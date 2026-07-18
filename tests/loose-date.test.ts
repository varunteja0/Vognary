import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLooseCalendarDate, resolveNumericDateOrder } from "../src/lib/loose-date";

test("strict loose-date parsing rejects impossible calendar dates", () => {
  assert.equal(parseLooseCalendarDate("2026-02-29"), null);
  assert.equal(parseLooseCalendarDate("2024-02-29"), "2024-02-29");
  assert.equal(parseLooseCalendarDate("31/04/2026"), null);
  assert.equal(parseLooseCalendarDate("00/12/2026", "day-first"), null);
});

test("an unambiguous numeric date resolves ambiguous dates source-wide", () => {
  const resolution = resolveNumericDateOrder(["13/06/2026", "07/08/2026", "22/09/2026"]);

  assert.deepEqual(resolution, {
    order: "day-first",
    status: "resolved",
    ambiguousCount: 1,
    invalidCount: 0,
  });
  assert.equal(parseLooseCalendarDate("07/08/2026", resolution.order), "2026-08-07");
});

test("all-ambiguous numeric dates remain unresolved instead of being guessed", () => {
  const resolution = resolveNumericDateOrder(["07/08/2026", "09-10-26"]);

  assert.equal(resolution.status, "ambiguous");
  assert.equal(resolution.order, null);
  assert.equal(resolution.ambiguousCount, 2);
  assert.equal(parseLooseCalendarDate("07/08/2026", resolution.order), null);
});

test("conflicting source-wide numeric orders do not resolve ambiguous rows", () => {
  const resolution = resolveNumericDateOrder(["13/06/2026", "06/13/2026", "07/08/2026"]);

  assert.equal(resolution.status, "conflicting");
  assert.equal(resolution.order, null);
  assert.equal(parseLooseCalendarDate("13/06/2026", resolution.order), "2026-06-13");
  assert.equal(parseLooseCalendarDate("06/13/2026", resolution.order), "2026-06-13");
  assert.equal(parseLooseCalendarDate("07/08/2026", resolution.order), null);
});

test("year-first dates are deterministic with either separator", () => {
  assert.equal(parseLooseCalendarDate("2026-7-3"), "2026-07-03");
  assert.equal(parseLooseCalendarDate("2026/7/3"), "2026-07-03");
});

test("parses month-name dates the way real receipts write them", () => {
  assert.equal(parseLooseCalendarDate("17 July 2026"), "2026-07-17");
  assert.equal(parseLooseCalendarDate("17th Jul 2026"), "2026-07-17");
  assert.equal(parseLooseCalendarDate("July 17, 2026"), "2026-07-17");
  assert.equal(parseLooseCalendarDate("Aug 1 2026"), "2026-08-01");
  assert.equal(parseLooseCalendarDate("1 Sept 2026"), "2026-09-01");
  assert.equal(parseLooseCalendarDate("31 February 2026"), null);
  assert.equal(parseLooseCalendarDate("17 Julember 2026"), null);
});
