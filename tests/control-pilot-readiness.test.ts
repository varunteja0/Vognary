import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateControlPilotReadiness,
  formatControlPilotReadiness,
} from "../scripts/lib/control-pilot-readiness.mjs";

const sha = "a".repeat(64);
const releaseSha = "b".repeat(40);
const requiredMigrations = [
  "0057_commitment_control_v0",
  "0058_workspace_invites",
  "0059_control_authority_hardening",
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
    "proposal-review-procedure",
  ]);
});

test("blank evidence fails closed without exposing environment values", () => {
  const environment = { ...Object.fromEntries(Object.keys(readyEnvironment).map((name) => [name, "private-value-do-not-print"])) };
  const result = evaluateControlPilotReadiness({
    environment,
    enrollment: { status: "disabled-no-workspaces", enrolledWorkspaceCount: 0 },
    appliedMigrations: [],
    targetReadinessAuthenticated: false,
    targetCommitSha: "",
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
    now: new Date("2026-09-02T00:00:00.000Z"),
  });

  assert.equal(result.status, "blocked");
  assert.equal(
    result.checks.find((check) => check.id === "operations-release-binding")?.reason,
    "operations-evidence-commit-mismatch",
  );
});