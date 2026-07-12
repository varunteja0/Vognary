import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../src/app/api/audit/route";

test("stateless audit accepts semimonthly commitments supported by the engine", async () => {
  const response = await POST(new Request("https://vognary.example/api/audit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `audit-semimonthly-${Date.now()}`,
    },
    body: JSON.stringify({
      sources: [],
      manualItems: [{
        id: "salary-advance",
        merchant: "Twice Monthly Plan",
        amount: 500,
        frequency: "semimonthly",
        nextExpectedDate: "2026-08-15",
        category: "Productivity",
      }],
      receiptTexts: [],
    }),
  }) as never);

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.audit.recurringItems[0]?.frequency, "semimonthly");
});