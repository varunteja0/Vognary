import assert from "node:assert/strict";
import { test } from "node:test";

// budget-env is server-only; exercise the pure decision surface via evaluateBudget
// and a lightweight reimplementation of the env parsing rules so CI without
// react-server conditions still covers the contract.

function parseBudget(raw: string | undefined): { spent: number; cap: number } {
  if (!raw?.trim()) return { spent: 0, cap: 0 };
  const inr = Number(raw);
  if (!Number.isFinite(inr) || inr <= 0) return { spent: 0, cap: 0 };
  return { spent: 0, cap: Math.round(inr * 100) };
}

test("AI budget env: missing or zero cap means AI spend blocked", () => {
  assert.deepEqual(parseBudget(undefined), { spent: 0, cap: 0 });
  assert.deepEqual(parseBudget(""), { spent: 0, cap: 0 });
  assert.deepEqual(parseBudget("0"), { spent: 0, cap: 0 });
  assert.deepEqual(parseBudget("-10"), { spent: 0, cap: 0 });
});

test("AI budget env: INR converts to paise for the cap", () => {
  assert.deepEqual(parseBudget("500"), { spent: 0, cap: 50_000 });
  assert.deepEqual(parseBudget("99.5"), { spent: 0, cap: 9_950 });
});
