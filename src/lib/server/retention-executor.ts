import "server-only";

import type { PoolClient } from "pg";
import {
  retentionPolicyDefaults,
  type RetentionExecutionOptions,
  type RetentionPolicyValues,
} from "@/lib/privacy-lifecycle";
import { getDatabasePool } from "@/lib/server/database";

export type RetentionInvocation = "internal-api" | "cron";

export type RetentionCounts = {
  connectorEvidencePayloadsMinimized: number;
  recoveryRawEvidenceMinimized: number;
  recoveryInboundEventsDeleted: number;
  webhookPayloadsMinimized: number;
  webhookErrorsMinimized: number;
  connectorTransactionRowsMinimized: number;
  productEventsDeleted: number;
  syncRunErrorsMinimized: number;
  syncJobErrorsMinimized: number;
  connectedAccountErrorsMinimized: number;
  dataSubjectRequestsDeleted: number;
  retentionRunsDeleted: number;
};

export type WorkspaceRetentionExecution = {
  workspaceId: string | null;
  status: "completed" | "failed" | "skipped";
  dryRun: boolean;
  policy: RetentionPolicyValues;
  counts: RetentionCounts;
  hasMore: boolean;
  errorCode: string | null;
};

const dataSubjectRequestDays = 730;
const retentionRunDays = 365;

type CountKey = keyof RetentionCounts;
type CutoffKey = "raw" | "product" | "operational" | "requests" | "runs";

type RetentionQuery = {
  key: CountKey;
  cutoff: CutoffKey;
  previewSql: string;
  executeSql: string;
};

