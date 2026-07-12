alter table connector_webhook_events
  add column if not exists payload_minimized_at timestamptz,
  add column if not exists error_at timestamptz;

alter table transactions
  add column if not exists raw_row_minimized_at timestamptz;

alter table connector_evidence
  add column if not exists payload_minimized_at timestamptz;

alter table connected_accounts
  add column if not exists last_error_at timestamptz;

alter table connector_sync_jobs
  add column if not exists last_error_at timestamptz;

update connected_accounts
set last_error_at = updated_at
where last_error is not null and last_error_at is null;

update connector_sync_jobs
set last_error_at = updated_at
where last_error is not null and last_error_at is null;

update connector_webhook_events
set error_at = coalesce(processed_at, received_at)
where error_message is not null and error_at is null;

create index if not exists connector_evidence_retention_idx
  on connector_evidence(workspace_id, created_at)
  where payload_minimized_at is null and payload <> '{}'::jsonb;

create index if not exists connector_webhook_events_retention_idx
  on connector_webhook_events(workspace_id, received_at)
  where payload_minimized_at is null
    and status in ('verified', 'processed', 'failed', 'ignored');

create index if not exists connector_webhook_events_error_retention_idx
  on connector_webhook_events(workspace_id, (coalesce(error_at, processed_at, received_at)))
  where error_message is not null;

create index if not exists transactions_connector_retention_idx
  on transactions(workspace_id, created_at)
  where raw_row_minimized_at is null
    and raw_row <> '{}'::jsonb
    and external_reference like 'connector:%';

create index if not exists connector_sync_runs_error_retention_idx
  on connector_sync_runs(workspace_id, finished_at)
  where error_message is not null and finished_at is not null;

create index if not exists connector_sync_jobs_error_retention_idx
  on connector_sync_jobs(workspace_id, last_error_at)
  where last_error is not null;

create index if not exists connected_accounts_error_retention_idx
  on connected_accounts(workspace_id, last_error_at)
  where last_error is not null;

create table if not exists workspace_retention_policies (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  raw_connector_payload_days integer not null default 30 check (raw_connector_payload_days between 7 and 90),
  product_event_days integer not null default 90 check (product_event_days between 30 and 365),
  operational_error_days integer not null default 30 check (operational_error_days between 7 and 90),
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete set null,
  requester_user_id uuid references users(id) on delete set null,
  request_type text not null check (request_type in ('access_export')),
  status text not null default 'ready' check (status in ('ready', 'completed', 'failed', 'expired')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  download_expires_at timestamptz not null,
  last_downloaded_at timestamptz,
  download_count integer not null default 0 check (download_count >= 0),
  failure_code text check (failure_code is null or length(failure_code) between 1 and 80),
  updated_at timestamptz not null default now(),
  check (completed_at is null or completed_at >= requested_at),
  check (download_expires_at >= requested_at),
  check (last_downloaded_at is null or last_downloaded_at >= requested_at),
  check (
    (download_count = 0 and last_downloaded_at is null)
    or (download_count > 0 and last_downloaded_at is not null)
  ),
  check (
    (status = 'ready' and completed_at is null and download_count = 0 and failure_code is null)
    or (status = 'completed' and completed_at is not null and download_count > 0 and failure_code is null)
    or (status = 'failed' and completed_at is null and download_count = 0 and failure_code is not null)
    or (
      status = 'expired'
      and failure_code is null
      and (
        (completed_at is null and download_count = 0)
        or (completed_at is not null and download_count > 0)
      )
    )
  )
);

create index if not exists data_subject_requests_requester_idx
  on data_subject_requests(requester_user_id, requested_at desc);

create index if not exists data_subject_requests_workspace_idx
  on data_subject_requests(workspace_id, requested_at desc);

create unique index if not exists data_subject_requests_ready_idx
  on data_subject_requests(workspace_id, requester_user_id, request_type)
  where status = 'ready';

create table if not exists retention_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete set null,
  invocation text not null check (invocation in ('internal-api', 'cron')),
  dry_run boolean not null default true,
  status text not null check (status in ('completed', 'failed')),
  policy_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(policy_snapshot) = 'object')
    check ((policy_snapshot - array[
      'rawConnectorPayloadDays', 'productEventDays', 'operationalErrorDays'
    ]::text[]) = '{}'::jsonb)
    check (
      coalesce(jsonb_typeof(policy_snapshot -> 'rawConnectorPayloadDays') = 'number', true)
      and coalesce(jsonb_typeof(policy_snapshot -> 'productEventDays') = 'number', true)
      and coalesce(jsonb_typeof(policy_snapshot -> 'operationalErrorDays') = 'number', true)
    ),
  counts jsonb not null default '{}'::jsonb
    check (jsonb_typeof(counts) = 'object')
    check ((counts - array[
      'connectorEvidencePayloadsMinimized',
      'webhookPayloadsMinimized',
      'webhookErrorsMinimized',
      'connectorTransactionRowsMinimized',
      'productEventsDeleted',
      'syncRunErrorsMinimized',
      'syncJobErrorsMinimized',
      'connectedAccountErrorsMinimized',
      'dataSubjectRequestsDeleted',
      'retentionRunsDeleted'
    ]::text[]) = '{}'::jsonb)
    check (
      coalesce(jsonb_typeof(counts -> 'connectorEvidencePayloadsMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'webhookPayloadsMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'webhookErrorsMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'connectorTransactionRowsMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'productEventsDeleted') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'syncRunErrorsMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'syncJobErrorsMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'connectedAccountErrorsMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'dataSubjectRequestsDeleted') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'retentionRunsDeleted') = 'number', true)
    ),
  has_more boolean not null default false,
  error_code text check (error_code is null or length(error_code) between 1 and 80),
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now()
);

create index if not exists retention_runs_workspace_started_idx
  on retention_runs(workspace_id, started_at desc);
