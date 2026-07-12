import "server-only";

import { getDatabasePool } from "@/lib/server/database";

export type WorkspaceConnectedAccountSummary = {
  id: string;
  connectorId: string;
  providerAccountId: string | null;
  displayName: string;
  scopes: string[];
  status: string;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  coverageStartAt: string | null;
  coverageEndAt: string | null;
  coverageCompleteness: "partial" | "complete" | null;
  freshnessStatus: "unknown" | "fresh" | "stale" | "error" | null;
  createdAt: string;
  updatedAt: string;
  latestRunStatus: string | null;
  latestRunAt: string | null;
  evidenceCount: number;
};

export type WorkspaceConnectorEvidence = {
  id: string;
  connectorId: string;
  connectedAccountId: string | null;
  provider: string;
  evidenceType: string;
  observedAt: string;
  merchantRaw: string | null;
  amount: number | null;
  currency: string | null;
  cadenceHint: string | null;
  nextDebitHint: string | null;
  confidenceScore: number;
};

export type WorkspaceRecurringItem = {
  id: string;
  merchant: string;
  normalizedMerchant: string;
  category: string;
  frequency: string;
  currency: string;
  amountMin: number;
  amountMax: number;
  averageAmount: number;
  monthlyCost: number;
  annualCost: number;
  lastChargeDate: string | null;
  nextExpectedDate: string | null;
  confidenceScore: number;
  status: string;
  recommendationReason: string | null;
  riskTags: string[];
  firstDetectedAt: string;
  updatedAt: string;
  connectorIds: string[];
  evidenceCount: number;
  lastObservedAt: string | null;
};

type ConnectedAccountRow = {
  id: string;
  connector_id: string;
  provider_account_id: string | null;
  display_name: string;
  scopes: string[];
  status: string;
  last_synced_at: Date | null;
  next_sync_at: Date | null;
  coverage_start_at: Date | null;
  coverage_end_at: Date | null;
  coverage_completeness: "partial" | "complete" | null;
  freshness_status: "unknown" | "fresh" | "stale" | "error" | null;
  created_at: Date;
  updated_at: Date;
  latest_run_status: string | null;
  latest_run_at: Date | null;
  evidence_count: string;
};

type EvidenceRow = {
  id: string;
  connector_id: string;
  connected_account_id: string | null;
  provider: string;
  evidence_type: string;
  observed_at: Date;
  merchant_raw: string | null;
  amount: string | null;
  currency: string | null;
  cadence_hint: string | null;
  next_debit_hint: Date | null;
  confidence_score: number;
};

type RecurringItemRow = {
  id: string;
  merchant: string;
  normalized_merchant: string;
  category: string;
  frequency: string;
  currency: string;
  amount_min: string;
  amount_max: string;
  average_amount: string;
  monthly_cost: string;
  annual_cost: string;
  last_charge_date: Date | string | null;
  next_expected_date: Date | string | null;
  confidence_score: number;
  status: string;
  recommendation_reason: string | null;
  risk_tags: string[];
  first_detected_at: Date;
  updated_at: Date;
  connector_ids: string[];
  evidence_count: string;
  last_observed_at: Date | null;
};

export async function listWorkspaceConnectedAccounts(workspaceId: string): Promise<WorkspaceConnectedAccountSummary[]> {
  const result = await getDatabasePool().query<ConnectedAccountRow>(
    `select
       ca.id,
       ca.connector_id,
       ca.provider_account_id,
       ca.display_name,
       ca.scopes,
       ca.status,
       ca.last_synced_at,
       next_job.next_run_at as next_sync_at,
       ds.coverage_start_at,
       ds.coverage_end_at,
       ds.coverage_completeness,
       case
         when ds.freshness_status = 'fresh'
          and (
            next_job.next_run_at < now() - interval '15 minutes'
            or (
              next_job.next_run_at is null
              and ds.last_synced_at < now() - interval '48 hours'
            )
          )
         then 'stale'
         else ds.freshness_status
       end as freshness_status,
       ca.created_at,
       ca.updated_at,
       latest_run.status as latest_run_status,
       latest_run.started_at as latest_run_at,
       (select count(*) from connector_evidence ce where ce.connected_account_id = ca.id) as evidence_count
     from connected_accounts ca
     left join data_sources ds on ds.id = ca.source_id and ds.workspace_id = ca.workspace_id
     left join lateral (
       select status, started_at
       from connector_sync_runs csr
       where csr.connected_account_id = ca.id
       order by started_at desc
       limit 1
     ) latest_run on true
     left join lateral (
       select min(next_run_at) as next_run_at
       from connector_sync_jobs csj
       where csj.connected_account_id = ca.id
         and csj.status in ('queued', 'failed')
     ) next_job on true
     where ca.workspace_id = $1
     order by ca.updated_at desc`,
    [workspaceId],
  );

  return result.rows.map(mapConnectedAccount);
}

