import assert from "node:assert/strict";
import test from "node:test";

import { transitionAssistedAuditOrder, type AssistedAuditOrderAction, type AssistedAuditOrderStatus } from "../src/lib/billing";

test("assisted-audit fulfillment transitions are explicit and terminal-safe", () => {
  const cases: Array<[AssistedAuditOrderStatus, AssistedAuditOrderAction, AssistedAuditOrderStatus | null]> = [
    ["review_required", "start", "in_progress"],
    ["pending", "start", "in_progress"],
    ["in_progress", "deliver", "delivered"],
    ["review_required", "cancel", "cancelled"],
    ["pending", "cancel", "cancelled"],
    ["in_progress", "cancel", "cancelled"],
    ["pending", "deliver", null],
    ["delivered", "start", null],
    ["delivered", "cancel", null],
    ["refunded", "start", null],
    ["refunded", "deliver", null],
    ["cancelled", "start", null],
  ];
  for (const [current, action, expected] of cases) {
    assert.equal(transitionAssistedAuditOrder(current, action), expected, `${current} + ${action}`);
  }
});