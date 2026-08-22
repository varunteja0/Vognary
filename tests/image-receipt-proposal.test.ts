import assert from "node:assert/strict";
import test from "node:test";

import { proposeReceiptLineFromReadableText } from "../src/lib/recovery/image-receipt-proposal";
import { POST } from "../src/app/api/receipt-image/propose/route";

test("readable receipt text prefills confirm-the-line without inventing a cadence", () => {
  const proposal = proposeReceiptLineFromReadableText("OpenAI invoice paid INR 1,999.00 on 2026-07-06.");
  assert.deepEqual(proposal, {
    merchant: "OpenAI",
    amount: "1999.00",
    currency: "INR",
    date: "2026-07-06",
  });
  assert.equal(proposeReceiptLineFromReadableText("a blurry photo of something"), null);
  assert.equal(proposeReceiptLineFromReadableText("OpenAI subscription"), null);
});

test("receipt-image propose stays fail-closed on an unreadable raster", async () => {
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
    "hex",
  );
  const body = new FormData();
  body.append("file", new File([png], "blur.png", { type: "image/png" }));
  const response = await POST(new Request("https://vognary.example/api/receipt-image/propose", {
    method: "POST",
    headers: { "x-forwarded-for": `receipt-image-${Date.now()}` },
    body,
  }) as never);
  assert.equal(response.status, 200);
  const payload = await response.json() as { proposal: null; reason: string };
  assert.equal(payload.proposal, null);
  assert.equal(payload.reason, "unreadable");
});

test("receipt-image propose reads a mislabeled text receipt", async () => {
  const body = new FormData();
  body.append("file", new File(
    ["Cursor invoice paid USD 20.00 on 2026-08-28.\n"],
    "cursor.png",
    { type: "image/png" },
  ));
  const response = await POST(new Request("https://vognary.example/api/receipt-image/propose", {
    method: "POST",
    headers: { "x-forwarded-for": `receipt-image-text-${Date.now()}` },
    body,
  }) as never);
  assert.equal(response.status, 200);
  const payload = await response.json() as { proposal: { merchant: string; amount: string; currency: string; date: string } };
  assert.deepEqual(payload.proposal, {
    merchant: "Cursor",
    amount: "20.00",
    currency: "USD",
    date: "2026-08-28",
  });
});