const workspaceQueries: RetentionQuery[] = [
  {
    key: "connectorEvidencePayloadsMinimized",
    cutoff: "raw",
    previewSql: `select count(*)::text as count from (
      select id from connector_evidence
      where workspace_id = $1 and payload_minimized_at is null
        and payload <> '{}'::jsonb and created_at < $2
      order by created_at asc limit $3
    ) candidates`,
    executeSql: `with candidates as (
      select id from connector_evidence
      where workspace_id = $1 and payload_minimized_at is null
        and payload <> '{}'::jsonb and created_at < $2
      order by created_at asc limit $3 for update skip locked
    ), affected as (
      update connector_evidence item
      set payload = '{}'::jsonb, payload_minimized_at = now()
      from candidates where item.id = candidates.id returning 1
    ) select count(*)::text as count from affected`,
  },
  {
    key: "recoveryRawEvidenceMinimized",
    cutoff: "raw",
    previewSql: `select count(*)::text as count from (
      select id from recovery_sources
      where workspace_id = $1 and raw_minimized_at is null
        and raw_evidence <> '{}'::jsonb and ingested_at < $2
      order by ingested_at asc limit $3
    ) candidates`,
    executeSql: `with candidates as (
      select id from recovery_sources
      where workspace_id = $1 and raw_minimized_at is null
        and raw_evidence <> '{}'::jsonb and ingested_at < $2
      order by ingested_at asc limit $3 for update skip locked
    ), affected as (
      update recovery_sources item
      set raw_evidence = '{}'::jsonb, raw_minimized_at = now()
      from candidates where item.id = candidates.id returning 1
    ) select count(*)::text as count from affected`,
  },
  {
    key: "recoveryInboundEventsDeleted",
    cutoff: "operational",
    previewSql: `select count(*)::text as count from (
      select id from recovery_inbound_events
      where workspace_id = $1 and received_at < $2
        and status in ('PROCESSED', 'IGNORED', 'TERMINAL_FAILED')
      order by received_at asc limit $3
    ) candidates`,
    executeSql: `with candidates as (
      select id from recovery_inbound_events
      where workspace_id = $1 and received_at < $2
        and status in ('PROCESSED', 'IGNORED', 'TERMINAL_FAILED')
      order by received_at asc limit $3 for update skip locked
    ), affected as (
      delete from recovery_inbound_events item using candidates
      where item.id = candidates.id returning 1
    ) select count(*)::text as count from affected`,
  },
  {
    key: "webhookPayloadsMinimized",
    cutoff: "raw",
    previewSql: `select count(*)::text as count from (
      select id from connector_webhook_events
      where workspace_id = $1 and payload_minimized_at is null
        and received_at < $2
        and status in ('verified', 'processed', 'failed', 'ignored')
      order by received_at asc limit $3
    ) candidates`,
    executeSql: `with candidates as (
      select id from connector_webhook_events
      where workspace_id = $1 and payload_minimized_at is null
        and received_at < $2
        and status in ('verified', 'processed', 'failed', 'ignored')
      order by received_at asc limit $3 for update skip locked
    ), affected as (
      update connector_webhook_events item
      set payload = '{}'::jsonb,
          payload_minimized_at = now(),
          status = case
            when item.status = 'verified' then 'ignored'::webhook_event_status
            else item.status
          end,
          processed_at = case when item.status = 'verified' then now() else item.processed_at end
      from candidates where item.id = candidates.id returning 1
    ) select count(*)::text as count from affected`,
  },
  {
    key: "webhookErrorsMinimized",
    cutoff: "operational",
    previewSql: `select count(*)::text as count from (
      select id from connector_webhook_events
      where workspace_id = $1 and error_message is not null
        and coalesce(error_at, processed_at, received_at) < $2
      order by coalesce(error_at, processed_at, received_at) asc limit $3
    ) candidates`,
    executeSql: `with candidates as (
      select id from connector_webhook_events
      where workspace_id = $1 and error_message is not null
        and coalesce(error_at, processed_at, received_at) < $2
      order by coalesce(error_at, processed_at, received_at) asc limit $3 for update skip locked
    ), affected as (
      update connector_webhook_events item set error_message = null
      from candidates where item.id = candidates.id returning 1
    ) select count(*)::text as count from affected`,
  },
  {
    key: "connectorTransactionRowsMinimized",
    cutoff: "raw",
    previewSql: `select count(*)::text as count from (
      select id from transactions
      where workspace_id = $1 and raw_row_minimized_at is null
        and raw_row <> '{}'::jsonb and created_at < $2
        and external_reference like 'connector:%'
      order by created_at asc limit $3
    ) candidates`,
    executeSql: `with candidates as (
      select id from transactions
      where workspace_id = $1 and raw_row_minimized_at is null
        and raw_row <> '{}'::jsonb and created_at < $2
        and external_reference like 'connector:%'
      order by created_at asc limit $3 for update skip locked
    ), affected as (
      update transactions item
      set raw_row = '{}'::jsonb, raw_row_minimized_at = now()
      from candidates where item.id = candidates.id returning 1
    ) select count(*)::text as count from affected`,
  },
  {
    key: "productEventsDeleted",
    cutoff: "product",
    previewSql: `select count(*)::text as count from (
      select id from product_events
      where workspace_id = $1 and occurred_at < $2
        and not (event_name = 'workspace.activated' and activation_semantic_version is not distinct from 1)
      order by occurred_at asc limit $3
    ) candidates`,
    executeSql: `with candidates as (
      select id from product_events
      where workspace_id = $1 and occurred_at < $2
        and not (event_name = 'workspace.activated' and activation_semantic_version is not distinct from 1)
      order by occurred_at asc limit $3 for update skip locked
    ), affected as (
      delete from product_events item using candidates
      where item.id = candidates.id returning 1
    ) select count(*)::text as count from affected`,
  },
  {
    key: "syncRunErrorsMinimized",
    cutoff: "operational",
    previewSql: `select count(*)::text as count from (
      select id from connector_sync_runs
      where workspace_id = $1 and error_message is not null
        and finished_at is not null and finished_at < $2
      order by finished_at asc limit $3
    ) candidates`,
    executeSql: `with candidates as (
      select id from connector_sync_runs
      where workspace_id = $1 and error_message is not null
        and finished_at is not null and finished_at < $2
      order by finished_at asc limit $3 for update skip locked
    ), affected as (
      update connector_sync_runs item set error_message = null
      from candidates where item.id = candidates.id returning 1
    ) select count(*)::text as count from affected`,
  },
  {
    key: "syncJobErrorsMinimized",
    cutoff: "operational",
    previewSql: `select count(*)::text as count from (
      select id from connector_sync_jobs
      where workspace_id = $1 and last_error is not null
        and last_error_at < $2
      order by last_error_at asc limit $3
    ) candidates`,
    executeSql: `with candidates as (
      select id from connector_sync_jobs
      where workspace_id = $1 and last_error is not null
        and last_error_at < $2
      order by last_error_at asc limit $3 for update skip locked
    ), affected as (
      update connector_sync_jobs item set last_error = null
      from candidates where item.id = candidates.id returning 1
    ) select count(*)::text as count from affected`,
  },
  {
    key: "connectedAccountErrorsMinimized",
    cutoff: "operational",
    previewSql: `select count(*)::text as count from (
      select id from connected_accounts
      where workspace_id = $1 and last_error is not null
        and last_error_at < $2
      order by last_error_at asc limit $3
    ) candidates`,
    executeSql: `with candidates as (
      select id from connected_accounts
      where workspace_id = $1 and last_error is not null
        and last_error_at < $2
      order by last_error_at asc limit $3 for update skip locked
    ), affected as (
      update connected_accounts item set last_error = null
      from candidates where item.id = candidates.id returning 1
    ) select count(*)::text as count from affected`,
  },
  {
    key: "dataSubjectRequestsDeleted",
    cutoff: "requests",
    previewSql: `select count(*)::text as count from (
      select id from data_subject_requests
      where workspace_id = $1 and requested_at < $2
      order by requested_at asc limit $3
    ) candidates`,
    executeSql: `with candidates as (
      select id from data_subject_requests
      where workspace_id = $1 and requested_at < $2
      order by requested_at asc limit $3 for update skip locked
    ), affected as (
      delete from data_subject_requests item using candidates
      where item.id = candidates.id returning 1
    ) select count(*)::text as count from affected`,
  },
  {
    key: "retentionRunsDeleted",
    cutoff: "runs",
    previewSql: `select count(*)::text as count from (
      select id from retention_runs
      where workspace_id = $1 and started_at < $2
      order by started_at asc limit $3
    ) candidates`,
    executeSql: `with candidates as (
      select id from retention_runs
      where workspace_id = $1 and started_at < $2
      order by started_at asc limit $3 for update skip locked
    ), affected as (
      delete from retention_runs item using candidates
      where item.id = candidates.id returning 1
    ) select count(*)::text as count from affected`,
  },
];

