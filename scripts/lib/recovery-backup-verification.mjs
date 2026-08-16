export const requiredRecoveryMigration = "0023_recovery_v1";

export async function readRecoveryBackupVerification(client) {
  const migration = await client.query(
    `select id from schema_migrations where id = $1`,
    [requiredRecoveryMigration],
  );
  if (migration.rowCount !== 1) throw new Error(`Database is missing required migration: ${requiredRecoveryMigration}`);

  const result = await client.query(
    `select
       (select count(*)::text from recovery_workspace_states) as workspace_states,
       (select count(*)::text from recovery_workspace_versions) as workspace_versions,
       (select count(*)::text from recovery_submissions) as submissions,
       (select count(*)::text from recovery_sources) as sources,
       (select count(*)::text from recovery_commitments) as commitments,
       (select count(*)::text from recovery_evidence) as evidence,
       (select count(*)::text from recovery_commitment_evidence) as commitment_evidence,
       (select count(*)::text from recovery_corrections) as corrections,
       (select count(*)::text from recovery_decisions) as decisions,
       (select count(*)::text from recovery_changes) as changes,
       (select count(*)::text from recovery_idempotency_keys) as idempotency_keys,
       (select count(*)::text from recovery_standing_mandates) as standing_mandates,
       (select count(*)::text from recovery_action_candidates) as action_candidates,
       (select count(*)::text from recovery_covered_windows) as covered_windows,
       (select count(*)::text from recovery_fee_ledger) as fee_ledger,
       (select count(*)::text from recovery_execution_attempts) as execution_attempts,
       (select count(*)::text from recovery_shadow_gate_snapshots) as shadow_gate_snapshots,
       (select count(*)::text from recovery_notice_delivery_events) as notice_delivery_events,
       (select count(*)::text from recovery_autopilot_dead_letters) as dead_letters,
       (select count(*)::text from recovery_billing_year_anchors) as billing_year_anchors,
       (select count(*)::text from recovery_notice_pending_events) as notice_pending_events,
       (select count(*)::text from recovery_connected_mandate_cohort) as connected_mandate_cohort,
       (select count(*)::text from recovery_source_disconnections) as source_disconnections,
       (select count(*)::text from recovery_veto_notices) as veto_notices,
       (select count(*)::text from recovery_classification_snapshots) as classification_snapshots,
       (select count(*)::text from recovery_executions) as executions,
       (select count(*)::text from recovery_provider_disables) as provider_disables,
       (select count(*)::text from recovery_inbound_aliases) as inbound_aliases,
       (select count(*)::text from recovery_inbound_events) as inbound_events,
       (select count(*)::text from recovery_inbound_replay_keys) as inbound_replay_keys`,
  );

  return {
    requiredMigration: requiredRecoveryMigration,
    recoveryWorkspaceCounts: result.rows[0],
  };
}

export function recoveryBackupVerificationMatches(expected, actual) {
  if (!expected || expected.requiredMigration !== requiredRecoveryMigration) return false;
  if (actual.requiredMigration !== expected.requiredMigration) return false;
  const expectedCounts = expected.recoveryWorkspaceCounts;
  const actualCounts = actual.recoveryWorkspaceCounts;
  if (!expectedCounts || !actualCounts) return false;
  const keys = Object.keys(actualCounts);
  return keys.length === Object.keys(expectedCounts).length
    && keys.every((key) => String(expectedCounts[key]) === String(actualCounts[key]));
}
