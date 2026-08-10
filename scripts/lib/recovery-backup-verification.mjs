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
       (select count(*)::text from recovery_idempotency_keys) as idempotency_keys`,
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
