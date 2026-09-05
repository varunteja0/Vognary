import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateControlPilotReadiness,
  formatControlPilotReadiness,
} from "../scripts/lib/control-pilot-readiness.mjs";

const sha = "a".repeat(64);
const releaseSha = "b".repeat(40);
const readyAttention = { status: "delivery-observed", queued: 0, sending: 0, retryScheduled: 0, providerAccepted: 0, failed: 0, deadLetters: 0 };
const requiredMigrations = [
  "0057_commitment_control_v0",
  "0058_workspace_invites",
  "0059_control_authority_hardening",
  "0060_control_outcome_authorization_window",
  "0061_control_outcome_observation_honesty",
  "0062_control_outcome_basis_constraint_name",
  "0063_control_authorization_expiry_verdict",
  "0064_control_expired_verdict_integrity",
  "0065_control_attention_outbox",
  "0066_control_attention_provider_events",
  "0067_control_follow_through",
  "0068_control_attention_target_identity",
  "0069_control_projection_empty_windows",
];
const readyEnvironment = {
  COMMITMENT_CONTROL_INCIDENT_COMMANDER_STATUS: "assigned",
  COMMITMENT_CONTROL_BACKUP_INCIDENT_COMMANDER_STATUS: "assigned",
  COMMITMENT_CONTROL_INCIDENT_STAFFING_RECORD_SHA256: sha,
  COMMITMENT_CONTROL_INCIDENT_TABLETOP_STATUS: "passed",
  COMMITMENT_CONTROL_INCIDENT_TABLETOP_AT: "2026-09-01",
  COMMITMENT_CONTROL_INCIDENT_TABLETOP_RECORD_SHA256: sha,
  COMMITMENT_CONTROL_LEGAL_LOGGING_REVIEW_STATUS: "cleared-for-pilot",
  COMMITMENT_CONTROL_LEGAL_LOGGING_REVIEW_AT: "2026-09-01",
  COMMITMENT_CONTROL_LEGAL_LOGGING_REVIEW_SHA256: sha,
  COMMITMENT_CONTROL_PROPOSAL_REVIEW_PROCEDURE_STATUS: "approved",
  COMMITMENT_CONTROL_PROPOSAL_REVIEW_PROCEDURE_SHA256: sha,
  COMMITMENT_CONTROL_OPERATIONS_EVIDENCE_COMMIT_SHA: releaseSha,
  BACKUP_RESTORE_DRILL_STATUS: "passed",
  BACKUP_RESTORE_DRILL_AT: "2026-09-01",
  BACKUP_RESTORE_DRILL_RECORD_SHA256: sha,
  MONITORING_DELIVERY_TEST_STATUS: "passed",
  MONITORING_DELIVERY_TEST_AT: "2026-09-01",
  MONITORING_DELIVERY_TEST_RECORD_SHA256: sha,
};

test("Control pilot readiness requires every independent customer-data proof", () => {
  const result = evaluateControlPilotReadiness({
    environment: readyEnvironment,
    enrollment: { status: "ready", enrolledWorkspaceCount: 1 },
    appliedMigrations: requiredMigrations,
    targetReadinessAuthenticated: true,
    targetCommitSha: releaseSha,
    targetAttention: readyAttention,
    now: new Date("2026-09-02T00:00:00.000Z"),
  });

  assert.equal(result.status, "ready");
  assert.equal(result.checks.every((check) => check.ready), true);
  assert.deepEqual(result.checks.map((check) => check.id), [
    "target-readiness",
    "control-migrations",
    "paid-assessed-enrollment",
    "operations-release-binding",
    "incident-staffing",
    "incident-tabletop",
    "legal-logging-review",
    "backup-restore",
    "monitoring-delivery",
    "control-attention-delivery",
    "proposal-review-procedure",
  ]);
});

