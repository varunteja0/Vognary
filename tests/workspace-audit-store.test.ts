import assert from "node:assert/strict";
import test from "node:test";
import { extractEvidence } from "../src/lib/server/workspace-audit-store";

test("a missing or malformed snapshot degrades to empty evidence, never a throw", () => {
  for (const bad of [null, undefined, 42, "x", [], { statementSources: "no" }]) {
    const evidence = extractEvidence(bad);
    assert.deepEqual(evidence, { statementSources: [], manualItems: [], receiptText: "" });
  }
});

test("valid evidence passes through and invalid statement sources are dropped", () => {
  const evidence = extractEvidence({
    statementSources: [
      { name: "a.csv", text: "Date,Description\n2026-07-01,X" },
      { name: "missing-text" }, // invalid → dropped
      { text: "missing-name" }, // invalid → dropped
    ],
    manualItems: [{ id: "m1", merchant: "M", amount: 100, frequency: "monthly", nextExpectedDate: "2026-08-01", category: "X" }],
    receiptText: "some receipt",
  });

  assert.equal(evidence.statementSources.length, 1, "only the complete source survives");
  assert.equal(evidence.statementSources[0].name, "a.csv");
  assert.equal(evidence.manualItems.length, 1);
  assert.equal(evidence.receiptText, "some receipt");
});
