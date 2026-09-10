import assert from "node:assert/strict";
import test from "node:test";

import {
  pre0053IntegrityTriggers,
  pre0053IntegrityMigrations,
  pre0057IntegrityMigrations,
  pre0057IntegrityTriggers,
  readRecoveryBackupVerification,
  recoveryBackupVerificationMatches,
  resolveBackupVerificationProfile,
  requiredAutopilotAuditCountKeys,
  requiredCommitmentControlCountKeys,
  requiredZohoBooksCountKeys,
  requiredProviderBillCountKeys,
  requiredAutopilotIntegrityMigrations,
  requiredAutopilotIntegrityTriggers,
  requiredRecoveryMigration,
  requiredRecoveryTablesForProfile,
} from "../scripts/lib/recovery-backup-verification.mjs";

function verification(auditFacts: Record<string, string> = {}) {
  return {
    profile: "current",
    migrationHead: "0077_control_provider_bill_admission_guards",
    requiredMigration: requiredRecoveryMigration,
    requiredIntegrityMigrations: [...requiredAutopilotIntegrityMigrations],
    integrityTriggers: [...requiredAutopilotIntegrityTriggers],
    recoveryWorkspaceCounts: Object.fromEntries(
      [...requiredAutopilotAuditCountKeys, ...requiredCommitmentControlCountKeys, ...requiredZohoBooksCountKeys, ...requiredProviderBillCountKeys]
        .map((key) => [key, auditFacts[key] ?? "0"]),
    ),
  };
}

test("scheduled backup resolves only an exact supported deployed schema head", async () => {
  for (const [head, profile] of [
    ["0026_recovery_inbound_retention", "pre-0053"],
    ["0056_decision_cycle_expected_amount", "pre-0057"],
    ["0077_control_provider_bill_admission_guards", "current"],
  ]) {
    const queries: string[] = [];
    const client = { query: async (sql: string) => { queries.push(sql); return { rows: [{ id: head }] }; } };
    assert.equal(await resolveBackupVerificationProfile(client, "deployed"), profile);
    assert.equal(queries.length, 1);
    assert.match(queries[0], /select id from schema_migrations order by id desc limit 1/);
  }
});

test("deployed backup profile refuses missing, intermediate and unknown migration heads", async () => {
  for (const head of [null, "0057_commitment_control_v0", "0076_control_provider_bills", "9999_unknown"]) {
    const client = { query: async () => ({ rows: head ? [{ id: head }] : [] }) };
    await assert.rejects(resolveBackupVerificationProfile(client, "deployed"), /No supported backup verification profile/);
  }
});

test("profile selection never downgrades an explicit request or skips integrity checks", async () => {
  const head = "0056_decision_cycle_expected_amount";
  const client = { query: async (sql: string) => ({ rows: sql.includes("order by id desc") ? [{ id: head }] : [] }) };
  assert.equal(await resolveBackupVerificationProfile(client, "current"), "current");
  await assert.rejects(readRecoveryBackupVerification(client, "current"), /current backup requires 0077/);
  const selected = await resolveBackupVerificationProfile(client, "deployed");
  await assert.rejects(readRecoveryBackupVerification(client, selected), /missing required migrations/);
  await assert.rejects(resolveBackupVerificationProfile(client, "arbitrary"), /Unknown backup verification profile/);
});

test("source resolution backup requires exact reviews, incidents and immutable dispositions", () => {
  for (const table of ["zoho_books_reviews", "zoho_books_incidents", "zoho_books_dispositions"]) assert.ok(requiredZohoBooksCountKeys.includes(table));
  assert.ok(requiredAutopilotIntegrityMigrations.includes("0075_zoho_books_dispositions"));
  assert.ok(requiredAutopilotIntegrityTriggers.includes("zoho_books_disposition_immutable"));
});