test("Control pilot readiness requires the empty-window projection migration", () => {
  const result = evaluateControlPilotReadiness({
    environment: readyEnvironment,
    enrollment: { status: "ready", enrolledWorkspaceCount: 1 },
    appliedMigrations: requiredMigrations.filter((migration) => migration !== "0069_control_projection_empty_windows"),
    targetReadinessAuthenticated: true,
    targetCommitSha: releaseSha,
    targetAttention: readyAttention,
    now: new Date("2026-09-02T00:00:00.000Z"),
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.checks.find((check) => check.id === "control-migrations")?.ready, false);
});

test("blank evidence fails closed without exposing environment values", () => {
  const environment = { ...Object.fromEntries(Object.keys(readyEnvironment).map((name) => [name, "private-value-do-not-print"])) };
  const result = evaluateControlPilotReadiness({
    environment,
    enrollment: { status: "disabled-no-workspaces", enrolledWorkspaceCount: 0 },
    appliedMigrations: [],
    targetReadinessAuthenticated: false,
    targetCommitSha: "",
    targetAttention: null,
    now: new Date("2026-09-02T00:00:00.000Z"),
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.checks.filter((check) => !check.ready).map((check) => check.id), [
    "target-readiness",
    "control-migrations",
    "paid-assessed-enrollment",
    "operations-release-binding",
    "incident-staffing",
    "incident-tabletop",
    "legal-logging-review",
    "backup-restore",
    "monitoring-delivery",
    "control-attention-delivery",
    "proposal-review-procedure",
  ]);
  assert.doesNotMatch(JSON.stringify(result), /private-value-do-not-print/);
  assert.doesNotMatch(formatControlPilotReadiness(result), /private-value-do-not-print/);
});

test("stale restore and tabletop evidence stay blocked", () => {
  const result = evaluateControlPilotReadiness({
    environment: {
      ...readyEnvironment,
      BACKUP_RESTORE_DRILL_AT: "2026-07-01",
      COMMITMENT_CONTROL_INCIDENT_TABLETOP_AT: "2026-01-01",
    },
    enrollment: { status: "ready", enrolledWorkspaceCount: 1 },
    appliedMigrations: requiredMigrations,
    targetReadinessAuthenticated: true,
    targetCommitSha: releaseSha,
    targetAttention: readyAttention,
    now: new Date("2026-09-02T00:00:00.000Z"),
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.checks.find((check) => check.id === "backup-restore")?.reason, "restore-evidence-stale");
  assert.equal(result.checks.find((check) => check.id === "incident-tabletop")?.reason, "tabletop-evidence-stale");
});

test("bare restore and monitoring status strings cannot clear readiness", () => {
  const environment: Record<string, string> = { ...readyEnvironment };
  delete environment.BACKUP_RESTORE_DRILL_RECORD_SHA256;
  delete environment.MONITORING_DELIVERY_TEST_AT;
  delete environment.MONITORING_DELIVERY_TEST_RECORD_SHA256;
  const result = evaluateControlPilotReadiness({
    environment,
    enrollment: { status: "ready", enrolledWorkspaceCount: 1 },
    appliedMigrations: requiredMigrations,
    targetReadinessAuthenticated: true,
    targetCommitSha: releaseSha,
    targetAttention: readyAttention,
    now: new Date("2026-09-02T00:00:00.000Z"),
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.checks.find((check) => check.id === "backup-restore")?.reason, "backup-restore-record-hash-invalid");
  assert.equal(result.checks.find((check) => check.id === "monitoring-delivery")?.reason, "monitoring-delivery-record-hash-invalid");
});

test("every dated readiness status requires its restricted record hash", () => {
  for (const [field, checkId] of [
    ["COMMITMENT_CONTROL_INCIDENT_TABLETOP_RECORD_SHA256", "incident-tabletop"],
    ["COMMITMENT_CONTROL_LEGAL_LOGGING_REVIEW_SHA256", "legal-logging-review"],
    ["BACKUP_RESTORE_DRILL_RECORD_SHA256", "backup-restore"],
    ["MONITORING_DELIVERY_TEST_RECORD_SHA256", "monitoring-delivery"],
  ] as const) {
    const environment: Record<string, string> = { ...readyEnvironment };
    delete environment[field];
    const result = evaluateControlPilotReadiness({
      environment,
      enrollment: { status: "ready", enrolledWorkspaceCount: 1 },
      appliedMigrations: requiredMigrations,
      targetReadinessAuthenticated: true,
      targetCommitSha: releaseSha,
      targetAttention: readyAttention,
      now: new Date("2026-09-02T00:00:00.000Z"),
    });
    assert.equal(result.checks.find((check) => check.id === checkId)?.reason, `${checkId}-record-hash-invalid`);
  }
});

test("operations evidence must match the authenticated target release", () => {
  const result = evaluateControlPilotReadiness({
    environment: {
      ...readyEnvironment,
      COMMITMENT_CONTROL_OPERATIONS_EVIDENCE_COMMIT_SHA: "b".repeat(40),
    },
    enrollment: { status: "ready", enrolledWorkspaceCount: 1 },
    appliedMigrations: requiredMigrations,
    targetReadinessAuthenticated: true,
    targetCommitSha: "c".repeat(40),
    targetAttention: readyAttention,
    now: new Date("2026-09-02T00:00:00.000Z"),
  });

  assert.equal(result.status, "blocked");
  assert.equal(
    result.checks.find((check) => check.id === "operations-release-binding")?.reason,
    "operations-evidence-commit-mismatch",
  );
});

test("Control attention delivery blocks on unproven delivery or open dead letters", () => {
  for (const [targetAttention, reason] of [
    [{ status: "worker-configured-delivery-unproven", deadLetters: 0 }, "control-attention-delivery-unproven"],
    [{ status: "blocked-dead-letters", deadLetters: 1 }, "control-attention-dead-letters-open"],
    [{ ...readyAttention, status: "delivery-observed-work-pending", providerAccepted: 1 }, "control-attention-delivery-pending"],
  ] as const) {
    const result = evaluateControlPilotReadiness({
      environment: readyEnvironment,
      enrollment: { status: "ready", enrolledWorkspaceCount: 1 },
      appliedMigrations: requiredMigrations,
      targetReadinessAuthenticated: true,
      targetCommitSha: releaseSha,
      targetAttention,
      now: new Date("2026-09-02T00:00:00.000Z"),
    });
    const check = result.checks.find((item) => item.id === "control-attention-delivery");
    assert.equal(check?.ready, false);
    assert.equal(check?.reason, reason);
  }
});