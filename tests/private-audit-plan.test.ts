import assert from "node:assert/strict";
import test from "node:test";

import { buildRedactionFirstSourcePlan } from "../src/lib/private-audit-plan";

test("private audit plan deterministically prefers receipt paste for SaaS evidence", () => {
  const plan = buildRedactionFirstSourcePlan({ paymentTypes: ["AI tools"], sourceTypes: ["Redacted bank/card statement"] });
  assert.equal(plan.title, "Receipt-first plan");
  assert.match(plan.startWith, /receipt or invoice snippets/i);
  assert.ok(plan.remove.includes("Account or customer ID"));
});

test("private audit plan keeps mandate evidence manual and redaction-first", () => {
  const plan = buildRedactionFirstSourcePlan({ paymentTypes: ["UPI AutoPay"], sourceTypes: ["UPI/card mandate screenshot"] });
  assert.equal(plan.title, "Mandate-first plan");
  assert.match(plan.startWith, /do not upload the whole screen/i);
});

