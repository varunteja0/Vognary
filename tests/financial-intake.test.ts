import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as ingest } from "../src/app/api/ingest/route";
import { POST as image } from "../src/app/api/receipt-image/propose/route";

for (const [name, route] of [["statement extraction", ingest], ["receipt image proposal", image]] as const) {
  test(`uncleared guest ${name} is refused before reading file input`, async () => {
    const form = new FormData();
    const file = new File(["Date,Description,Debit\n2026-09-01,Synthetic supplier,120"], "synthetic.csv", { type: "text/csv" });
    form.set("files", file);
    form.set("file", file);
    const request = new NextRequest("http://localhost/api/intake", { method: "POST", headers: { origin: "http://localhost", "x-forwarded-for": name === "statement extraction" ? "192.0.2.190" : "192.0.2.191" }, body: form });
    const response = await route(request);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "FINANCIAL_INTAKE_LOCKED");
    assert.equal(request.bodyUsed, false);
  });
}