export async function executeRetentionPolicies(
  options: RetentionExecutionOptions,
  invocation: RetentionInvocation,
) {
  const selected = await listPolicyWorkspaces(options);
  const results: WorkspaceRetentionExecution[] = [];

  for (const workspace of selected.workspaces) {
    results.push(await executeWorkspaceRetention({
      workspaceId: workspace.workspaceId,
      policy: workspace.policy,
      options,
      invocation,
    }));
  }

  const orphanedTelemetry = options.workspaceId
    ? null
    : await executeOrphanedRetention({ options, invocation });

  const executions = orphanedTelemetry ? [...results, orphanedTelemetry] : results;
  return {
    status: executions.some((result) => result.status === "failed")
      ? "completed-with-failures" as const
      : executions.some((result) => result.status === "skipped")
        ? "completed-with-skips" as const
        : "completed" as const,
    dryRun: options.dryRun,
    selectedWorkspaces: results.length,
    hasMoreWorkspaces: selected.hasMore,
    nextWorkspaceCursor: selected.nextCursor,
    fixedMetadataRetention: {
      dataSubjectRequestDays,
      retentionRunDays,
    },
    results,
    orphanedTelemetry,
  };
}

async function listPolicyWorkspaces(options: RetentionExecutionOptions) {
  const dryRunSql = `select w.id as workspace_id,
            coalesce(policy.raw_connector_payload_days, $3) as raw_connector_payload_days,
            coalesce(policy.product_event_days, $4) as product_event_days,
            coalesce(policy.operational_error_days, $5) as operational_error_days
     from workspaces w
     left join workspace_retention_policies policy on policy.workspace_id = w.id
     where ($1::uuid is null or w.id = $1::uuid)
       and ($6::uuid is null or w.id > $6::uuid)
     order by w.id
     limit $2`;
  const executionSql = `select w.id as workspace_id,
            coalesce(policy.raw_connector_payload_days, $3) as raw_connector_payload_days,
            coalesce(policy.product_event_days, $4) as product_event_days,
            coalesce(policy.operational_error_days, $5) as operational_error_days
     from workspaces w
     left join workspace_retention_policies policy on policy.workspace_id = w.id
     left join lateral (
       select max(started_at) as started_at
       from retention_runs prior_run
       where prior_run.workspace_id = w.id
     ) last_run on true
     where ($1::uuid is null or w.id = $1::uuid)
     order by last_run.started_at asc nulls first, w.id
     limit $2`;
  const result = await getDatabasePool().query<PolicyWorkspaceRow>(
    options.dryRun ? dryRunSql : executionSql,
    [
      options.workspaceId,
      options.workspaceLimit + 1,
      retentionPolicyDefaults.rawConnectorPayloadDays,
      retentionPolicyDefaults.productEventDays,
      retentionPolicyDefaults.operationalErrorDays,
      ...(options.dryRun ? [options.afterWorkspaceId] : []),
    ],
  );
  const workspaces = result.rows.slice(0, options.workspaceLimit).map((row) => ({
    workspaceId: row.workspace_id,
    policy: mapPolicy(row),
  }));
  const hasMore = result.rows.length > options.workspaceLimit;
  return {
    workspaces,
    hasMore,
    nextCursor: options.dryRun && hasMore ? workspaces.at(-1)?.workspaceId ?? null : null,
  };
}

