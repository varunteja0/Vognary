export const requiredRecoveryMigration = "0023_recovery_v1";
export const requiredAutopilotIntegrityMigrations = [
  "0045_autopilot_mandate_execution_immutability",
  "0046_billed_window_immutability",
  "0047_billed_window_insert_immutability",
];
export const requiredAutopilotIntegrityTriggers = [
  "product_events_workspace_activated_immutable",
  "recovery_billing_year_anchors_immutable",
  "recovery_candidate_events_immutable",
  "recovery_classification_snapshots_immutable",
  "recovery_covered_windows_billed_immutable",
  "recovery_execution_attempts_immutable",
  "recovery_executions_immutable",
  "recovery_fee_ledger_immutable",
  "recovery_operator_actions_immutable",
  "recovery_standing_mandate_events_immutable",
  "recovery_standing_mandates_immutable",
];

export const requiredAutopilotAuditCountKeys = [
  "standing_mandate_events",
  "candidate_events",
  "operator_actions",
  "classification_snapshots",
  "executions",
  "execution_attempts",
];

export function hasAutopilotAuditFacts(counts) {
  if (!counts) return false;
  let total = BigInt(0);
  for (const key of requiredAutopilotAuditCountKeys) {
    const value = String(counts[key] ?? "");
    if (!/^\d+$/.test(value)) return false;
    total += BigInt(value);
  }
  return total > BigInt(0);
}

export async function readRecoveryBackupVerification(client) {
  const requiredMigrations = [requiredRecoveryMigration, ...requiredAutopilotIntegrityMigrations];
  const migrations = await client.query(
    `select id from schema_migrations where id = any($1::text[]) order by id`,
    [requiredMigrations],
  );
  const appliedMigrations = new Set(migrations.rows.map((row) => row.id));
  const missingMigrations = requiredMigrations.filter((id) => !appliedMigrations.has(id));
  if (missingMigrations.length) throw new Error(`Database is missing required migrations: ${missingMigrations.join(", ")}`);
  const triggers = await client.query(
    `select trigger.tgname as name
     from pg_trigger trigger
     join pg_class relation on relation.oid = trigger.tgrelid
     join pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and not trigger.tgisinternal
       and trigger.tgname = any($1::text[])
     order by trigger.tgname`,
    [requiredAutopilotIntegrityTriggers],
  );
  const integrityTriggers = triggers.rows.map((row) => row.name);
  const foundTriggers = new Set(integrityTriggers);
  const missingTriggers = requiredAutopilotIntegrityTriggers.filter((name) => !foundTriggers.has(name));
  if (missingTriggers.length) throw new Error(`Database is missing required integrity triggers: ${missingTriggers.join(", ")}`);

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
       (select count(*)::text from recovery_standing_mandate_events) as standing_mandate_events,
       (select count(*)::text from recovery_candidate_events) as candidate_events,
       (select count(*)::text from recovery_operator_actions) as operator_actions,
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
    requiredIntegrityMigrations: [...requiredAutopilotIntegrityMigrations],
    integrityTriggers,
    recoveryWorkspaceCounts: result.rows[0],
  };
}

export function recoveryBackupVerificationMatches(expected, actual) {
  if (!expected || expected.requiredMigration !== requiredRecoveryMigration) return false;
  if (actual.requiredMigration !== expected.requiredMigration) return false;
  if (!sameStrings(expected.requiredIntegrityMigrations, requiredAutopilotIntegrityMigrations)) return false;
  if (!sameStrings(actual.requiredIntegrityMigrations, requiredAutopilotIntegrityMigrations)) return false;
  if (!sameStrings(expected.integrityTriggers, requiredAutopilotIntegrityTriggers)) return false;
  if (!sameStrings(actual.integrityTriggers, requiredAutopilotIntegrityTriggers)) return false;
  const expectedCounts = expected.recoveryWorkspaceCounts;
  const actualCounts = actual.recoveryWorkspaceCounts;
  if (!expectedCounts || !actualCounts) return false;
  for (const key of requiredAutopilotAuditCountKeys) {
    if (!(key in expectedCounts) || !(key in actualCounts)) return false;
  }
  if (!hasAutopilotAuditFacts(expectedCounts) || !hasAutopilotAuditFacts(actualCounts)) return false;
  const keys = Object.keys(actualCounts);
  return keys.length === Object.keys(expectedCounts).length
    && keys.every((key) => String(expectedCounts[key]) === String(actualCounts[key]));
}

function sameStrings(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}
