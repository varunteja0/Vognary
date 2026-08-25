import assert from "node:assert/strict";
import test from "node:test";
import { isCommitmentControlWorkspaceEnrolled } from "../src/lib/commitment-control/enrollment";

const workspaceId = "a1000000-0000-4000-8000-000000000001";

test("Commitment Control enrollment is fail-closed and matches exact workspace UUIDs", () => {
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, { value: undefined, nodeEnv: "production" }), false);
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, { value: "", nodeEnv: "production" }), false);
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, {
    value: "b1000000-0000-4000-8000-000000000001, A1000000-0000-4000-8000-000000000001",
    nodeEnv: "production",
  }), true);
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, {
    value: "b1000000-0000-4000-8000-000000000001",
    nodeEnv: "production",
  }), false);
});

test("the wildcard is development-only and cannot enroll every production workspace", () => {
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, { value: "*", nodeEnv: "test" }), true);
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, { value: "*", nodeEnv: "development" }), true);
  assert.equal(isCommitmentControlWorkspaceEnrolled(workspaceId, { value: "*", nodeEnv: "production" }), false);
});