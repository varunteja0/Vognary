import "server-only";

import { publicOffer } from "@/lib/public-offer";
import { getDatabasePool } from "@/lib/server/database";

export const productionFeatureMigrations = [
  "0002_revocable_sessions",
  "0003_living_ledger",
  "0004_privacy_lifecycle",
  "0005_product_experience_events",
  "0006_renewal_alerts",
  "0007_commitment_decisions",
  "0008_platform_api",
  "0009_consent_scope",
  "0010_connector_consent",
  "0011_workspace_state",
  "0012_workspace_state_materialization",
  "0013_billing_entitlements",
  "0014_sync_run_invocation",
  "0015_paid_audit_flow",
  "0016_assisted_audit_orders",
  "0017_shared_rate_limits",
  "0018_living_proof_graph",
  "0019_verified_outcome_loop",
  "0020_authorization_evidence",
  "0021_pending_connector_consent",
] as const;

type FeatureMigrationId = typeof productionFeatureMigrations[number];

export function getUnconfiguredFeatureReadiness() {
  return {
    schema: {
      status: "database-not-configured" as const,
      required: [...productionFeatureMigrations],
      applied: [] as FeatureMigrationId[],
      missing: [...productionFeatureMigrations],
    },
    privacyLifecycle: { status: "database-not-configured" as const, migrationId: "0004_privacy_lifecycle" as const, lastEnforcedAt: null },
    renewalAlerts: { status: "database-not-configured" as const, migrationId: "0006_renewal_alerts" as const, enabledPreferences: null, lastSentAt: null },
    commitmentDecisions: { status: "database-not-configured" as const, migrationId: "0007_commitment_decisions" as const, savedDecisions: null },
    platformApi: { status: "database-not-configured" as const, migrationId: "0008_platform_api" as const, activeTokens: null, lastUsedAt: null },
    billing: { status: "database-not-configured" as const, migrationId: "0016_assisted_audit_orders" as const, paidCheckouts: null, assistedAuditOrders: null, activeEntitlements: null, lastPaidAt: null },
    syncWorkers: { status: "database-not-configured" as const, migrationId: "0014_sync_run_invocation" as const, successfulCronRuns: null, lastCronEvidenceAt: null },
    proofGraph: { status: "database-not-configured" as const, migrationId: "0018_living_proof_graph" as const, workspacesWithBaseline: null, latestSequence: null },
    verifiedOutcomes: { status: "database-not-configured" as const, migrationId: "0019_verified_outcome_loop" as const, activeCases: null, verifiedReceipts: null, lastVerifiedAt: null },
  };
}

