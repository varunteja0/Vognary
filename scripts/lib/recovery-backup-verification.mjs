export const requiredRecoveryMigration = "0023_recovery_v1";
export const pre0053RecoveryMigrations = [
  "0023_recovery_v1",
  "0024_recovery_inbound_receipts",
  "0025_recovery_renewal_alerts",
  "0026_recovery_inbound_retention",
];
export const pre0053IntegrityMigrations = pre0053RecoveryMigrations.slice(1);
export const pre0053IntegrityTriggers = [
  "connector_evidence_running_job_guard",
  "connector_sync_jobs_recovery_cutover_guard",
  "renewal_alert_deliveries_recovery_cutover_guard",
];
export const requiredAutopilotIntegrityMigrations = [
  "0045_autopilot_mandate_execution_immutability",
  "0046_billed_window_immutability",
  "0047_billed_window_insert_immutability",
  "0048_receipt_sender_provenance",
  "0049_recovery_merchant_identity",
  "0050_recovery_commitment_lifecycle",
  "0051_recovery_change_signals",
  "0052_recovery_correction_learning",
  "0053_phase_a_receipt_activation",
  "0054_recovery_commitment_context",
  "0055_recovery_decision_cycles",
];
export const requiredAutopilotIntegrityTriggers = [
  "product_events_workspace_activated_immutable",
  "recovery_billing_year_anchors_immutable",
  "recovery_cancellation_events_append_only_trigger",
  "recovery_candidate_events_immutable",
  "recovery_classification_snapshots_immutable",
  "recovery_correction_outcomes_append_only_trigger",
  "recovery_covered_windows_billed_immutable",
  "recovery_execution_attempts_immutable",
  "recovery_executions_immutable",
  "recovery_fee_ledger_immutable",
  "recovery_inbound_alias_milestones_immutable",
  "recovery_inbound_sender_assessments_immutable_trigger",
  "recovery_merchant_links_currency_trigger",
  "recovery_merchant_signals_append_only_trigger",
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

export const backupVerificationProfiles = ["pre-0053", "current"];

export function normalizeBackupVerificationProfile(value) {
  const profile = value?.trim() || "current";
  if (!backupVerificationProfiles.includes(profile)) {
    throw new Error(`Unknown backup verification profile: ${profile}`);
  }
  return profile;
}

export function requiredRecoveryTablesForProfile(value) {
  const profile = normalizeBackupVerificationProfile(value);
  const base = [
    "recovery_workspace_states",
    "recovery_workspace_versions",
    "recovery_submissions",
    "recovery_sources",
    "recovery_commitments",
    "recovery_evidence",
    "recovery_commitment_evidence",
    "recovery_corrections",
    "recovery_decisions",
    "recovery_changes",
    "recovery_idempotency_keys",
    "recovery_inbound_aliases",
    "recovery_inbound_events",
    "recovery_inbound_replay_keys",
  ];
  if (profile === "pre-0053") return base;
  return [
    ...base,
    "recovery_commitment_context",
    "recovery_decision_cycles",
    "recovery_standing_mandates",
    "recovery_action_candidates",
    "recovery_covered_windows",
    "recovery_fee_ledger",
    "recovery_execution_attempts",
    "recovery_standing_mandate_events",
    "recovery_candidate_events",
    "recovery_operator_actions",
    "recovery_classification_snapshots",
    "recovery_executions",
    "recovery_shadow_gate_snapshots",
    "recovery_notice_delivery_events",
    "recovery_autopilot_dead_letters",
    "recovery_billing_year_anchors",
    "recovery_notice_pending_events",
    "recovery_connected_mandate_cohort",
    "recovery_source_disconnections",
    "recovery_veto_notices",
    "recovery_provider_disables",
    "recovery_inbound_sender_assessments",
    "recovery_source_health",
  ];
}

function verificationProfile(value) {
  const profile = normalizeBackupVerificationProfile(value);
  return profile === "pre-0053"
    ? {
        profile,
        migrationHead: "0026_recovery_inbound_retention",
        requiredMigrations: pre0053RecoveryMigrations,
        integrityMigrations: pre0053IntegrityMigrations,
        requiredTriggers: pre0053IntegrityTriggers,
      }
    : {
        profile,
        migrationHead: "0055_recovery_decision_cycles",
        requiredMigrations: [requiredRecoveryMigration, ...requiredAutopilotIntegrityMigrations],
        integrityMigrations: requiredAutopilotIntegrityMigrations,
        requiredTriggers: requiredAutopilotIntegrityTriggers,
      };
}

export async function readRecoveryBackupVerification(client, requestedProfile = "current") {
  const profile = verificationProfile(requestedProfile);
  const head = await client.query(`select id from schema_migrations order by id desc limit 1`);
  const migrationHead = head.rows[0]?.id ?? null;
  if (migrationHead !== profile.migrationHead) {
    throw new Error(`Database migration head is ${migrationHead ?? "missing"}; ${profile.profile} backup requires ${profile.migrationHead}.`);
  }
  const requiredMigrations = profile.requiredMigrations;
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
    [profile.requiredTriggers],
  );
  const integrityTriggers = triggers.rows.map((row) => row.name);
  const foundTriggers = new Set(integrityTriggers);
  const missingTriggers = profile.requiredTriggers.filter((name) => !foundTriggers.has(name));
  if (missingTriggers.length) throw new Error(`Database is missing required integrity triggers: ${missingTriggers.join(", ")}`);

  const result = await client.query(profile.profile === "pre-0053" ? pre0053CountQuery : currentCountQuery);

  return {
    profile: profile.profile,
    migrationHead,
    requiredMigration: requiredRecoveryMigration,
    requiredIntegrityMigrations: [...profile.integrityMigrations],
    integrityTriggers,
    recoveryWorkspaceCounts: result.rows[0],
  };
}

