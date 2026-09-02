const requiredMigrations = [
  "0057_commitment_control_v0",
  "0058_workspace_invites",
  "0059_control_authority_hardening",
];

const sha256Pattern = /^[a-f0-9]{64}$/i;
const millisecondsPerDay = 86_400_000;

export function evaluateControlPilotReadiness({
  environment,
  enrollment,
  appliedMigrations,
  targetReadinessAuthenticated,
  now = new Date(),
}) {
  const checks = [
    check("target-readiness", targetReadinessAuthenticated === true, "target-readiness-unavailable"),
    check(
      "control-migrations",
      requiredMigrations.every((migration) => appliedMigrations.includes(migration)),
      "control-migrations-missing",
    ),
    check(
      "paid-assessed-enrollment",
      enrollment?.status === "ready" && enrollment.enrolledWorkspaceCount === 1,
      enrollment?.status === "ready" ? "expected-exactly-one-enrolled-workspace" : `enrollment-${enrollment?.status ?? "unavailable"}`,
    ),
    check(
      "incident-staffing",
      environment.COMMITMENT_CONTROL_INCIDENT_COMMANDER_STATUS === "assigned"
        && environment.COMMITMENT_CONTROL_BACKUP_INCIDENT_COMMANDER_STATUS === "assigned"
        && validHash(environment.COMMITMENT_CONTROL_INCIDENT_STAFFING_RECORD_SHA256),
      "incident-staffing-incomplete",
    ),
    datedEvidenceCheck({
      id: "incident-tabletop",
      statusReady: environment.COMMITMENT_CONTROL_INCIDENT_TABLETOP_STATUS === "passed",
      statusReason: "tabletop-not-passed",
      date: environment.COMMITMENT_CONTROL_INCIDENT_TABLETOP_AT,
      hash: environment.COMMITMENT_CONTROL_INCIDENT_TABLETOP_RECORD_SHA256,
      staleAfterDays: 90,
      staleReason: "tabletop-evidence-stale",
      now,
    }),
    datedEvidenceCheck({
      id: "legal-logging-review",
      statusReady: environment.COMMITMENT_CONTROL_LEGAL_LOGGING_REVIEW_STATUS === "cleared-for-pilot",
      statusReason: "legal-logging-review-not-cleared",
      date: environment.COMMITMENT_CONTROL_LEGAL_LOGGING_REVIEW_AT,
      hash: environment.COMMITMENT_CONTROL_LEGAL_LOGGING_REVIEW_SHA256,
      now,
    }),
    datedEvidenceCheck({
      id: "backup-restore",
      statusReady: environment.BACKUP_RESTORE_DRILL_STATUS === "passed",
      statusReason: "restore-not-passed",
      date: environment.BACKUP_RESTORE_DRILL_AT,
      hash: environment.BACKUP_RESTORE_DRILL_RECORD_SHA256,
      staleAfterDays: 30,
      staleReason: "restore-evidence-stale",
      now,
    }),
    datedEvidenceCheck({
      id: "monitoring-delivery",
      statusReady: environment.MONITORING_DELIVERY_TEST_STATUS === "passed",
      statusReason: "monitoring-delivery-not-proven",
      date: environment.MONITORING_DELIVERY_TEST_AT,
      hash: environment.MONITORING_DELIVERY_TEST_RECORD_SHA256,
      now,
    }),
    check(
      "proposal-review-procedure",
      environment.COMMITMENT_CONTROL_PROPOSAL_REVIEW_PROCEDURE_STATUS === "approved"
        && validHash(environment.COMMITMENT_CONTROL_PROPOSAL_REVIEW_PROCEDURE_SHA256),
      "proposal-review-procedure-not-approved",
    ),
  ];
  return {
    status: checks.every((item) => item.ready) ? "ready" : "blocked",
    checks,
  };
}

export function formatControlPilotReadiness(result) {
  return [
    `Control pilot readiness: ${result.status.toUpperCase()}`,
    ...result.checks.map((item) => `${item.ready ? "READY" : "BLOCKED"} ${item.id}${item.ready ? "" : `: ${item.reason}`}`),
  ].join("\n");
}

function check(id, ready, reason) {
  return ready ? { id, ready: true } : { id, ready: false, reason };
}

function datedEvidenceCheck({
  id,
  statusReady,
  statusReason,
  date,
  hash,
  staleAfterDays,
  staleReason,
  now,
}) {
  if (!statusReady) return check(id, false, statusReason);
  if (!validHash(hash)) return check(id, false, `${id}-record-hash-invalid`);
  const timestamp = parseEvidenceDate(date);
  if (timestamp === null) return check(id, false, `${id}-date-invalid`);
  if (timestamp > now.getTime()) return check(id, false, `${id}-date-future`);
  if (staleAfterDays !== undefined && now.getTime() - timestamp > staleAfterDays * millisecondsPerDay) {
    return check(id, false, staleReason);
  }
  return check(id, true, "");
}

function parseEvidenceDate(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function validHash(value) {
  return typeof value === "string" && sha256Pattern.test(value.trim());
}