import assert from "node:assert/strict";
import { test } from "node:test";
import { redactMonitoringText, sanitizeMonitoringPath, sanitizeMonitoringValue } from "../src/lib/server/monitoring";

test("monitoring paths discard query strings and fragments", () => {
  assert.equal(
    sanitizeMonitoringPath("https://www.vognary.com/api/auth/magic-link/verify?token=secret#fragment"),
    "/api/auth/magic-link/verify",
  );
  assert.equal(sanitizeMonitoringPath("/api/auth/google/callback?code=secret&state=secret"), "/api/auth/google/callback");
});

test("monitoring text removes credentials, database URLs, and email addresses", () => {
  const value = redactMonitoringText("postgres://user:pass@db.example/vognary sk-secretvalue12345 founder@example.com");
  assert.equal(value.includes("user:pass"), false);
  assert.equal(value.includes("secretvalue"), false);
  assert.equal(value.includes("founder@example.com"), false);
});

test("monitoring context drops sensitive keys recursively", () => {
  const sanitized = sanitizeMonitoringValue({ route: "/api/test", token: "nope", nested: { email: "x@example.com", status: "failed" } });
  assert.deepEqual(sanitized, { route: "/api/test", nested: { status: "failed" } });
});
