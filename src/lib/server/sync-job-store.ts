import { createHash } from "node:crypto";
import type { ConnectorEvidence } from "@/lib/connector-runtime";
import { getDatabasePool, isDatabaseConfigured } from "@/lib/server/database";

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

export async function createConnectorSyncJob(input: CreateConnectorSyncJobInput) {
  assertDatabaseReadyForSyncJobs();

  const result = await getDatabasePool().query<ConnectorSyncJobRow>(
    `insert into connector_sync_jobs (
      workspace_id,
      connected_account_id,
      connector_id,
      job_type,
      status,
      priority,
      cursor_state,
      next_run_at
    ) values ($1, $2, $3, $4, 'queued', $5, $6, now())
    returning id, workspace_id, connected_account_id, connector_id, job_type, status, cursor_state`,
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
    `select id, workspace_id, connected_account_id, connector_id, job_type, status, cursor_state
     from connector_sync_jobs
     where id = $1`,
    [jobId],
  );

  const row = result.rows[0];
  return row ? mapSyncJob(row) : null;
}

export async function beginConnectorSyncRun(job: ConnectorSyncJobRecord) {
  assertDatabaseReadyForSyncJobs();

  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const lock = await client.query(
      `update connector_sync_jobs
       set status = 'running', locked_at = now(), locked_by = 'vognary-internal-runner', updated_at = now()
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
        status
      ) values ($1, $2, $3, $4, 'running')
      returning id`,
      [job.id, job.workspaceId, job.connectedAccountId, job.connectorId],
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
}) {
  assertDatabaseReadyForSyncJobs();

  await getDatabasePool().query(
    `update connector_sync_runs
     set status = 'succeeded',
         finished_at = now(),
         records_seen = $1,
         records_written = $2,
         evidence_written = $3,
         next_cursor_state = $4
     where id = $5`,
    [input.recordsSeen, input.recordsWritten, input.evidenceWritten, input.nextCursorState ?? {}, input.runId],
  );

  await getDatabasePool().query(
    `update connector_sync_jobs
     set status = 'succeeded', locked_at = null, locked_by = null, last_error = null, updated_at = now()
     where id = $1`,
    [input.jobId],
  );
}

export async function failConnectorSyncRun(input: { jobId: string; runId?: string | null; error: string }) {
  assertDatabaseReadyForSyncJobs();

  if (input.runId) {
    await getDatabasePool().query(
      `update connector_sync_runs
       set status = 'failed', finished_at = now(), error_message = $1
       where id = $2`,
      [input.error, input.runId],
    );
  }

  await getDatabasePool().query(
    `update connector_sync_jobs
     set status = 'failed', locked_at = null, locked_by = null, last_error = $1, updated_at = now()
     where id = $2`,
    [input.error, input.jobId],
  );
}

export async function persistConnectorEvidenceBatch(input: {
  workspaceId: string;
  connectedAccountId?: string | null;
  syncRunId: string;
  evidence: ConnectorEvidence[];
}) {
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
      on conflict (workspace_id, connector_id, external_id) where external_id is not null
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
        payload = excluded.payload`,
      [
        input.workspaceId,
        input.connectedAccountId ?? null,
        input.syncRunId,
        item.connectorId,
        item.provider,
        item.evidenceType,
        payloadHash,
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
  };
}