export async function checkFeatureReadiness() {
  const unavailable = getUnconfiguredFeatureReadiness();
  let applied: Set<string>;

  try {
    const result = await getDatabasePool().query<{ id: string }>(
      `select id
       from schema_migrations
       where id = any($1::text[])
       order by id`,
      [[...productionFeatureMigrations]],
    );
    applied = new Set(result.rows.map((row) => row.id));
  } catch {
    return {
      ...unavailable,
      schema: {
        status: "migration-ledger-unavailable" as const,
        required: [...productionFeatureMigrations],
        applied: [] as FeatureMigrationId[],
        missing: [...productionFeatureMigrations],
      },
      privacyLifecycle: { ...unavailable.privacyLifecycle, status: "migration-ledger-unavailable" as const },
      renewalAlerts: { ...unavailable.renewalAlerts, status: "migration-ledger-unavailable" as const },
      commitmentDecisions: { ...unavailable.commitmentDecisions, status: "migration-ledger-unavailable" as const },
      platformApi: { ...unavailable.platformApi, status: "migration-ledger-unavailable" as const },
      billing: { ...unavailable.billing, status: "migration-ledger-unavailable" as const },
      syncWorkers: { ...unavailable.syncWorkers, status: "migration-ledger-unavailable" as const },
      proofGraph: { ...unavailable.proofGraph, status: "migration-ledger-unavailable" as const },
      verifiedOutcomes: { ...unavailable.verifiedOutcomes, status: "migration-ledger-unavailable" as const },
    };
  }

  const appliedMigrations = productionFeatureMigrations.filter((id) => applied.has(id));
  const missingMigrations = productionFeatureMigrations.filter((id) => !applied.has(id));
  const [privacyLifecycle, renewalAlerts, commitmentDecisions, platformApi, billing, syncWorkers, proofGraph, verifiedOutcomes] = await Promise.all([
    checkPrivacyLifecycle(applied),
    checkRenewalAlerts(applied),
    checkCommitmentDecisions(applied),
    checkPlatformApi(applied),
    checkBilling(applied),
    checkSyncWorkers(applied),
    checkProofGraph(applied),
    checkVerifiedOutcomes(applied),
  ]);
  const capabilityQueryFailed = [privacyLifecycle, renewalAlerts, commitmentDecisions, platformApi, billing, syncWorkers, proofGraph, verifiedOutcomes]
    .some((feature) => feature.status === "schema-query-failed");

  return {
    schema: {
      status: missingMigrations.length
        ? "migrations-pending" as const
        : capabilityQueryFailed
          ? "capability-query-failed" as const
          : "ready" as const,
      required: [...productionFeatureMigrations],
      applied: appliedMigrations,
      missing: missingMigrations,
    },
    privacyLifecycle,
    renewalAlerts,
    commitmentDecisions,
    platformApi,
    billing,
    syncWorkers,
    proofGraph,
    verifiedOutcomes,
  };
}

async function checkVerifiedOutcomes(applied: Set<string>) {
  const migrationId = "0019_verified_outcome_loop" as const;
  if (!applied.has(migrationId)) {
    return { status: "migration-pending" as const, migrationId, activeCases: null, verifiedReceipts: null, lastVerifiedAt: null };
  }
  try {
    const result = await getDatabasePool().query<{
      active_cases: number; verified_receipts: number; last_verified_at: Date | null;
    }>(
      `select
         (select count(*)::int from action_cases
          where status in ('authorized', 'in-progress', 'provider-pending', 'executed', 'verifying')) as active_cases,
         (select count(*)::int from verified_saving_receipts where status = 'active') as verified_receipts,
         (select max(minted_at) from verified_saving_receipts where status = 'active') as last_verified_at`,
    );
    const row = result.rows[0];
    const activeCases = row?.active_cases ?? 0;
    const verifiedReceipts = row?.verified_receipts ?? 0;
    const lastVerifiedAt = row?.last_verified_at?.toISOString() ?? null;
    return {
      status: verifiedReceipts > 0
        ? "verified-receipt-observed" as const
        : activeCases > 0
          ? "active-cases-observed-proof-pending" as const
          : "schema-ready-no-cases" as const,
      migrationId,
      activeCases,
      verifiedReceipts,
      lastVerifiedAt,
    };
  } catch {
    return { status: "schema-query-failed" as const, migrationId, activeCases: null, verifiedReceipts: null, lastVerifiedAt: null };
  }
}

async function checkProofGraph(applied: Set<string>) {
  const migrationId = "0018_living_proof_graph" as const;
  if (!applied.has(migrationId)) {
    return { status: "migration-pending" as const, migrationId, workspacesWithBaseline: null, latestSequence: null };
  }
  try {
    const result = await getDatabasePool().query<{ workspaces_with_baseline: number; latest_sequence: string | null }>(
      `select
         count(distinct workspace_id) filter (where event_type = 'graph.baseline.created')::int as workspaces_with_baseline,
         max(workspace_sequence)::text as latest_sequence
       from ledger_events`,
    );
    const row = result.rows[0];
    const workspacesWithBaseline = row?.workspaces_with_baseline ?? 0;
    const latestSequence = row?.latest_sequence ? Number(row.latest_sequence) : null;
    return {
      status: workspacesWithBaseline > 0 ? "baseline-observed" as const : "schema-ready-no-workspaces" as const,
      migrationId,
      workspacesWithBaseline,
      latestSequence,
    };
  } catch {
    return { status: "schema-query-failed" as const, migrationId, workspacesWithBaseline: null, latestSequence: null };
  }
}