async function executeWorkspaceRetention(input: {
  workspaceId: string;
  policy: RetentionPolicyValues;
  options: RetentionExecutionOptions;
  invocation: RetentionInvocation;
}): Promise<WorkspaceRetentionExecution> {
  const client = await getDatabasePool().connect();
  const startedAt = new Date();
  try {
    if (input.options.dryRun) {
      await client.query("begin isolation level repeatable read read only");
    } else {
      await client.query("begin");
      const lock = await client.query<{ acquired: boolean }>(
        `select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as acquired`,
        [`retention:${input.workspaceId}`],
      );
      if (!lock.rows[0]?.acquired) {
        await client.query("rollback");
        return skippedExecution(input.workspaceId, input.policy, input.options.dryRun, "workspace_busy");
      }
    }
    const { counts, hasMore } = await runWorkspaceQueries(client, input.workspaceId, input.policy, input.options);
    if (!input.options.dryRun) {
      await recordCompletedRun(client, {
        workspaceId: input.workspaceId,
        invocation: input.invocation,
        policy: input.policy,
        counts,
        hasMore,
        startedAt,
      });
    }
    await client.query("commit");
    return {
      workspaceId: input.workspaceId,
      status: "completed",
      dryRun: input.options.dryRun,
      policy: input.policy,
      counts,
      hasMore,
      errorCode: null,
    };
  } catch {
    await client.query("rollback").catch(() => undefined);
    const failed = {
      workspaceId: input.workspaceId,
      status: "failed" as const,
      dryRun: input.options.dryRun,
      policy: input.policy,
      counts: emptyCounts(),
      hasMore: false,
      errorCode: "workspace_execution_failed",
    };
    if (!input.options.dryRun) await recordFailedRun(failed, input.invocation, startedAt).catch(() => undefined);
    return failed;
  } finally {
    client.release();
  }
}

async function runWorkspaceQueries(
  client: PoolClient,
  workspaceId: string,
  policy: RetentionPolicyValues,
  options: RetentionExecutionOptions,
) {
  const now = new Date();
  const cutoffs: Record<CutoffKey, Date> = {
    raw: subtractDays(now, policy.rawConnectorPayloadDays),
    product: subtractDays(now, policy.productEventDays),
    operational: subtractDays(now, policy.operationalErrorDays),
    requests: subtractDays(now, dataSubjectRequestDays),
    runs: subtractDays(now, retentionRunDays),
  };
  const counts = emptyCounts();
  let hasMore = false;

  for (const query of workspaceQueries) {
    const candidateLimit = options.batchSize + (options.dryRun ? 1 : 0);
    const result = await client.query<{ count: string }>(
      options.dryRun ? query.previewSql : query.executeSql,
      [workspaceId, cutoffs[query.cutoff], candidateLimit],
    );
    const observed = Number(result.rows[0]?.count ?? 0);
    counts[query.key] = Math.min(observed, options.batchSize);
    if (observed > options.batchSize || (!options.dryRun && observed === options.batchSize)) hasMore = true;
  }
  return { counts, hasMore };
}

