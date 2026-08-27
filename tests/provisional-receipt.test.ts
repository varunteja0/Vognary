import assert from "node:assert/strict";
import test from "node:test";

import { manualsFromReceiptText } from "../src/lib/recovery/first-session-receipts";
import {
  observationIdentityKey,
  orphanReceiptsNotCoveredByCommitments,
  provisionalManualFromSingleReceipt,
  provisionalManualsFromOrphans,
  PROVISIONAL_RISK_TAG,
  PROVISIONAL_SINGLE_REASON,
  type OrphanReceiptObservation,
} from "../src/lib/recovery/provisional-receipt";

const cursor: OrphanReceiptObservation = {
  id: "evidence-cursor",
  merchant: "Cursor",
  normalizedMerchant: "Cursor",
  amountDecimal: "20.00",
  amount: 20,
  currency: "USD",
  observedDate: "2026-08-15",
  excerpt: "Cursor Pro · $20.00 · Aug 15.",
  sourceName: "pasted receipt",
  category: "AI tools",
};

test("one named receipt is enough to hypothesize the next monthly date", () => {
  const manual = provisionalManualFromSingleReceipt(cursor, "2026-08-22");
  assert.ok(manual);
  assert.equal(manual?.provisional, true);
  assert.equal(manual?.nextExpectedDate, "2026-09-15");
  assert.equal(manual?.frequency, "monthly");
  assert.match(manual?.evidenceDescription ?? "", /Cursor Pro/);
});

test("a future observed date is the next charge, not a past payment plus one month", () => {
  const upcoming = provisionalManualFromSingleReceipt({
    ...cursor,
    id: "evidence-x",
    merchant: "X.com",
    normalizedMerchant: "X.com",
    amountDecimal: "427.00",
    amount: 427,
    currency: "INR",
    observedDate: "2026-09-20",
    excerpt: "X.com next billing INR 427 on 2026-09-20.",
  }, "2026-08-27");
  assert.equal(upcoming?.nextExpectedDate, "2026-09-20");
});

test("a merchant already covered by a commitment is not turned into a second provisional item", () => {
  const orphans = orphanReceiptsNotCoveredByCommitments(
    [cursor, { ...cursor, id: "second", observedDate: "2026-09-28" }],
    new Set(),
  );
  assert.equal(orphans.length, 0);
  const extras = provisionalManualsFromOrphans([cursor], new Set([observationIdentityKey(cursor)]), "2026-08-22");
  assert.equal(extras.length, 0);
});

test("a pasted observed charge without renewal language still becomes a provisional manual", () => {
  const manuals = manualsFromReceiptText("Cursor Pro paid USD 20.00 on 15 August 2026.", "pasted receipt", "2026-08-22");
  assert.ok(manuals.length >= 1);
  const cursorItem = manuals.find((item) => /cursor/i.test(item.merchant));
  assert.ok(cursorItem);
  assert.equal(cursorItem?.provisional, true);
  assert.equal(cursorItem?.nextExpectedDate, "2026-09-15");
});

test("a pasted future paid date is treated as the next charge", () => {
  const manuals = manualsFromReceiptText("Cursor Pro paid USD 20.00 on 28 August 2026.", "pasted receipt", "2026-08-22");
  const cursorItem = manuals.find((item) => /cursor/i.test(item.merchant));
  assert.equal(cursorItem?.nextExpectedDate, "2026-08-28");
});

test("provisional copy never claims a proven cadence", () => {
  assert.match(PROVISIONAL_SINGLE_REASON, /hypothesis/);
  assert.match(PROVISIONAL_RISK_TAG, /provisional/);
});
