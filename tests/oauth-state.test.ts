import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeOAuthReturnPath } from "../src/lib/oauth-state";
import { createOAuthSessionBinding, verifyOAuthSessionBinding } from "../src/lib/server/oauth-session-binding";
import type { AuthSession } from "../src/lib/server/session";

test("OAuth continuation accepts only same-origin relative product paths", () => {
  assert.equal(sanitizeOAuthReturnPath("/app"), "/app");
  assert.equal(sanitizeOAuthReturnPath("/app?guest=1"), "/app?guest=1");
  assert.equal(sanitizeOAuthReturnPath("https://attacker.example"), "/app");
  assert.equal(sanitizeOAuthReturnPath("//attacker.example/path"), "/app");
  assert.equal(sanitizeOAuthReturnPath("/login"), "/app");
});

test("OAuth session binding rejects account, workspace, token, purpose, and expiry changes", () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "oauth-binding-test-secret-with-sufficient-entropy";
  const now = Date.parse("2026-07-13T10:00:00.000Z");
  const session: AuthSession = {
    sessionToken: "session-a",
    userId: "11111111-1111-4111-8111-111111111111",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    issuedAt: now - 1_000,
    expiresAt: now + 60_000,
    email: "owner@example.com",
  };

  try {
    const binding = createOAuthSessionBinding(session, "gmail-readonly", now);
    assert.equal(verifyOAuthSessionBinding(binding, session, "gmail-readonly", now + 1), true);
    assert.equal(verifyOAuthSessionBinding(binding, { ...session, userId: "33333333-3333-4333-8333-333333333333" }, "gmail-readonly", now + 1), false);
    assert.equal(verifyOAuthSessionBinding(binding, { ...session, workspaceId: undefined }, "gmail-readonly", now + 1), false);
    assert.equal(verifyOAuthSessionBinding(binding, { ...session, sessionToken: "session-b" }, "gmail-readonly", now + 1), false);
    assert.equal(verifyOAuthSessionBinding(binding, session, "google-auth", now + 1), false);
    assert.equal(verifyOAuthSessionBinding(binding, session, "gmail-readonly", now + 10 * 60_000), false);
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

