import assert from "node:assert/strict";
import { test } from "node:test";

import { convertPdfStatementTextToCsv } from "../src/lib/pdf-statement-text";

test("resolves ambiguous PDF dates from the source-wide numeric order", () => {
  const converted = convertPdfStatementTextToCsv([
    "13/06/2026 NETFLIX SUBSCRIPTION INR 649 DR",
    "07/08/2026 SPOTIFY SUBSCRIPTION INR 119 DR",
  ].join("\n"));

  assert.match(converted.csv, /2026-06-13,"NETFLIX SUBSCRIPTION",649,/);
  assert.match(converted.csv, /2026-08-07,"SPOTIFY SUBSCRIPTION",119,/);
});

test("skips and flags all-ambiguous PDF numeric dates", () => {
  const converted = convertPdfStatementTextToCsv([
    "07/08/2026 NETFLIX SUBSCRIPTION INR 649 DR",
    "09/10/2026 SPOTIFY SUBSCRIPTION INR 119 DR",
  ].join("\n"));

  assert.equal(converted.csv, "Date,Description,Debit,Credit");
  assert.ok(converted.warnings.some((warning) => /Skipped 2 PDF rows.*ambiguous numeric dates/i.test(warning)));
});

test("prefers the explicitly marked transaction amount over a trailing balance", () => {
  const converted = convertPdfStatementTextToCsv("13/07/2026 NETFLIX SUBSCRIPTION INR 649 DR 50,000");

  assert.match(converted.csv, /2026-07-13,"NETFLIX SUBSCRIPTION",649,/);
  assert.doesNotMatch(converted.csv, /50000/);
});

test("skips a multi-amount row when no amount has a debit or credit marker", () => {
  const converted = convertPdfStatementTextToCsv("13/07/2026 NETFLIX SUBSCRIPTION INR 649 50,000");

  assert.equal(converted.csv, "Date,Description,Debit,Credit");
  assert.ok(converted.warnings.some((warning) => /multiple unmarked amounts/i.test(warning)));
});

test("rejects impossible PDF dates rather than rolling them into another month", () => {
  const converted = convertPdfStatementTextToCsv("31/02/2026 NETFLIX SUBSCRIPTION INR 649 DR");

  assert.equal(converted.csv, "Date,Description,Debit,Credit");
  assert.ok(converted.warnings.some((warning) => /invalid calendar date/i.test(warning)));
});

test("does not import a marked trailing balance as the transaction amount", () => {
  const converted = convertPdfStatementTextToCsv("13/07/2026 NETFLIX SUBSCRIPTION 649 50,000 CR");

  assert.equal(converted.csv, "Date,Description,Debit,Credit");
  assert.ok(converted.warnings.some((warning) => /multiple unmarked amounts/i.test(warning)));
});

test("an amount-local DR marker overrides credit-like words in the description", () => {
  const converted = convertPdfStatementTextToCsv("13/07/2026 CREDIT CARD NETFLIX INR 649 DR");

  assert.match(converted.csv, /2026-07-13,"CREDIT CARD NETFLIX",649,/);
});
