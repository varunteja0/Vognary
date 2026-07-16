import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

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

test("stateless audit rejects malformed supplied currency codes", async () => {
    const response = await POST(new NextRequest("http://localhost/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        manualItems: [{
          id: "manual-invalid-currency",
          merchant: "Notion",
          amount: 20,
          currency: "USDX",
          frequency: "monthly",
          nextExpectedDate: "2026-08-01",
          category: "SaaS",
        }],
      }),
    }));

    assert.equal(response.status, 400);
});