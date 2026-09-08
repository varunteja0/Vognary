import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST } from "../src/app/api/audit/route";

test("uncleared guests cannot submit arbitrary financial text or assumptions", async () => {
  for (const [index, body] of [
    { receiptTexts: ["Synthetic supplier invoice INR 110.00 on 2026-09-01"] },
    { sources: [{ name: "Synthetic statement", text: "2026-09-01, Synthetic supplier, 110.00" }] },
    { manualItems: [{ id: "synthetic", merchant: "Synthetic supplier", amount: 110, frequency: "monthly", nextExpectedDate: "2026-10-01", category: "SaaS", currency: "INR" }] },
    { fixture: "SUPPLIER_BILL_DEMO_V1", receiptTexts: ["Synthetic arbitrary extra bill INR 111"] },
  ].entries()) {
    const response = await POST(new NextRequest("http://localhost/api/audit", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", "x-forwarded-for": `192.0.2.${180 + index}` }, body: JSON.stringify(body) }));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "FINANCIAL_INTAKE_LOCKED");
  }
});

test("guest demonstration uses only a fixed server-owned fixture", async () => {
  const response = await POST(new NextRequest("http://localhost/api/audit", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.185" }, body: JSON.stringify({ fixture: "SUPPLIER_BILL_DEMO_V1" }) }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.mode, "fixed-synthetic-demo");
  assert.equal(payload.fixture, "SUPPLIER_BILL_DEMO_V1");
  assert.ok(payload.cards.length > 0);
});

test("stateless audit refuses guest manual commitments even when supported by the engine", async () => {
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

  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "FINANCIAL_INTAKE_LOCKED");
});

test("stateless audit refuses guest receipt text before deriving cards", async () => {
  const response = await POST(new Request("https://vognary.example/api/audit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `audit-cards-${Date.now()}`,
    },
    body: JSON.stringify({
      sources: [],
      manualItems: [],
      receiptTexts: ["Cursor invoice paid USD 20.00 on 2026-08-28."],
    }),
  }) as never);

  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.equal(payload.code, "FINANCIAL_INTAKE_LOCKED");
  assert.equal(payload.cards, undefined);
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

test("stateless audit rejects malformed envelopes and entries before parsing", async (context) => {
  const malformedBodies: unknown[] = [
    null,
    [],
    false,
    7,
    "receipt",
    { sources: null },
    { sources: "statement" },
    { sources: [null] },
    { sources: [false] },
    { sources: [{ name: "Synthetic statement", text: 123 }] },
    { sources: [{ name: { label: "Synthetic statement" }, text: "text" }] },
    { manualItems: {} },
    { manualItems: [null] },
    { manualItems: [false] },
    { manualItems: [0] },
    { receiptTexts: null },
    { receiptTexts: "receipt" },
    { receiptTexts: [null] },
  ];

  for (const [index, body] of malformedBodies.entries()) {
    await context.test(`malformed shape ${index + 1}`, async () => {
      const response = await POST(new NextRequest("http://localhost/api/audit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": `192.0.2.${index + 1}`,
        },
        body: JSON.stringify(body),
      }));

      assert.equal(response.status, 400);
      assert.equal(typeof (await response.json()).error, "string");
    });
  }
});

test("stateless audit still accepts an explicitly empty valid envelope", async () => {
  const response = await POST(new NextRequest("http://localhost/api/audit", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.100" },
    body: JSON.stringify({ sources: [], manualItems: [], receiptTexts: [] }),
  }));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).storage, "none");
});