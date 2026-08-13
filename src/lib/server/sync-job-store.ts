import "server-only";

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { ConnectorEvidence } from "@/lib/connector-runtime";
import { getDatabasePool, isDatabaseConfigured } from "@/lib/server/database";
import { refuseLegacyLedgerWrite } from "@/lib/server/legacy-ledger-freeze";

export type SyncJobStatus = "queued" | "running" | "succeeded" | "failed" | "paused" | "blocked";
export type SyncJobType = "initial_sync" | "incremental_sync" | "backfill" | "webhook_replay" | "manual_refresh";

export type ConnectorSyncJobRecord = {
  id: string;
  workspaceId: string;
  connectedAccountId: string | null;
  connectorId: string;
  jobType: SyncJobType;
  status: SyncJobStatus;
  cursorState: Record<string, unknown>;
  attemptCount: number;
};

export type CreateConnectorSyncJobInput = {
  workspaceId: string;
  connectedAccountId?: string | null;
  connectorId: string;
  jobType?: SyncJobType;
  cursorState?: Record<string, unknown>;
  priority?: number;
};

export class SyncJobNotRunnableError extends Error {
  constructor(jobId: string) {
    super(`Sync job ${jobId} is not runnable in its current state.`);
    this.name = "SyncJobNotRunnableError";
  }
}

export function assertDatabaseReadyForSyncJobs() {
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is required for internal sync jobs.");
  }
}

export async function createConnectorSyncJob(input: CreateConnectorSyncJobInput, client?: PoolClient) {
  assertDatabaseReadyForSyncJobs();

  const queryable = client ?? getDatabasePool();
  const result = await queryable.query<ConnectorSyncJobRow>(
    `insert into connector_sync_jobs (
      workspace_id,
      connected_account_id,
      connector_id,
      job_type,
      status,
      priority,
      cursor_state,
      next_run_at
    ) values (
      $1,
      $2,
      $3,
      $4,
      'queued',
      $5,
      coalesce((
        select cursor_state
        from connector_sync_jobs previous_job
        where previous_job.connected_account_id = $2
          and previous_job.connector_id = $3
          and previous_job.last_succeeded_at is not null
        order by previous_job.last_succeeded_at desc, previous_job.updated_at desc
        limit 1
      ), '{}'::jsonb) || $6::jsonb,
      now()
    )
    returning id, workspace_id, connected_account_id, connector_id, job_type, status, cursor_state, attempt_count`,
    [
      input.workspaceId,
      input.connectedAccountId ?? null,
      input.connectorId,
      input.jobType ?? "manual_refresh",
      input.priority ?? 100,
      input.cursorState ?? {},
    ],
  );

  const row = result.rows[0];
  if (!row) throw new Error("Sync job insert did not return a row.");
  return mapSyncJob(row);
}

export async function getConnectorSyncJob(jobId: string) {
  assertDatabaseReadyForSyncJobs();

  const result = await getDatabasePool().query<ConnectorSyncJobRow>(
    `select id, workspace_id, connected_account_id, connector_id, job_type, status, cursor_state, attempt_count
     from connector_sync_jobs
     where id = $1`,
    [jobId],
  );

  const row = result.rows[0];
  return row ? mapSyncJob(row) : null;
}

export async function assertConnectorSyncRunRunnable(input: { jobId: string; runId: string }) {
  const result = await getDatabasePool().query<{ runnable: boolean }>(
    `select exists (
       select 1
       from connector_sync_jobs job
       join connector_sync_runs run on run.sync_job_id = job.id
       where job.id = $1 and run.id = $2
         and job.status = 'running' and run.status = 'running'
     ) as runnable`,
    [input.jobId, input.runId],
  );
  if (!result.rows[0]?.runnable) throw new SyncJobNotRunnableError(input.jobId);
}

export async function listDueConnectorSyncJobs(limit = 5) {
  assertDatabaseReadyForSyncJobs();

  await recoverStaleConnectorSyncJobs();

  const result = await getDatabasePool().query<ConnectorSyncJobRow>(
    `select id, workspace_id, connected_account_id, connector_id, job_type, status, cursor_state, attempt_count
     from connector_sync_jobs
     where status in ('queued', 'failed')
       and attempt_count < 8
       and locked_at is null
       and (next_run_at is null or next_run_at <= now())
     order by priority asc, next_run_at asc nulls first, updated_at asc
     limit $1`,
    [Math.max(1, Math.min(limit, 20))],
  );

  return result.rows.map(mapSyncJob);
}