const pre0053CountQuery = `select
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
       (select count(*)::text from recovery_inbound_aliases) as inbound_aliases,
       (select count(*)::text from recovery_inbound_events) as inbound_events,
       (select count(*)::text from recovery_inbound_replay_keys) as inbound_replay_keys`;

const currentCountQuery =
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
      (select count(*)::text from recovery_inbound_sender_assessments) as inbound_sender_assessments,
      (select count(*)::text from recovery_source_health) as source_health,
       (select count(*)::text from recovery_inbound_replay_keys) as inbound_replay_keys`;

export function recoveryBackupVerificationMatches(expected, actual) {
  if (!expected || expected.requiredMigration !== requiredRecoveryMigration) return false;
  let profile;
  try {
    profile = verificationProfile(expected.profile);
  } catch {
    return false;
  }
  if (actual.profile !== profile.profile || expected.migrationHead !== profile.migrationHead || actual.migrationHead !== profile.migrationHead) return false;
  if (actual.requiredMigration !== expected.requiredMigration) return false;
  if (!sameStrings(expected.requiredIntegrityMigrations, profile.integrityMigrations)) return false;
  if (!sameStrings(actual.requiredIntegrityMigrations, profile.integrityMigrations)) return false;
  if (!sameStrings(expected.integrityTriggers, profile.requiredTriggers)) return false;
  if (!sameStrings(actual.integrityTriggers, profile.requiredTriggers)) return false;
  const expectedCounts = expected.recoveryWorkspaceCounts;
  const actualCounts = actual.recoveryWorkspaceCounts;
  if (!expectedCounts || !actualCounts) return false;
  if (profile.profile === "current") {
    for (const key of requiredAutopilotAuditCountKeys) {
      if (!(key in expectedCounts) || !(key in actualCounts)) return false;
    }
  }
  const keys = Object.keys(actualCounts);
  return keys.length === Object.keys(expectedCounts).length
    && keys.every((key) => String(expectedCounts[key]) === String(actualCounts[key]));
}

function sameStrings(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}
