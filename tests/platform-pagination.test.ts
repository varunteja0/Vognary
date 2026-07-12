import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  decodePlatformLedgerCursor,
  encodePlatformLedgerCursor,
  normalizePlatformPageLimit,
} from "../src/lib/platform-pagination";

test("platform page limits are bounded", () => {
  assert.equal(normalizePlatformPageLimit(null), 100);
  assert.equal(normalizePlatformPageLimit("200"), 200);
  assert.throws(() => normalizePlatformPageLimit("0"), /1 to 200/);
  assert.throws(() => normalizePlatformPageLimit("201"), /1 to 200/);
  assert.throws(() => normalizePlatformPageLimit("1.5"), /integer/);
});

test("platform cursors round-trip only nullable UUID positions", () => {
  const cursor = {
    recurringAfter: "123e4567-e89b-42d3-a456-426614174001",
    decisionsAfter: "123e4567-e89b-42d3-a456-426614174002",
  };
  assert.deepEqual(decodePlatformLedgerCursor(encodePlatformLedgerCursor(cursor)), cursor);
  assert.throws(() => decodePlatformLedgerCursor(Buffer.from('{"recurringAfter":"merchant"}').toString("base64url")), /invalid/);
});

test("OpenAPI publishes bounded ledger pagination and continuation metadata", () => {
  const contract = readFileSync(new URL("../docs/api/openapi.yaml", import.meta.url), "utf8");
  assert.match(contract, /name: limit[\s\S]*maximum: 200/);
  assert.match(contract, /name: cursor/);
  assert.match(contract, /required: \[limit, hasMore, nextCursor\]/);
});