export async function beginConnectorSyncRun(job: ConnectorSyncJobRecord, invocation: "cron" | "internal-api" | "manual" | "initial-setup") {
  assertDatabaseReadyForSyncJobs();

  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const lock = await client.query(
      `update connector_sync_jobs
       set status = 'running',
           locked_at = now(),
           locked_by = 'vognary-internal-runner',
           attempt_count = attempt_count + 1,
           updated_at = now()
       where id = $1
         and status in ('queued', 'failed', 'paused')
         and locked_at is null
       returning id`,
      [job.id],
    );

    if (!lock.rowCount) throw new SyncJobNotRunnableError(job.id);

    const result = await client.query<{ id: string }>(
      `insert into connector_sync_runs (
        sync_job_id,
        workspace_id,
        connected_account_id,
        connector_id,
        invocation,
        status
      ) values ($1, $2, $3, $4, $5, 'running')
      returning id`,
      [job.id, job.workspaceId, job.connectedAccountId, job.connectorId, invocation],
    );
    await client.query("commit");
    return result.rows[0]?.id;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function completeConnectorSyncRun(input: {
  jobId: string;
  runId: string;
  recordsSeen: number;
  recordsWritten: number;
  evidenceWritten: number;
  nextCursorState?: Record<string, unknown>;
  nextRunAt?: string | null;
  reschedule?: boolean;
}) {
  assertDatabaseReadyForSyncJobs();

  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    await client.query(
      `update connector_sync_runs
       set status = 'succeeded',
           finished_at = now(),
           records_seen = $1,
           records_written = $2,
           evidence_written = $3,
           next_cursor_state = $4
       where id = $5
         and status = 'running'`,
      [input.recordsSeen, input.recordsWritten, input.evidenceWritten, input.nextCursorState ?? {}, input.runId],
    );

    await client.query(
      `update connector_sync_jobs
       set status = case when $1 then 'queued'::sync_job_status else 'succeeded'::sync_job_status end,
           job_type = case when $1 then 'incremental_sync' else job_type end,
           cursor_state = $2,
           next_run_at = case when $1 then $3::timestamptz else null end,
           locked_at = null,
           locked_by = null,
           last_error = null,
           last_error_at = null,
           attempt_count = 0,
           last_succeeded_at = now(),
           updated_at = now()
       where id = $4
         and status = 'running'`,
      [Boolean(input.reschedule && input.nextRunAt), input.nextCursorState ?? {}, input.nextRunAt ?? null, input.jobId],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function failConnectorSyncRun(input: { jobId: string; runId?: string | null; error: string }) {
  assertDatabaseReadyForSyncJobs();

  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    if (input.runId) {
      await client.query(
        `update connector_sync_runs
         set status = 'failed', finished_at = now(), error_message = $1
         where id = $2
           and status = 'running'`,
        [input.error, input.runId],
      );
    }

    await client.query(
      `update connector_sync_jobs
       set status = case
             when attempt_count >= 8 then 'blocked'::sync_job_status
             else 'failed'::sync_job_status
           end,
           locked_at = null,
           locked_by = null,
           last_error = $1,
           last_error_at = now(),
           next_run_at = case
             when attempt_count >= 8 then null
             else now() + case least(attempt_count, 8)
               when 0 then interval '1 minute'
               when 1 then interval '1 minute'
               when 2 then interval '5 minutes'
               when 3 then interval '15 minutes'
               when 4 then interval '30 minutes'
               else interval '1 hour'
             end
           end,
           updated_at = now()
       where id = $2
         and status = 'running'`,
      [input.error, input.jobId],
    );
    await client.query(
      `update connected_accounts ca
       set last_error = $1, last_error_at = now(), updated_at = now()
       from connector_sync_jobs job
       where job.id = $2
         and ca.id = job.connected_account_id
         and ca.status <> 'revoked'`,
      [input.error, input.jobId],
    );
    await client.query(
      `update data_sources ds
       set freshness_status = 'error', status = 'error', updated_at = now()
       from connected_accounts ca, connector_sync_jobs job
       where job.id = $1
         and ca.id = job.connected_account_id
         and ca.status <> 'revoked'
         and ds.id = ca.source_id`,
      [input.jobId],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Persist a terminal, user-actionable authorization failure. Unlike ordinary
 * provider errors, this state is never put back on the retry schedule.
 */
export async function markConnectorReauthorizationRequired(input: {
  jobId: string;
  runId?: string | null;
  error: string;
}) {
  assertDatabaseReadyForSyncJobs();

  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    if (input.runId) {
      await client.query(
        `update connector_sync_runs
         set status = 'blocked',
             finished_at = now(),
             error_code = 'connector_reauthorization_required',
             error_message = $1
         where id = $2
           and status = 'running'`,
        [input.error, input.runId],
      );
    }

    await client.query(
      `update connector_sync_jobs target_job
       set status = 'blocked',
           locked_at = null,
           locked_by = null,
           last_error = $1,
           last_error_at = now(),
           next_run_at = null,
           updated_at = now()
       from connector_sync_jobs source_job
       where source_job.id = $2
         and (
           target_job.id = source_job.id
           or (
             source_job.connected_account_id is not null
             and target_job.connected_account_id = source_job.connected_account_id
           )
         )
         and target_job.status in ('queued', 'running', 'failed', 'paused')`,
      [input.error, input.jobId],
    );
    await client.query(
      `update connected_accounts account
       set status = 'needs_reauth',
           last_error = $1,
           last_error_at = now(),
           updated_at = now()
       from connector_sync_jobs job
       where job.id = $2
         and account.id = job.connected_account_id
         and account.status <> 'revoked'`,
      [input.error, input.jobId],
    );
    await client.query(
      `update data_sources source
       set freshness_status = 'error', status = 'needs_reauth', updated_at = now()
       from connected_accounts account, connector_sync_jobs job
       where job.id = $1
         and account.id = job.connected_account_id
         and account.status <> 'revoked'
         and source.id = account.source_id`,
      [input.jobId],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function persistConnectorEvidenceBatch(input: {
  workspaceId: string;
  connectedAccountId?: string | null;
  syncRunId: string;
  evidence: ConnectorEvidence[];
}) {
  refuseLegacyLedgerWrite();
  assertDatabaseReadyForSyncJobs();

  for (const item of input.evidence) {
    const payloadHash = item.sourcePayloadHash ?? hashEvidence(item);
    await getDatabasePool().query(
      `insert into connector_evidence (
        workspace_id,
        connected_account_id,
        sync_run_id,
        connector_id,
        provider,
        evidence_type,
        external_id,
        observed_at,
        merchant_raw,
        amount,
        currency,
        cadence_hint,
        next_debit_hint,
        confidence_score,
        payload_hash,
        payload
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      on conflict (workspace_id, connector_id, connected_account_id, external_id) where external_id is not null
      do update set
        connected_account_id = excluded.connected_account_id,
        sync_run_id = excluded.sync_run_id,
        provider = excluded.provider,
        evidence_type = excluded.evidence_type,
        observed_at = excluded.observed_at,
        merchant_raw = excluded.merchant_raw,
        amount = excluded.amount,
        currency = excluded.currency,
        cadence_hint = excluded.cadence_hint,
        next_debit_hint = excluded.next_debit_hint,
        confidence_score = excluded.confidence_score,
        payload_hash = excluded.payload_hash,
        payload = case
          when connector_evidence.payload_minimized_at is null then excluded.payload
          else connector_evidence.payload
        end`,
      [
        input.workspaceId,
        input.connectedAccountId ?? null,
        input.syncRunId,
        item.connectorId,
        item.provider,
        item.evidenceType,
        item.externalId,
        item.observedAt,
        item.merchantRaw ?? null,
        item.amount ?? null,
        item.currency ?? null,
        item.cadenceHint ?? null,
        item.nextDebitHint ?? null,
        item.confidence,
        payloadHash,
        item,
      ],
    );
  }

  return input.evidence.length;
}

function hashEvidence(item: ConnectorEvidence) {
  return createHash("sha256").update(JSON.stringify(item)).digest("base64url");
}

type ConnectorSyncJobRow = {
  id: string;
  workspace_id: string;
  connected_account_id: string | null;
  connector_id: string;
  job_type: SyncJobType;
  status: SyncJobStatus;
  cursor_state: Record<string, unknown>;
  attempt_count: number;
};

function mapSyncJob(row: ConnectorSyncJobRow): ConnectorSyncJobRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    connectedAccountId: row.connected_account_id,
    connectorId: row.connector_id,
    jobType: row.job_type,
    status: row.status,
    cursorState: row.cursor_state,
    attemptCount: row.attempt_count,
  };
}

async function recoverStaleConnectorSyncJobs() {
  await getDatabasePool().query(
    `with stale_jobs as (
       update connector_sync_jobs
       set status = case
             when attempt_count >= 8 then 'blocked'::sync_job_status
             else 'failed'::sync_job_status
           end,
           locked_at = null,
           locked_by = null,
           last_error = coalesce(last_error, 'Recovered after a stale runner lock.'),
           last_error_at = now(),
           next_run_at = case when attempt_count >= 8 then null else now() end,
           updated_at = now()
       where status = 'running'
         and locked_at < now() - interval '15 minutes'
       returning id
     )
     update connector_sync_runs run
     set status = 'failed',
         finished_at = now(),
         error_message = coalesce(run.error_message, 'Recovered after a stale runner lock.')
     from stale_jobs
     where run.sync_job_id = stale_jobs.id
       and run.status = 'running'`,
  );
}