async function executeOrphanedRetention(input: {
  options: RetentionExecutionOptions;
  invocation: RetentionInvocation;
}): Promise<WorkspaceRetentionExecution> {
  const client = await getDatabasePool().connect();
  const policy = { ...retentionPolicyDefaults };
  const startedAt = new Date();
  try {
    if (input.options.dryRun) {
      await client.query("begin isolation level repeatable read read only");
    } else {
      await client.query("begin");
      const lock = await client.query<{ acquired: boolean }>(
        `select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as acquired`,
        ["retention:orphaned"],
      );
      if (!lock.rows[0]?.acquired) {
        await client.query("rollback");
        return skippedExecution(null, policy, input.options.dryRun, "orphaned_busy");
      }
    }
    const now = new Date();
    const counts = emptyCounts();
    let hasMore = false;
    const queries = [
      {
        key: "webhookPayloadsMinimized" as const,
        cutoff: subtractDays(now, policy.rawConnectorPayloadDays),
        preview: `select count(*)::text as count from (
          select id from connector_webhook_events
          where workspace_id is null and payload_minimized_at is null
            and received_at < $1
            and status in ('verified', 'processed', 'failed', 'ignored')
          order by received_at asc limit $2
        ) candidates`,
        execute: `with candidates as (
          select id from connector_webhook_events
          where workspace_id is null and payload_minimized_at is null
            and received_at < $1
            and status in ('verified', 'processed', 'failed', 'ignored')
          order by received_at asc limit $2 for update skip locked
        ), affected as (
          update connector_webhook_events item
          set payload = '{}'::jsonb,
              payload_minimized_at = now(),
              status = case
                when item.status = 'verified' then 'ignored'::webhook_event_status
                else item.status
              end,
              processed_at = case when item.status = 'verified' then now() else item.processed_at end
          from candidates where item.id = candidates.id returning 1
        ) select count(*)::text as count from affected`,
      },
      {
        key: "webhookErrorsMinimized" as const,
        cutoff: subtractDays(now, policy.operationalErrorDays),
        preview: `select count(*)::text as count from (
          select id from connector_webhook_events
          where workspace_id is null and error_message is not null
            and coalesce(error_at, processed_at, received_at) < $1
          order by coalesce(error_at, processed_at, received_at) asc limit $2
        ) candidates`,
        execute: `with candidates as (
          select id from connector_webhook_events
          where workspace_id is null and error_message is not null
            and coalesce(error_at, processed_at, received_at) < $1
          order by coalesce(error_at, processed_at, received_at) asc limit $2 for update skip locked
        ), affected as (
          update connector_webhook_events item set error_message = null
          from candidates where item.id = candidates.id returning 1
        ) select count(*)::text as count from affected`,
      },
      {
        key: "productEventsDeleted" as const,
        cutoff: subtractDays(now, policy.productEventDays),
        preview: `select count(*)::text as count from (
          select id from product_events where workspace_id is null and occurred_at < $1
          order by occurred_at asc limit $2
        ) candidates`,
        execute: `with candidates as (
          select id from product_events where workspace_id is null and occurred_at < $1
          order by occurred_at asc limit $2 for update skip locked
        ), affected as (
          delete from product_events item using candidates where item.id = candidates.id returning 1
        ) select count(*)::text as count from affected`,
      },
      {
        key: "dataSubjectRequestsDeleted" as const,
        cutoff: subtractDays(now, dataSubjectRequestDays),
        preview: `select count(*)::text as count from (
          select id from data_subject_requests where workspace_id is null and requested_at < $1
          order by requested_at asc limit $2
        ) candidates`,
        execute: `with candidates as (
          select id from data_subject_requests where workspace_id is null and requested_at < $1
          order by requested_at asc limit $2 for update skip locked
        ), affected as (
          delete from data_subject_requests item using candidates where item.id = candidates.id returning 1
        ) select count(*)::text as count from affected`,
      },
      {
        key: "retentionRunsDeleted" as const,
        cutoff: subtractDays(now, retentionRunDays),
        preview: `select count(*)::text as count from (
          select id from retention_runs where workspace_id is null and started_at < $1
          order by started_at asc limit $2
        ) candidates`,
        execute: `with candidates as (
          select id from retention_runs where workspace_id is null and started_at < $1
          order by started_at asc limit $2 for update skip locked
        ), affected as (
          delete from retention_runs item using candidates where item.id = candidates.id returning 1
        ) select count(*)::text as count from affected`,
      },
    ];

    for (const query of queries) {
      const candidateLimit = input.options.batchSize + (input.options.dryRun ? 1 : 0);
      const result = await client.query<{ count: string }>(
        input.options.dryRun ? query.preview : query.execute,
        [query.cutoff, candidateLimit],
      );
      const observed = Number(result.rows[0]?.count ?? 0);
      counts[query.key] = Math.min(observed, input.options.batchSize);
      if (observed > input.options.batchSize || (!input.options.dryRun && observed === input.options.batchSize)) hasMore = true;
    }
    if (!input.options.dryRun) {
      await recordCompletedRun(client, {
        workspaceId: null,
        invocation: input.invocation,
        policy,
        counts,
        hasMore,
        startedAt,
      });
    }
    await client.query("commit");
    return { workspaceId: null, status: "completed", dryRun: input.options.dryRun, policy, counts, hasMore, errorCode: null };
  } catch {
    await client.query("rollback").catch(() => undefined);
    const failed = {
      workspaceId: null,
      status: "failed" as const,
      dryRun: input.options.dryRun,
      policy,
      counts: emptyCounts(),
      hasMore: false,
      errorCode: "orphaned_execution_failed",
    };
    if (!input.options.dryRun) await recordFailedRun(failed, input.invocation, startedAt).catch(() => undefined);
    return failed;
  } finally {
    client.release();
  }
}

