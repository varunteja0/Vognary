import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLedgerEventInput } from "../src/lib/ledger-events";

test("ledger events accept only versioned, bounded, privacy-reviewed metadata", () => {
  const normalized = normalizeLedgerEventInput({
    eventType: "commitment.decision.updated",
    entityKind: "commitment",
    entityRef: "00000000-0000-4000-8000-000000000001",
    idempotencyKey: "decision:00000000-0000-4000-8000-000000000001:1",
    payload: { action: "cancel", previousAction: "watch" },
  });
  assert.equal(normalized.schemaVersion, 1);
  assert.deepEqual(normalized.payload, { action: "cancel", previousAction: "watch" });
});

test("ledger events reject raw evidence and unknown event types", () => {
  assert.throws(() => normalizeLedgerEventInput({
    eventType: "unknown.event",
    entityKind: "commitment",
    entityRef: "item",
    idempotencyKey: "unknown-event-key-0001",
  }), /not allowlisted/);
  assert.throws(() => normalizeLedgerEventInput({
    eventType: "graph.materialized",
    entityKind: "graph",
    entityRef: "workspace",
    idempotencyKey: "graph-materialized-0001",
    payload: { evidenceText: "full bank statement row" },
  }), /payload field evidenceText is not allowlisted/);
});
