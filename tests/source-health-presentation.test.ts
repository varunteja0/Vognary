import assert from "node:assert/strict";
import test from "node:test";
import {
  sourceDisplayName,
  sourceHealthPresentation,
  sourceNeedsAttention,
  type SourceHealthLike,
} from "../src/lib/source-health-presentation";

function source(overrides: Partial<SourceHealthLike> = {}): SourceHealthLike {
  return {
    connectorId: "gmail-readonly",
    status: "active",
    freshnessStatus: "unknown",
    latestRunStatus: null,
    ...overrides,
  };
}

test("source health presentation distinguishes fresh, stale, reconnect, and failed states", () => {
  assert.deepEqual(sourceHealthPresentation(source({ freshnessStatus: "fresh" })), { label: "Fresh", className: "pill pill-ready" });
  assert.deepEqual(sourceHealthPresentation(source({ freshnessStatus: "stale" })), { label: "Needs refresh", className: "pill pill-partial" });
  assert.deepEqual(sourceHealthPresentation(source({ status: "needs_reauth" })), { label: "Reconnect", className: "pill pill-blocked" });
  assert.deepEqual(sourceHealthPresentation(source({ latestRunStatus: "failed" })), { label: "Sync issue", className: "pill pill-blocked" });
});

test("attention includes blocked runs and source names prefer provider display names", () => {
  assert.equal(sourceNeedsAttention(source({ latestRunStatus: "blocked" })), true);
  assert.equal(sourceNeedsAttention(source({ freshnessStatus: "fresh", latestRunStatus: "succeeded" })), false);
  assert.equal(sourceDisplayName(source({ displayName: "  Foundry billing  " })), "Foundry billing");
  assert.equal(sourceDisplayName(source({ connectorId: "account-aggregator" })), "Account Aggregator");
});