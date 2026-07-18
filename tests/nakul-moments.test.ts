import assert from "node:assert/strict";
import test from "node:test";
import { selectNakulMoment, type NakulMomentId, type NakulMomentSignals } from "../src/lib/nakul-moments";

const allSignals: NakulMomentSignals = {
  firstSync: true,
  savingsMinted: true,
  budgetBreach: true,
  firstEvidence: true,
};

test("Nakul moments follow first-sync, savings, budget, evidence priority", () => {
  assert.equal(selectNakulMoment(allSignals)?.id, "first-sync");
  assert.equal(selectNakulMoment(allSignals, new Set<NakulMomentId>(["first-sync"]))?.id, "savings-minted");
  assert.equal(selectNakulMoment(allSignals, new Set<NakulMomentId>(["first-sync", "savings-minted"]))?.id, "budget-breach");
  assert.equal(selectNakulMoment(allSignals, new Set<NakulMomentId>(["first-sync", "savings-minted", "budget-breach"]))?.id, "first-evidence");
});

test("Nakul stays quiet when no unseen event is active", () => {
  assert.equal(selectNakulMoment({ firstSync: false, savingsMinted: false, budgetBreach: false, firstEvidence: false }), null);
  assert.equal(selectNakulMoment(allSignals, new Set<NakulMomentId>(["first-sync", "savings-minted", "budget-breach", "first-evidence"])), null);
});