export async function getWorkspaceConnectedAccount(workspaceId: string, connectedAccountId: string) {
  const result = await getDatabasePool().query<ConnectedAccountRow>(
    `select
       ca.id,
       ca.connector_id,
       ca.provider_account_id,
       ca.display_name,
       ca.scopes,
       ca.status,
       ca.last_synced_at,
       next_job.next_run_at as next_sync_at,
       ds.coverage_start_at,
       ds.coverage_end_at,
       ds.coverage_completeness,
       case
         when ds.freshness_status = 'fresh'
          and (
            next_job.next_run_at < now() - interval '15 minutes'
            or (
              next_job.next_run_at is null
              and ds.last_synced_at < now() - interval '48 hours'
            )
          )
         then 'stale'
         else ds.freshness_status
       end as freshness_status,
       ca.created_at,
       ca.updated_at,
       latest_run.status as latest_run_status,
       latest_run.started_at as latest_run_at,
       (select count(*) from connector_evidence ce where ce.connected_account_id = ca.id) as evidence_count
     from connected_accounts ca
     left join data_sources ds on ds.id = ca.source_id and ds.workspace_id = ca.workspace_id
     left join lateral (
       select status, started_at
       from connector_sync_runs csr
       where csr.connected_account_id = ca.id
       order by started_at desc
       limit 1
     ) latest_run on true
     left join lateral (
       select min(next_run_at) as next_run_at
       from connector_sync_jobs csj
       where csj.connected_account_id = ca.id
         and csj.status in ('queued', 'failed')
     ) next_job on true
     where ca.workspace_id = $1
       and ca.id = $2
     limit 1`,
    [workspaceId, connectedAccountId],
  );

  const row = result.rows[0];
  return row ? mapConnectedAccount(row) : null;
}

export async function listWorkspaceConnectorEvidence(workspaceId: string, limit = 100): Promise<WorkspaceConnectorEvidence[]> {
  const result = await getDatabasePool().query<EvidenceRow>(
    `select id,
            connector_id,
            connected_account_id,
            provider,
            evidence_type,
            observed_at,
            merchant_raw,
            amount,
            currency,
            cadence_hint,
            next_debit_hint,
            confidence_score
     from connector_evidence
     where workspace_id = $1
     order by observed_at desc, created_at desc
     limit $2`,
    [workspaceId, Math.max(1, Math.min(limit, 250))],
  );

  return result.rows.map(mapEvidence);
}

export async function listWorkspaceRecurringItems(
  workspaceId: string,
  limit = 250,
  connectorOnly = false,
  afterId: string | null = null,
  orderById = false,
): Promise<WorkspaceRecurringItem[]> {
  const result = await getDatabasePool().query<RecurringItemRow>(
    `select
       ri.id,
       ri.merchant,
       ri.normalized_merchant,
       ri.category,
       ri.frequency,
       ri.currency,
       ri.amount_min,
       ri.amount_max,
       ri.average_amount,
       ri.monthly_cost,
       ri.annual_cost,
       ri.last_charge_date,
       ri.next_expected_date,
       ri.confidence_score,
       ri.status,
       ri.recommendation_reason,
       ri.risk_tags,
       ri.first_detected_at,
       ri.updated_at,
       coalesce(array_agg(distinct ce.connector_id) filter (where ce.connector_id is not null), '{}') as connector_ids,
       count(ce.id) as evidence_count,
       max(ce.observed_at) as last_observed_at
     from recurring_items ri
     left join connector_evidence ce on ce.recurring_item_id = ri.id
     where ri.workspace_id = $1
       and (not $3::boolean or ri.external_reference like 'connector:%')
       and ($4::uuid is null or ri.id > $4::uuid)
     group by ri.id
     order by
       case when $5::boolean then ri.id end asc,
       case when not $5::boolean then ri.next_expected_date end asc nulls last,
       case when not $5::boolean then ri.updated_at end desc
     limit $2`,
    [workspaceId, Math.max(1, Math.min(limit, 501)), connectorOnly, afterId, orderById],
  );

  return result.rows.map(mapRecurringItem);
}

