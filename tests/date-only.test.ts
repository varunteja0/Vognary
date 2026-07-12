import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCalendarDate, parseCalendarDate, parseIsoDateOnly } from "../src/lib/date-only";

test("ISO financial dates remain the same calendar day in western time zones", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    const parsed = parseCalendarDate("2026-01-02");
    assert.ok(parsed);
    assert.equal(parsed.getFullYear(), 2026);
    assert.equal(parsed.getMonth(), 0);
    assert.equal(parsed.getDate(), 2);
    assert.equal(formatCalendarDate(parsed), "2026-01-02");
  } finally {
    process.env.TZ = previous;
  }
});

test("date-only parsing rejects impossible calendar dates", () => {
  assert.equal(parseIsoDateOnly("2026-02-29"), null);
  assert.equal(parseIsoDateOnly("2024-02-29") instanceof Date, true);
});
