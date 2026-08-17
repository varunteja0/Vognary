import assert from "node:assert/strict";
import test from "node:test";

import {
  recoveryBackupVerificationMatches,
  requiredAutopilotAuditCountKeys,
  requiredAutopilotIntegrityMigrations,
  requiredAutopilotIntegrityTriggers,
  requiredRecoveryMigration,
} from "../scripts/lib/recovery-backup-verification.mjs";

function verification(auditFacts: Record<string, string> = {}) {
  return {
    requiredMigration: requiredRecoveryMigration,
    requiredIntegrityMigrations: [...requiredAutopilotIntegrityMigrations],
    integrityTriggers: [...requiredAutopilotIntegrityTriggers],
    recoveryWorkspaceCounts: Object.fromEntries(
      requiredAutopilotAuditCountKeys.map((key) => [key, auditFacts[key] ?? "0"]),
    ),
  };
}

test("backup verification rejects matching manifests with zero Autopilot audit facts", () => {
  const empty = verification();
  assert.equal(recoveryBackupVerificationMatches(empty, empty), false);
});

test("backup verification accepts matching manifests with persisted Autopilot audit facts", () => {
  const populated = verification({ standing_mandate_events: "1" });
  assert.equal(recoveryBackupVerificationMatches(populated, populated), true);
});

test("backup verification rejects missing or mismatched required audit counts", () => {
  const expected = verification({ candidate_events: "2" });
  const missing = verification({ candidate_events: "2" });
  delete missing.recoveryWorkspaceCounts.execution_attempts;
  assert.equal(recoveryBackupVerificationMatches(expected, missing), false);
  assert.equal(recoveryBackupVerificationMatches(expected, verification({ candidate_events: "1" })), false);
});

test("backup verification rejects missing integrity migrations or triggers", () => {
  const expected = verification({ candidate_events: "2" });
  const missingMigration = verification({ candidate_events: "2" });
  missingMigration.requiredIntegrityMigrations = missingMigration.requiredIntegrityMigrations.slice(0, -1);
  assert.equal(recoveryBackupVerificationMatches(expected, missingMigration), false);
  const missingTrigger = verification({ candidate_events: "2" });
  missingTrigger.integrityTriggers = missingTrigger.integrityTriggers.slice(0, -1);
  assert.equal(recoveryBackupVerificationMatches(expected, missingTrigger), false);
});
