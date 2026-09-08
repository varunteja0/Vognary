import assert from "node:assert/strict";
import test from "node:test";
import { controlReducer, initialControlState } from "../src/app/workspace/recovery/control/control-state";
import { initialRecoveryState, recoveryReducer } from "../src/app/workspace/recovery/state";
import type { TransportFailure } from "../src/app/workspace/recovery/transport";

const unknownWrite: TransportFailure = {
  ok: false,
  origin: "CLIENT",
  outcome: "UNKNOWN",
  error: { code: "UNKNOWN", message: "Save result unconfirmed.", retryable: true, requestId: "client-device" },
};

test("Control keeps unknown write outcomes for primary feedback and announcements", () => {
  const state = controlReducer(initialControlState, { type: "PROPOSAL_FAILED", failure: unknownWrite });
  assert.equal(state.failure?.outcome, "UNKNOWN");
  assert.doesNotMatch(state.announcement, /not saved|nothing was (sent|changed)/i);
});

test("Recovery keeps unknown evidence outcomes for primary feedback and announcements", () => {
  const state = recoveryReducer(initialRecoveryState, { type: "EVIDENCE_SUBMIT_FAILED", failure: unknownWrite });
  assert.equal(state.evidenceFailure?.outcome, "UNKNOWN");
  assert.doesNotMatch(state.announcement, /not saved|nothing was (sent|changed)/i);
});
