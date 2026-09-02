import assert from "node:assert/strict";
import test from "node:test";
import { annotateLandingPolicy } from "../src/lib/landing-desk-policy";

test("the example Cursor increase is review, not a frozen authorization", () => {
  const annotation = annotateLandingPolicy({
    usingExample: true,
    proposedAmountInr: 1700,
    citedPriorInr: 1350,
  });
  assert.equal(annotation.status, "Review required");
  assert.match(annotation.reason, /INR 350 higher/);
  assert.doesNotMatch(annotation.reason, /auto-approve|purchase|move money/i);
});

test("an uncited typed vendor cannot invent exposure", () => {
  const annotation = annotateLandingPolicy({
    usingExample: false,
    proposedAmountInr: 9_000,
    citedPriorInr: 1350,
  });
  assert.equal(annotation.status, "Review required");
  assert.match(annotation.reason, /EXPOSURE_NOT_CITED/);
  assert.doesNotMatch(annotation.reason, /within policy|₹9,000 already spent/i);
});
