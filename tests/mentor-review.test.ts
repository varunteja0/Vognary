import assert from "node:assert/strict";
import test from "node:test";

import { buildScorecard, findFloorRow, readFounderLedger, type FounderLedger } from "../scripts/mentor-review";

const root = process.cwd();

test("an absent founder ledger makes the unknown row the floor - never a guess", () => {
  const rows = buildScorecard(root, null);
  const validation = rows.find((row) => row.id === "validation");
  const distribution = rows.find((row) => row.id === "distribution");
  assert.equal(validation?.score, null);
  assert.equal(distribution?.score, null);
  assert.match(validation?.nextAction ?? "", /never invents/i);

  const floor = findFloorRow(rows);
  assert.equal(floor.score, null, "an unknown row must be treated as the floor");
});

test("a seeded ledger produces the correct floor row", () => {
  const ledger: FounderLedger = {
    updatedAt: new Date().toISOString().slice(0, 10),
    validation: { score: 2, revenueInr: 0, paidAudits: 0 },
    distribution: { score: 2.5, activeUsers: 0, outreachLast7d: 0 },
    // Block A done + Google review submitted: activation earns its ledger
    // points (4.0) and the floor moves to validation (2.0).
    activation: { blockAComplete: true, googleVerificationSubmitted: true },
  };
  const rows = buildScorecard(root, ledger);
  const activation = rows.find((row) => row.id === "activation");
  assert.ok((activation?.score ?? 0) >= 4, `activation scored ${activation?.score}`);
  const floor = findFloorRow(rows);
  assert.equal(floor.id, "validation");
  assert.equal(floor.score, 2);
});

test("ledger rows never carry invented numbers", () => {
  const ledger: FounderLedger = {
    updatedAt: new Date().toISOString().slice(0, 10),
    validation: { score: 2, revenueInr: null, paidAudits: null },
    distribution: { score: 2.5 },
  };
  const rows = buildScorecard(root, ledger);
  const validation = rows.find((row) => row.id === "validation");
  assert.match(validation?.evidence.join(" ") ?? "", /not recorded/);
  assert.ok(!(validation?.evidence.join(" ") ?? "").match(/revenue INR \d+ ?[1-9]/));
});

test("code rows score from real repo evidence", () => {
  const rows = buildScorecard(root, null);
  const engineering = rows.find((row) => row.id === "engineering");
  const trust = rows.find((row) => row.id === "trust");
  assert.ok((engineering?.score ?? 0) >= 6, `engineering scored ${engineering?.score}`);
  assert.ok((trust?.score ?? 0) >= 6, `trust scored ${trust?.score}`);
  assert.ok(engineering?.evidence.includes("PR CI runs typecheck"));
  for (const row of rows) {
    if (row.missing.length) assert.notEqual(row.nextAction, "", `${row.id} must always name a next action`);
  }
});

test("a stale ledger is flagged, not silently trusted", () => {
  const ledger: FounderLedger = {
    updatedAt: "2026-01-01",
    validation: { score: 2 },
    distribution: { score: 2.5 },
  };
  const rows = buildScorecard(root, ledger);
  assert.equal(rows.find((row) => row.id === "validation")?.stale, true);
});

test("the checked-in scorecard ledger parses", () => {
  const ledger = readFounderLedger(root);
  assert.ok(ledger, "docs/scorecard.json must exist and parse");
  assert.ok(typeof ledger?.validation?.score === "number");
});
