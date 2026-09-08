import assert from "node:assert/strict";
import test from "node:test";
import { assertRecoveryWorkspaceTarget } from "../src/lib/server/recovery-route";

const workspaceId = "11111111-1111-4111-8111-111111111111";

test("workspace-targeted requests refuse a changed active workspace before any handler runs", () => {
  const request = new Request("https://vognary.example/api/workspaces/current/evidence", {
    method: "POST",
    headers: { "X-Vognary-Workspace": workspaceId },
  });
  assert.throws(() => assertRecoveryWorkspaceTarget(request, "22222222-2222-4222-8222-222222222222"), { code: "FORBIDDEN" });
  assert.doesNotThrow(() => assertRecoveryWorkspaceTarget(request, workspaceId));
});

test("legacy untargeted requests remain compatible but an explicitly empty target is rejected", () => {
  assert.doesNotThrow(() => assertRecoveryWorkspaceTarget(new Request("https://vognary.example/api/workspaces/current/brief"), workspaceId));
  assert.throws(() => assertRecoveryWorkspaceTarget(new Request("https://vognary.example/api/workspaces/current/evidence", {
    headers: { "X-Vognary-Workspace": "" },
  }), workspaceId), { code: "FORBIDDEN" });
});