async function recordCompletedRun(client: PoolClient, input: {
  workspaceId: string | null;
  invocation: RetentionInvocation;
  policy: RetentionPolicyValues;
  counts: RetentionCounts;
  hasMore: boolean;
  startedAt: Date;
}) {
  const run = await client.query<{ id: string }>(
    `insert into retention_runs (
       workspace_id, invocation, dry_run, status, policy_snapshot, counts,
       has_more, started_at, finished_at
     ) values ($1, $2, false, 'completed', $3, $4, $5, $6, now())
     returning id`,
    [input.workspaceId, input.invocation, input.policy, input.counts, input.hasMore, input.startedAt],
  );
  if (input.workspaceId) {
    await client.query(
      `insert into audit_log (workspace_id, action, entity_type, entity_id, metadata)
       values ($1, 'privacy.retention.executed', 'retention_run', $2, $3)`,
      [input.workspaceId, run.rows[0]?.id ?? null, {
        policy: input.policy,
        counts: input.counts,
        hasMore: input.hasMore,
      }],
    );
  }
}

async function recordFailedRun(
  result: WorkspaceRetentionExecution,
  invocation: RetentionInvocation,
  startedAt: Date,
) {
  await getDatabasePool().query(
    `insert into retention_runs (
       workspace_id, invocation, dry_run, status, policy_snapshot, counts,
       has_more, error_code, started_at, finished_at
     ) values ($1, $2, false, 'failed', $3, $4, false, $5, $6, now())`,
    [result.workspaceId, invocation, result.policy, result.counts, result.errorCode, startedAt],
  );
}

function emptyCounts(): RetentionCounts {
  return {
    connectorEvidencePayloadsMinimized: 0,
    recoveryRawEvidenceMinimized: 0,
    recoveryInboundEventsDeleted: 0,
    webhookPayloadsMinimized: 0,
    webhookErrorsMinimized: 0,
    connectorTransactionRowsMinimized: 0,
    productEventsDeleted: 0,
    syncRunErrorsMinimized: 0,
    syncJobErrorsMinimized: 0,
    connectedAccountErrorsMinimized: 0,
    dataSubjectRequestsDeleted: 0,
    retentionRunsDeleted: 0,
  };
}

function skippedExecution(
  workspaceId: string | null,
  policy: RetentionPolicyValues,
  dryRun: boolean,
  errorCode: "workspace_busy" | "orphaned_busy",
): WorkspaceRetentionExecution {
  return {
    workspaceId,
    status: "skipped",
    dryRun,
    policy,
    counts: emptyCounts(),
    hasMore: true,
    errorCode,
  };
}

function subtractDays(date: Date, days: number) {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1_000);
}

function mapPolicy(row: PolicyWorkspaceRow): RetentionPolicyValues {
  return {
    rawConnectorPayloadDays: row.raw_connector_payload_days,
    productEventDays: row.product_event_days,
    operationalErrorDays: row.operational_error_days,
  };
}

type PolicyWorkspaceRow = {
  workspace_id: string;
  raw_connector_payload_days: number;
  product_event_days: number;
  operational_error_days: number;
};
