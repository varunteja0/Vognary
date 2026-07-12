import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeProductEvent, type ProductEventInput } from "@/lib/product-events";

test("product events accept only bounded operational metrics", () => {
  const event = normalizeProductEvent({
    workspaceId: "123e4567-e89b-42d3-a456-426614174000",
    eventName: "connector.sync.succeeded",
    occurredAt: "2026-07-11T00:00:00.000Z",
    source: "sync-runner",
    status: "succeeded",
    durationMs: 1250,
    metrics: {
      recordsSeen: 12,
      evidenceWritten: 10,
      transactionsWritten: 4,
    },
  });

  assert.equal(event.workspaceId, "123e4567-e89b-42d3-a456-426614174000");
  assert.equal(event.occurredAt, "2026-07-11T00:00:00.000Z");
  assert.deepEqual(event.metrics, { recordsSeen: 12, evidenceWritten: 10, transactionsWritten: 4 });
});

test("consented product experience events use an allowlisted source and numeric counts only", () => {
  const event = normalizeProductEvent({
    userId: "123e4567-e89b-42d3-a456-426614174001",
    eventName: "workspace.activated",
    source: "product-ui",
    status: "succeeded",
    metrics: { commitmentsTouched: 7, evidenceWritten: 14 },
  });

  assert.equal(event.eventName, "workspace.activated");
  assert.equal(event.source, "product-ui");
  assert.deepEqual(event.metrics, { commitmentsTouched: 7, evidenceWritten: 14 });
});

test("product events reject raw payload fields, arbitrary metrics, PII-shaped IDs, and strings", () => {
  assert.throws(() => normalizeProductEvent({
    eventName: "ledger.materialized",
    source: "living-ledger",
    rawFinancialPayload: { merchant: "Secret" },
  } as ProductEventInput), /not privacy-safe/);

  assert.throws(() => normalizeProductEvent({
    eventName: "ledger.materialized",
    source: "living-ledger",
    metrics: { merchant: 1 },
  } as unknown as ProductEventInput), /not allowlisted/);

  assert.throws(() => normalizeProductEvent({
    workspaceId: "customer@example.com",
    eventName: "ledger.materialized",
    source: "living-ledger",
  }), /must be a UUID/);

  assert.throws(() => normalizeProductEvent({
    eventName: "ledger.materialized",
    source: "living-ledger",
    metrics: { recordsSeen: "12" },
  } as unknown as ProductEventInput), /bounded non-negative number/);
});
