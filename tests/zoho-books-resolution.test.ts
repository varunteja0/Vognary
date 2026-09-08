import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBillDisposition } from "../src/lib/zoho-books/resolution";

const input = { billId: "200001", sourceSequence: "2", expectedLatestSequence: "2", expectedVersion: "0", idempotencyKey: "synthetic-disposition-1", kind: "FOLLOW_UP", note: "Ask the synthetic supplier to explain the amendment.", followUpOn: "2026-09-10" };

test("bill dispositions require an exact revision and human explanation without re-entered money", () => {
  assert.deepEqual(normalizeBillDisposition(input), input);
  for (const changed of [{ note: " " }, { sourceSequence: "0" }, { kind: "PAID" }, { followUpOn: null }, { followUpOn: "2026-02-30" }, { totalMinor: "50000" }, { note: "x".repeat(2001) }, { expectedVersion: "-1" }]) {
    assert.throws(() => normalizeBillDisposition({ ...input, ...changed }));
  }
  assert.equal(normalizeBillDisposition({ ...input, kind: "RESOLVED", followUpOn: null }).kind, "RESOLVED");
  assert.throws(() => normalizeBillDisposition({ ...input, kind: "RESOLVED" }));
});
