import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCurrency, formatMinorCurrency } from "../src/app/workspace/format";

// India-first invariant guard. formatCurrency drives ~86 money surfaces in the
// workspace shell yet had no test before it was extracted from the monolith.
// These assertions pin the behaviour THE-LAW requires: INR in the Indian
// numbering system (lakh grouping) with the ₹ symbol, everything else in Western
// grouping — so a future refactor cannot silently Westernise rupee display.

test("formatCurrency groups INR in the Indian (lakh) system with ₹", () => {
  const formatted = formatCurrency(150000, "INR");
  assert.ok(formatted.includes("₹"), `expected ₹ symbol, got ${formatted}`);
  // 1,50,000 — Indian grouping (3;2;2), NOT the Western 150,000.
  assert.ok(formatted.includes("1,50,000"), `expected lakh grouping, got ${formatted}`);
  assert.ok(!formatted.includes("150,000"), `must not use Western grouping, got ${formatted}`);
});

test("formatCurrency defaults to INR when currency is omitted", () => {
  assert.equal(formatCurrency(2500), formatCurrency(2500, "INR"));
});

test("formatCurrency shows whole units only (no paise) for recurring figures", () => {
  const formatted = formatCurrency(1234.56, "INR");
  assert.ok(!formatted.includes("."), `expected no decimals, got ${formatted}`);
});

test("formatCurrency keeps non-INR currencies in Western grouping", () => {
  const formatted = formatCurrency(1500000, "USD");
  assert.ok(formatted.includes("1,500,000"), `expected Western grouping, got ${formatted}`);
  assert.ok(!formatted.includes("15,00,000"), `must not apply lakh grouping to USD, got ${formatted}`);
});

test("formatMinorCurrency divides minor units by 100 and keeps two fraction digits", () => {
  const formatted = formatMinorCurrency(123456, "INR");
  assert.ok(formatted.includes("1,234.56"), `expected paise-precise rupees, got ${formatted}`);
});