async function checkPrivacyLifecycle(applied: Set<string>) {
  const migrationId = "0004_privacy_lifecycle" as const;
  if (!applied.has(migrationId)) return { status: "migration-pending" as const, migrationId, lastEnforcedAt: null };

  try {
    const result = await getDatabasePool().query<{ last_enforced_at: Date | null }>(
      `select max(finished_at) filter (where invocation = 'cron' and not dry_run and status = 'completed') as last_enforced_at
       from retention_runs`,
    );
    const row = result.rows[0];
    const lastEnforcedAt = row?.last_enforced_at?.toISOString() ?? null;
    return {
      status: lastEnforcedAt ? "last-run-observed-schedule-unverified" as const : "schema-ready-enforcement-unproven" as const,
      migrationId,
      lastEnforcedAt,
    };
  } catch {
    return { status: "schema-query-failed" as const, migrationId, lastEnforcedAt: null };
  }
}

async function checkRenewalAlerts(applied: Set<string>) {
  const migrationId = "0006_renewal_alerts" as const;
  if (!applied.has(migrationId)) return { status: "migration-pending" as const, migrationId, enabledPreferences: null, lastSentAt: null };

  try {
    const result = await getDatabasePool().query<{ enabled_preferences: number; last_sent_at: Date | null }>(
      `select
         (select count(*)::int from renewal_alert_preferences where enabled) as enabled_preferences,
         (select max(sent_at) from renewal_alert_deliveries where status = 'sent' and last_invocation = 'cron') as last_sent_at`,
    );
    const row = result.rows[0];
    const enabledPreferences = row?.enabled_preferences ?? 0;
    const lastSentAt = row?.last_sent_at?.toISOString() ?? null;
    return {
      status: lastSentAt
        ? "delivery-observed-schedule-unverified" as const
        : enabledPreferences > 0
          ? "opt-ins-observed-delivery-unproven" as const
          : "schema-ready-default-off" as const,
      migrationId,
      enabledPreferences,
      lastSentAt,
    };
  } catch {
    return { status: "schema-query-failed" as const, migrationId, enabledPreferences: null, lastSentAt: null };
  }
}

async function checkCommitmentDecisions(applied: Set<string>) {
  const migrationId = "0007_commitment_decisions" as const;
  if (!applied.has(migrationId)) return { status: "migration-pending" as const, migrationId, savedDecisions: null };

  try {
    const result = await getDatabasePool().query<{ saved_decisions: number }>(
      `select count(*)::int as saved_decisions from commitment_decisions`,
    );
    const savedDecisions = result.rows[0]?.saved_decisions ?? 0;
    return {
      status: savedDecisions > 0 ? "decisions-observed" as const : "schema-ready-no-decisions" as const,
      migrationId,
      savedDecisions,
    };
  } catch {
    return { status: "schema-query-failed" as const, migrationId, savedDecisions: null };
  }
}

async function checkPlatformApi(applied: Set<string>) {
  const migrationId = "0008_platform_api" as const;
  if (!applied.has(migrationId)) return { status: "migration-pending" as const, migrationId, activeTokens: null, lastUsedAt: null };

  try {
    const result = await getDatabasePool().query<{ active_tokens: number; last_used_at: Date | null }>(
      `select
         count(*) filter (where revoked_at is null and expires_at > now())::int as active_tokens,
         max(last_used_at) as last_used_at
       from platform_api_tokens`,
    );
    const row = result.rows[0];
    const activeTokens = row?.active_tokens ?? 0;
    const lastUsedAt = row?.last_used_at?.toISOString() ?? null;
    return {
      status: lastUsedAt
        ? "consumer-traffic-observed" as const
        : activeTokens > 0
          ? "tokens-created-consumer-traffic-unproven" as const
          : "schema-ready-no-active-tokens" as const,
      migrationId,
      activeTokens,
      lastUsedAt,
    };
  } catch {
    return { status: "schema-query-failed" as const, migrationId, activeTokens: null, lastUsedAt: null };
  }
}

