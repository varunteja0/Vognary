import assert from "node:assert/strict";
import { test } from "node:test";
import { buildConnectorConsentResourceKey, normalizeConsentGrant } from "../src/lib/consent";

test("normalizes a privacy-safe consent grant", () => {
  const consent = normalizeConsentGrant({
    subjectEmail: " Founder@Example.com ",
    purpose: "product-research-contact",
    noticeVersion: "privacy-2026-07-11",
    source: "profile-privacy-controls",
    scopes: ["contact", "contact"],
    grantedAt: "2026-07-11T00:00:00.000Z",
  });
  assert.equal(consent.subjectEmail, "founder@example.com");
  assert.deepEqual(consent.scopes, ["contact"]);
});

test("product analytics opt-in records only an explicit bounded scope", () => {
  const consent = normalizeConsentGrant({
    purpose: "product-analytics-opt-in",
    noticeVersion: "privacy-2026-07-11",
    source: "profile-privacy-controls",
    scopes: ["privacy-safe-product-events"],
  });
  assert.equal(consent.purpose, "product-analytics-opt-in");
  assert.deepEqual(consent.scopes, ["privacy-safe-product-events"]);
});

test("connector consent accepts a bounded resource identity", () => {
  const resourceKey = buildConnectorConsentResourceKey("openai-costs", "organization@example.com");
  const consent = normalizeConsentGrant({
    workspaceId: "123e4567-e89b-42d3-a456-426614174001",
    userId: "123e4567-e89b-42d3-a456-426614174002",
    subjectEmail: "founder@example.com",
    resourceKey,
    purpose: "provider-connector-sync",
    noticeVersion: "privacy-2026-07-11",
    source: "api-key-connector-start",
    scopes: ["organization costs"],
  });
  assert.match(consent.resourceKey ?? "", /^connector:openai-costs:[A-Za-z0-9_-]{24}$/);
  assert.equal(resourceKey.includes("organization@example.com"), false);
});

test("rejects non-allowlisted purposes and invalid expiry", () => {
  assert.throws(() => normalizeConsentGrant({
    purpose: "sell-financial-data" as never,
    noticeVersion: "privacy-2026-07-11",
    source: "test",
    scopes: [],
  }));
  assert.throws(() => normalizeConsentGrant({
    purpose: "product-research-contact",
    noticeVersion: "privacy-2026-07-11",
    source: "test",
    scopes: [],
    grantedAt: "2026-07-11T00:00:00.000Z",
    expiresAt: "2026-07-10T00:00:00.000Z",
  }));
});
