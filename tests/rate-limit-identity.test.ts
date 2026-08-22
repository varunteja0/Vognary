import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { getClientIdentity, getRateLimitBackendStatus } from "../src/lib/rate-limit";
import { readSession } from "../src/lib/server/session";

test("Postgres is the shared production rate-limit backend when Upstash is absent", () => {
  const previous = {
    databaseUrl: process.env.DATABASE_URL,
    upstashUrl: process.env.UPSTASH_REDIS_REST_URL,
    upstashToken: process.env.UPSTASH_REDIS_REST_TOKEN,
    redisUrl: process.env.REDIS_URL,
  };
  process.env.DATABASE_URL = "postgresql://vognary.test/shared-rate-limits";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.REDIS_URL;

  try {
    assert.equal(getRateLimitBackendStatus(), "postgres");
  } finally {
    restoreEnv("DATABASE_URL", previous.databaseUrl);
    restoreEnv("UPSTASH_REDIS_REST_URL", previous.upstashUrl);
    restoreEnv("UPSTASH_REDIS_REST_TOKEN", previous.upstashToken);
    restoreEnv("REDIS_URL", previous.redisUrl);
  }
});

test("authenticated requests share a user bucket across changing IP addresses", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "rate-limit-test-secret-at-least-32-bytes";
  try {
    const cookie = signedSessionCookie(process.env.SESSION_SECRET);
    const first = getClientIdentity(new Request("https://vognary.test/api/profile", {
      headers: { cookie, "x-forwarded-for": "203.0.113.1" },
    }));
    const second = getClientIdentity(new Request("https://vognary.test/api/profile", {
      headers: { cookie, "x-forwarded-for": "198.51.100.2" },
    }));
    assert.equal(first, second);
    assert.match(first, /^user:/);
    assert.doesNotMatch(first, /123e4567/);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test("a malformed percent-encoded session cookie does not crash identity", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "rate-limit-test-secret-at-least-32-bytes";
  try {
    const request = new Request("https://vognary.test/api/audit", {
      headers: { cookie: "vognary_session=%zz", "x-forwarded-for": "203.0.113.9" },
    });
    assert.equal(readSession(request), null);
    const identity = getClientIdentity(request);
    assert.match(identity, /^network:/);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test("anonymous requests use privacy-safe network buckets", () => {
  const first = getClientIdentity(new Request("https://vognary.test/api/waitlist", {
    headers: { "x-forwarded-for": "203.0.113.9" },
  }));
  const same = getClientIdentity(new Request("https://vognary.test/api/waitlist", {
    headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
  }));
  const other = getClientIdentity(new Request("https://vognary.test/api/waitlist", {
    headers: { "x-forwarded-for": "203.0.113.10" },
  }));
  assert.equal(first, same);
  assert.notEqual(first, other);
  assert.match(first, /^network:/);
  assert.doesNotMatch(first, /203\.0\.113/);
});

function signedSessionCookie(secret: string) {
  const payload = Buffer.from(JSON.stringify({
    sessionToken: "opaque-test-token",
    userId: "123e4567-e89b-42d3-a456-426614174000",
    workspaceId: "123e4567-e89b-42d3-a456-426614174001",
    issuedAt: Date.now() - 1_000,
    expiresAt: Date.now() + 60_000,
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `vognary_session=${payload}.${signature}`;
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
