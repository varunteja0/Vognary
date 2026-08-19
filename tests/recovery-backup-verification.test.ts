import assert from "node:assert/strict";
import test from "node:test";

import {
  pre0053IntegrityTriggers,
  pre0053IntegrityMigrations,
  recoveryBackupVerificationMatches,
  requiredAutopilotAuditCountKeys,
  requiredAutopilotIntegrityMigrations,
  requiredAutopilotIntegrityTriggers,
  requiredRecoveryMigration,
} from "../scripts/lib/recovery-backup-verification.mjs";

function verification(auditFacts: Record<string, string> = {}) {
  return {
    profile: "current",
    migrationHead: "0054_recovery_commitment_context",
    requiredMigration: requiredRecoveryMigration,
    requiredIntegrityMigrations: [...requiredAutopilotIntegrityMigrations],
    integrityTriggers: [...requiredAutopilotIntegrityTriggers],
    recoveryWorkspaceCounts: Object.fromEntries(
      requiredAutopilotAuditCountKeys.map((key) => [key, auditFacts[key] ?? "0"]),
    ),
  };
}

function pre0053Verification(counts: Record<string, string> = {}) {
  return {
    profile: "pre-0053",
    migrationHead: "0026_recovery_inbound_retention",
    requiredMigration: requiredRecoveryMigration,
    requiredIntegrityMigrations: [...pre0053IntegrityMigrations],
    integrityTriggers: [...pre0053IntegrityTriggers],
    recoveryWorkspaceCounts: {
      workspace_states: "0",
      workspace_versions: "0",
      submissions: "0",
      sources: "0",
      commitments: "0",
      evidence: "0",
      commitment_evidence: "0",
      corrections: "0",
      decisions: "0",
      changes: "0",
      idempotency_keys: "0",
      inbound_aliases: "0",
      inbound_events: "0",
      inbound_replay_keys: "0",
      ...counts,
    },
  };
}

test("pre-0053 verification accepts exact 0026 migrations, guards, and counts", () => {
  const expected = pre0053Verification({ inbound_events: "3" });
  const actual = pre0053Verification({ inbound_events: "3" });
  assert.equal(recoveryBackupVerificationMatches(expected, actual), true);
  actual.migrationHead = "0053_phase_a_receipt_activation";
  assert.equal(recoveryBackupVerificationMatches(expected, actual), false);
});

test("backup verification accepts matching manifests with honestly empty Autopilot audit tables", () => {
  const empty = verification();
  assert.equal(recoveryBackupVerificationMatches(empty, empty), true);
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
