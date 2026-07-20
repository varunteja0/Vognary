import assert from "node:assert/strict";
import { test } from "node:test";
import { renderCitedText, validateCited, type Claim } from "../src/lib/server/ai/citations";
import { reconcileExtraction } from "../src/lib/server/ai/reconcile";
import { evaluateBudget } from "../src/lib/server/ai/budget";

test("citation guardrail keeps only claims whose evidence resolves", () => {
  const valid = ["ev_1", "ev_2", "ev_3"];
  const claims: Claim[] = [
    { text: "Netflix renews on the 6th for ₹649.", citedIds: ["ev_1"] },
    { text: "Your spend will double next year.", citedIds: [] }, // no citation → drop
    { text: "You paid AWS $20.", citedIds: ["ev_hallucinated"] }, // bad citation → drop
    { text: "Two sources confirm the ₹1999 charge.", citedIds: ["ev_2", "ev_3"] },
  ];
  const check = validateCited(claims, valid);

  assert.equal(check.ok, false, "something was dropped");
  assert.equal(check.cited.length, 2);
  assert.equal(check.dropped.length, 2);
  assert.deepEqual(check.cited.map((claim) => claim.text), [
    "Netflix renews on the 6th for ₹649.",
    "Two sources confirm the ₹1999 charge.",
  ]);

  const rendered = renderCitedText(check);
  assert.ok(rendered.includes("Netflix") && rendered.includes("1999"));
  assert.ok(!rendered.includes("double"), "an uncited claim never reaches the user");
});

test("citation guardrail passes fully-cited output through unchanged", () => {
  const check = validateCited([{ text: "A", citedIds: ["ev_1"] }], ["ev_1"]);
  assert.equal(check.ok, true);
  assert.equal(check.dropped.length, 0);
});

test("a partly-hallucinated multi-citation claim is dropped as a whole", () => {
  const check = validateCited([{ text: "X", citedIds: ["ev_1", "ev_bad"] }], ["ev_1"]);
  assert.equal(check.cited.length, 0, "one bad citation taints the whole claim");
  assert.equal(check.dropped.length, 1);
});

test("extraction reconciles against the parsed total when the sum matches", () => {
  const match = reconcileExtraction(
    [{ description: "A", amount: 649 }, { description: "B", amount: 1999 }],
    2648,
  );
  assert.equal(match.status, "accepted");
  assert.equal(match.extractedTotal, 2648);
  assert.equal(match.difference, 0);
});

test("a fabricated line item fails reconciliation and degrades to needs-review", () => {
  const bad = reconcileExtraction(
    [{ description: "A", amount: 649 }, { description: "phantom", amount: 5000 }],
    649,
  );
  assert.equal(bad.status, "needs-review", "the model invented ₹5000 not in the document total");
  assert.ok(Math.abs(bad.difference - 5000) < 0.01);
});

test("reconciliation tolerates rounding within the greater of ₹1 or 1%", () => {
  assert.equal(reconcileExtraction([{ description: "A", amount: 999.5 }], 1000).status, "accepted", "₹0.50 rounding");
  assert.equal(reconcileExtraction([{ description: "A", amount: 9950 }], 10000).status, "accepted", "₹50 on ₹10000 is <1%");
  assert.equal(reconcileExtraction([{ description: "A", amount: 9800 }], 10000).status, "needs-review", "₹200 on ₹10000 exceeds tolerance");
});

test("budget cap allows under the cap and degrades over it", () => {
  assert.equal(evaluateBudget({ spent: 100, cap: 1000 }, 50).allowed, true);

  const wouldExceed = evaluateBudget({ spent: 980, cap: 1000 }, 50);
  assert.equal(wouldExceed.allowed, false);
  assert.equal(wouldExceed.reason, "cap-would-exceed");

  const exhausted = evaluateBudget({ spent: 1000, cap: 1000 }, 1);
  assert.equal(exhausted.allowed, false);
  assert.equal(exhausted.reason, "cap-exceeded");

  assert.equal(evaluateBudget({ spent: 0, cap: 0 }, 1).allowed, false, "a zero cap means AI is off");
});