export async function revokeWorkspaceConnectedAccount(workspaceId: string, connectedAccountId: string) {
  const client = await getDatabasePool().connect();

  try {
    await client.query("begin");
    const account = await client.query<{ id: string; source_id: string | null; consent_grant_id: string | null }>(
      `update connected_accounts
       set status = 'revoked',
           last_error = null,
           last_error_at = null,
           updated_at = now()
       where workspace_id = $1
         and id = $2
      returning id, source_id, consent_grant_id`,
      [workspaceId, connectedAccountId],
    );

    if (!account.rowCount) {
      await client.query("rollback");
      return { revoked: false, tokenRefsRevoked: 0 };
    }

    const tokenRefs = await client.query(
      `update connector_token_refs
       set status = 'revoked',
           secret_ref = 'deleted',
           encrypted_payload = '{}'::jsonb,
           key_fingerprint = null,
           scopes = '{}',
           expires_at = null,
           metadata = '{}'::jsonb,
           updated_at = now()
       where connected_account_id = $1`,
      [connectedAccountId],
    );
    const jobs = await client.query(
      `update connector_sync_jobs
       set status = 'blocked',
           next_run_at = null,
           locked_at = null,
           locked_by = null,
           last_error = 'Connector disconnected by a workspace administrator.',
           last_error_at = now(),
           updated_at = now()
       where connected_account_id = $1
         and status in ('queued', 'running', 'failed', 'paused')`,
      [connectedAccountId],
    );
    const runs = await client.query(
      `update connector_sync_runs
       set status = 'blocked',
           finished_at = now(),
           error_code = 'connector_disconnected',
           error_message = 'Connector disconnected by a workspace administrator.'
       where connected_account_id = $1
         and status = 'running'`,
      [connectedAccountId],
    );
    const consentGrantId = account.rows[0]?.consent_grant_id;
    const consent = consentGrantId
      ? await client.query(
        `update consent_grants
         set withdrawn_at = coalesce(withdrawn_at, now())
         where id = $1
           and workspace_id = $2
           and withdrawn_at is null`,
        [consentGrantId, workspaceId],
      )
      : null;
    const sourceId = account.rows[0]?.source_id;
    if (sourceId) {
      await client.query(
        `update data_sources
         set status = 'revoked', freshness_status = 'unknown', updated_at = now()
         where workspace_id = $1 and id = $2`,
        [workspaceId, sourceId],
      );
    }

    await client.query("commit");
    return {
      revoked: true,
      tokenRefsRevoked: tokenRefs.rowCount ?? 0,
      syncJobsBlocked: jobs.rowCount ?? 0,
      syncRunsBlocked: runs.rowCount ?? 0,
      consentGrantsWithdrawn: consent?.rowCount ?? 0,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function mapConnectedAccount(row: ConnectedAccountRow): WorkspaceConnectedAccountSummary {
  return {
    id: row.id,
    connectorId: row.connector_id,
    providerAccountId: row.provider_account_id,
    displayName: row.display_name,
    scopes: row.scopes,
    status: row.status,
    lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
    nextSyncAt: row.next_sync_at?.toISOString() ?? null,
    coverageStartAt: row.coverage_start_at?.toISOString() ?? null,
    coverageEndAt: row.coverage_end_at?.toISOString() ?? null,
    coverageCompleteness: row.coverage_completeness,
    freshnessStatus: row.freshness_status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    latestRunStatus: row.latest_run_status,
    latestRunAt: row.latest_run_at?.toISOString() ?? null,
    evidenceCount: Number(row.evidence_count),
  };
}

function mapEvidence(row: EvidenceRow): WorkspaceConnectorEvidence {
  return {
    id: row.id,
    connectorId: row.connector_id,
    connectedAccountId: row.connected_account_id,
    provider: row.provider,
    evidenceType: row.evidence_type,
    observedAt: row.observed_at.toISOString(),
    merchantRaw: row.merchant_raw,
    amount: row.amount === null ? null : Number(row.amount),
    currency: row.currency,
    cadenceHint: row.cadence_hint,
    nextDebitHint: row.next_debit_hint?.toISOString().slice(0, 10) ?? null,
    confidenceScore: row.confidence_score,
  };
}

function mapRecurringItem(row: RecurringItemRow): WorkspaceRecurringItem {
  return {
    id: row.id,
    merchant: row.merchant,
    normalizedMerchant: row.normalized_merchant,
    category: row.category,
    frequency: row.frequency,
    currency: row.currency,
    amountMin: Number(row.amount_min),
    amountMax: Number(row.amount_max),
    averageAmount: Number(row.average_amount),
    monthlyCost: Number(row.monthly_cost),
    annualCost: Number(row.annual_cost),
    lastChargeDate: toDateOnly(row.last_charge_date),
    nextExpectedDate: toDateOnly(row.next_expected_date),
    confidenceScore: row.confidence_score,
    status: row.status,
    recommendationReason: row.recommendation_reason,
    riskTags: row.risk_tags,
    firstDetectedAt: row.first_detected_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    connectorIds: row.connector_ids,
    evidenceCount: Number(row.evidence_count),
    lastObservedAt: row.last_observed_at?.toISOString() ?? null,
  };
}

function toDateOnly(value: Date | string | null) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}