async function checkBilling(applied: Set<string>) {
  const migrationId = "0016_assisted_audit_orders" as const;
  if (!applied.has("0013_billing_entitlements") || !applied.has("0015_paid_audit_flow") || !applied.has(migrationId)) {
    return { status: "migration-pending" as const, migrationId, paidCheckouts: null, assistedAuditOrders: null, activeEntitlements: null, lastPaidAt: null };
  }

  try {
    const result = await getDatabasePool().query<{ paid_checkouts: number; assisted_audit_orders: number; active_entitlements: number; last_paid_at: Date | null }>(
      `select
         (select count(*)::int
          from billing_checkout_sessions
          where plan = $1 and offer_id = $2 and offer_version = $3 and terms_version = $4
            and status in ('paid', 'partially_refunded')) as paid_checkouts,
         (select count(*)::int
          from assisted_audit_orders orders
          join billing_checkout_sessions checkout on checkout.id = orders.checkout_session_id
          where checkout.plan = $1 and checkout.offer_id = $2
            and checkout.offer_version = $3 and checkout.terms_version = $4
            and checkout.status in ('paid', 'partially_refunded')
            and orders.status in ('pending', 'in_progress', 'delivered')) as assisted_audit_orders,
         (select count(*)::int from workspace_entitlements where status = 'active' and expires_at > now()) as active_entitlements,
         (select max(paid_at)
          from billing_checkout_sessions
          where plan = $1 and offer_id = $2 and offer_version = $3 and terms_version = $4
            and status in ('paid', 'partially_refunded')) as last_paid_at`,
      [publicOffer.plan, publicOffer.id, publicOffer.version, publicOffer.termsVersion],
    );
    const row = result.rows[0];
    const paidCheckouts = row?.paid_checkouts ?? 0;
    const assistedAuditOrders = row?.assisted_audit_orders ?? 0;
    const activeEntitlements = row?.active_entitlements ?? 0;
    const lastPaidAt = row?.last_paid_at?.toISOString() ?? null;
    return {
      status: assistedAuditOrders > 0 ? "assisted-audit-order-observed" as const : activeEntitlements > 0 ? "legacy-active-entitlement-observed" as const : paidCheckouts > 0 ? "payment-observed-no-order" as const : "schema-ready-no-settlements" as const,
      migrationId,
      paidCheckouts,
      assistedAuditOrders,
      activeEntitlements,
      lastPaidAt,
    };
  } catch {
    return { status: "schema-query-failed" as const, migrationId, paidCheckouts: null, assistedAuditOrders: null, activeEntitlements: null, lastPaidAt: null };
  }
}

async function checkSyncWorkers(applied: Set<string>) {
  const migrationId = "0014_sync_run_invocation" as const;
  if (!applied.has(migrationId)) return { status: "migration-pending" as const, migrationId, successfulCronRuns: null, lastCronEvidenceAt: null };

  try {
    const result = await getDatabasePool().query<{ successful_cron_runs: number; last_cron_evidence_at: Date | null }>(
      `select
         count(*) filter (where invocation = 'cron' and status = 'succeeded' and evidence_written > 0)::int as successful_cron_runs,
         max(finished_at) filter (where invocation = 'cron' and status = 'succeeded' and evidence_written > 0) as last_cron_evidence_at
       from connector_sync_runs`,
    );
    const row = result.rows[0];
    const successfulCronRuns = row?.successful_cron_runs ?? 0;
    const lastCronEvidenceAt = row?.last_cron_evidence_at?.toISOString() ?? null;
    return {
      status: lastCronEvidenceAt ? "cron-evidence-observed-schedule-unverified" as const : "schema-ready-cron-evidence-unproven" as const,
      migrationId,
      successfulCronRuns,
      lastCronEvidenceAt,
    };
  } catch {
    return { status: "schema-query-failed" as const, migrationId, successfulCronRuns: null, lastCronEvidenceAt: null };
  }
}
