import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGuestAuditSnapshot,
  guestAuditTransferMaxBytes,
  guestAuditTransferTtlMs,
  mergeGuestAuditSnapshot,
  parseGuestAuditSnapshot,
} from "../src/lib/guest-audit-transfer";

test("guest audit transfer rejects malformed state", () => {
  assert.equal(parseGuestAuditSnapshot("not json"), null);
  assert.equal(parseGuestAuditSnapshot(JSON.stringify({ version: 1 })), null);
  assert.equal(parseGuestAuditSnapshot(JSON.stringify({ version: 2, statementSources: [], manualItems: [] })), null);
});

test("guest audit transfer preserves receipt and statement evidence without duplication", () => {
  const exportedAt = new Date("2026-07-13T10:00:00.000Z");
  const guest = buildGuestAuditSnapshot({
    receiptText: "OpenAI invoice INR 1,999. Renews monthly.",
    statementSources: [{ id: "guest-one", name: "one.csv", text: "Date,Description,Debit\n2026-01-01,OPENAI,1999", rowCount: 1, kind: "csv" }],
    manualItems: [],
  }, exportedAt);
  const parsed = parseGuestAuditSnapshot(JSON.stringify(guest), new Date(exportedAt.getTime() + 1_000));
  assert.ok(parsed);
  assert.equal(parsed.exportedAt, exportedAt.toISOString());

  const merged = mergeGuestAuditSnapshot({
    ...guest,
    statementSources: [{ ...guest.statementSources[0], id: "already-saved" }],
  }, parsed);

  assert.equal(merged.statementSources.length, 1);
  assert.equal(merged.receiptText, guest.receiptText);
  assert.deepEqual(merged.manualItems, []);
});

test("guest audit transfer expires and rejects oversized or over-count state", () => {
  const exportedAt = new Date("2026-07-13T10:00:00.000Z");
  const guest = buildGuestAuditSnapshot({ receiptText: "Receipt", statementSources: [], manualItems: [] }, exportedAt);
  const serialized = JSON.stringify(guest);

  assert.ok(parseGuestAuditSnapshot(serialized, new Date(exportedAt.getTime() + guestAuditTransferTtlMs)));
  assert.equal(parseGuestAuditSnapshot(serialized, new Date(exportedAt.getTime() + guestAuditTransferTtlMs + 1)), null);
  assert.equal(parseGuestAuditSnapshot("x".repeat(guestAuditTransferMaxBytes + 1), exportedAt), null);

  const tooManyManualItems = {
    ...guest,
    manualItems: Array.from({ length: 201 }, (_, index) => ({
      id: `manual-${index}`,
      merchant: `Merchant ${index}`,
      amount: 100,
      frequency: "monthly",
      nextExpectedDate: "2026-08-01",
    })),
  };
  assert.equal(parseGuestAuditSnapshot(JSON.stringify(tooManyManualItems), exportedAt), null);

  const malformedSource = { ...guest, statementSources: [{ id: "source", name: "statement.csv", text: "Date,Description,Debit", rowCount: -1 }] };
  assert.equal(parseGuestAuditSnapshot(JSON.stringify(malformedSource), exportedAt), null);
});

