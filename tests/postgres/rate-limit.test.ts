import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { rateLimit } from "../../src/lib/rate-limit";
import { getDatabasePool } from "../../src/lib/server/database";

test("Postgres rate limiting is shared, atomic, and privacy-safe", async () => {
  const namespace = `postgres-test-${randomUUID()}`;
  const limit = 5;
  const request = new Request("https://vognary.test/api/audit-intake", {
    headers: { "x-forwarded-for": "203.0.113.22" },
  });

  try {
    const results = await Promise.all(Array.from({ length: 12 }, () => (
      rateLimit(request, { namespace, limit, windowMs: 60_000, requireShared: true })
    )));

    assert.equal(results.filter((result) => result.allowed).length, limit);
    assert.equal(results.filter((result) => !result.allowed).length, 12 - limit);
    assert.ok(results.every((result) => result.backend === "postgres"));
    assert.ok(results.filter((result) => !result.allowed).every((result) => result.blockReason === "limit-exceeded"));

    const rows = await getDatabasePool().query<{ bucket_key: string; request_count: number }>(
      "select bucket_key, request_count from rate_limit_buckets where bucket_key like $1",
      [`rate-limit:${namespace}:%`],
    );
    assert.equal(rows.rowCount, 1);
    assert.equal(rows.rows[0]?.request_count, limit + 1);
    assert.doesNotMatch(rows.rows[0]?.bucket_key ?? "", /203\.0\.113\.22/);
  } finally {
    await getDatabasePool().query("delete from rate_limit_buckets where bucket_key like $1", [`rate-limit:${namespace}:%`]);
  }
});