test("A2 backup inventory includes detached admissions and original grants without changing historical profiles", () => {
  assert.ok(requiredAutopilotIntegrityMigrations.includes("0076_control_provider_bills"));
  for (const table of ["zoho_books_grants", "recovery_provider_bill_links"]) {
    assert.ok(requiredRecoveryTablesForProfile("current").includes(table));
    assert.equal(requiredRecoveryTablesForProfile("pre-0057").includes(table), false);
    assert.equal(requiredRecoveryTablesForProfile("pre-0053").includes(table), false);
  }
  for (const trigger of ["zoho_books_grant_immutable", "zoho_books_snapshot_grant_valid", "recovery_provider_bill_link_valid",
    "recovery_provider_bill_link_immutable", "recovery_provider_bill_lineage_required", "control_provider_comparison_valid",
    "recovery_provider_bill_no_commitment", "recovery_provider_bill_no_evaluation", "control_decision_amount_basis"]) {
    assert.ok(requiredAutopilotIntegrityTriggers.includes(trigger), trigger);
    assert.equal(pre0057IntegrityTriggers.includes(trigger), false, trigger);
  }
});

test("0077 backup integrity requires gross-cap, source-authority and comparison-admission guards", () => {
  const migration = "0077_control_provider_bill_admission_guards";
  const guards = ["control_gross_approval_cap", "recovery_provider_bill_authority", "control_provider_comparison_admission"];
  assert.ok(requiredAutopilotIntegrityMigrations.includes(migration));
  assert.equal(pre0057IntegrityMigrations.includes(migration), false);
  const complete = verification();
  assert.equal(recoveryBackupVerificationMatches(complete, complete), true);
  for (const guard of guards) {
    assert.ok(requiredAutopilotIntegrityTriggers.includes(guard), guard);
    assert.equal(pre0057IntegrityTriggers.includes(guard), false, guard);
    const missing = { ...complete, integrityTriggers: complete.integrityTriggers.filter(trigger => trigger !== guard) };
    assert.equal(recoveryBackupVerificationMatches(complete, missing), false, guard);
    assert.equal(recoveryBackupVerificationMatches(missing, missing), false, guard);
  }
  const prior = { ...complete, migrationHead: "0076_control_provider_bills",
    requiredIntegrityMigrations: complete.requiredIntegrityMigrations.filter(value => value !== migration),
    integrityTriggers: complete.integrityTriggers.filter(value => !guards.includes(value)) };
  assert.equal(recoveryBackupVerificationMatches(prior, prior), false);
});

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

function pre0057Verification(counts: Record<string, string> = {}) {
  return {
    profile: "pre-0057",
    migrationHead: "0056_decision_cycle_expected_amount",
    requiredMigration: requiredRecoveryMigration,
    requiredIntegrityMigrations: [...pre0057IntegrityMigrations],
    integrityTriggers: [...pre0057IntegrityTriggers],
    recoveryWorkspaceCounts: Object.fromEntries(
      requiredAutopilotAuditCountKeys.map((key) => [key, counts[key] ?? "0"]),
    ),
  };
}

test("pre-0053 verification accepts exact 0026 migrations, guards, and counts", () => {
  const expected = pre0053Verification({ inbound_events: "3" });
  const actual = pre0053Verification({ inbound_events: "3" });
  assert.equal(recoveryBackupVerificationMatches(expected, actual), true);
  actual.migrationHead = "0053_phase_a_receipt_activation";
  assert.equal(recoveryBackupVerificationMatches(expected, actual), false);
});

test("pre-0057 verification accepts exact 0056 integrity and rejects post-migration drift", () => {
  const expected = pre0057Verification({ candidate_events: "2" });
  const actual = pre0057Verification({ candidate_events: "2" });
  assert.equal(recoveryBackupVerificationMatches(expected, actual), true);
  actual.migrationHead = "0057_commitment_control_v0";
  assert.equal(recoveryBackupVerificationMatches(expected, actual), false);
  const missingAudit = pre0057Verification({ candidate_events: "2" });
  delete missingAudit.recoveryWorkspaceCounts.execution_attempts;
  assert.equal(recoveryBackupVerificationMatches(expected, missingAudit), false);
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
  const missingControl = verification({ candidate_events: "2" });
  delete missingControl.recoveryWorkspaceCounts.commitment_control_decisions;
  assert.equal(recoveryBackupVerificationMatches(expected, missingControl), false);
  const missingBooks = verification();
  delete missingBooks.recoveryWorkspaceCounts.zoho_books_snapshots;
  assert.equal(recoveryBackupVerificationMatches(verification(), missingBooks), false);
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
