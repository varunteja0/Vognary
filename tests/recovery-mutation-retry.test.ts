import assert from "node:assert/strict";
import test from "node:test";
import { createMutationRetryTracker } from "../src/app/workspace/recovery/mutation-retry";
import type { TransportFailure } from "../src/app/workspace/recovery/transport";

const unknownWrite: TransportFailure = {
  ok: false, origin: "CLIENT", outcome: "UNKNOWN",
  error: { code: "UNKNOWN", message: "Synthetic lost acknowledgement", retryable: true, requestId: "client-device" },
};

test("an unchanged unknown write retains its original key, workspace and version", () => {
  let keys = 0;
  const tracker = createMutationRetryTracker(() => `synthetic-key-${++keys}`);
  const first = tracker.context("workspace-a", "evidence", { receipt: "synthetic" }, 4);
  tracker.settle(first, unknownWrite);
  const retry = tracker.context("workspace-a", "evidence", { receipt: "synthetic" }, 9);
  assert.deepEqual(retry, first);
  assert.equal(retry.workspaceVersion, 4);
  assert.equal(keys, 1);
});

test("a known result releases the key and a different workspace never inherits it", () => {
  let keys = 0;
  const tracker = createMutationRetryTracker(() => `synthetic-key-${++keys}`);
  const first = tracker.context("workspace-a", "evidence", { receipt: "synthetic" }, 4);
  const other = tracker.context("workspace-b", "evidence", { receipt: "synthetic" }, 4);
  assert.notEqual(other.idempotencyKey, first.idempotencyKey);
  assert.equal(other.workspaceId, "workspace-b");
  tracker.settle(first, { ...unknownWrite, origin: "SERVER", outcome: "REJECTED" });
  assert.notEqual(tracker.context("workspace-a", "evidence", { receipt: "synthetic" }, 4).idempotencyKey, first.idempotencyKey);
});
