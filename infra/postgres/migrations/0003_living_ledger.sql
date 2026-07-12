alter table data_sources
  add column if not exists coverage_start_at timestamptz,
  add column if not exists coverage_end_at timestamptz,
  add column if not exists coverage_completeness text not null default 'partial'
    check (coverage_completeness in ('partial', 'complete')),
  add column if not exists freshness_status text not null default 'unknown'
    check (freshness_status in ('unknown', 'fresh', 'stale', 'error'));

alter table connector_sync_jobs
  add column if not exists attempt_count integer not null default 0 check (attempt_count >= 0),
  add column if not exists last_succeeded_at timestamptz;

alter table recurring_items
  add column if not exists external_reference text,
  add column if not exists currency char(3) not null default 'INR';

alter table usage_observations
  add column if not exists external_id text;

alter table evidence_links
  add column if not exists external_reference text;

create unique index if not exists transactions_connector_external_idx
  on transactions(workspace_id, source_id, external_reference)
  where external_reference like 'connector:%';

create unique index if not exists recurring_items_connector_external_idx
  on recurring_items(workspace_id, external_reference)
  where external_reference like 'connector:%';

create unique index if not exists evidence_links_connector_external_idx
  on evidence_links(recurring_item_id, external_reference)
  where external_reference like 'connector:%';

drop index if exists connector_evidence_external_idx;
create unique index connector_evidence_external_idx
  on connector_evidence(workspace_id, connector_id, connected_account_id, external_id)
  nulls not distinct
  where external_id is not null;

create unique index if not exists usage_observations_external_idx
  on usage_observations(workspace_id, connector_id, connected_account_id, external_id)
  nulls not distinct
  where external_id is not null;

create table if not exists product_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  event_name text not null check (event_name in (
    'connector.sync.started',
    'connector.sync.succeeded',
    'connector.sync.failed',
    'ledger.materialized'
  )),
  occurred_at timestamptz not null default now(),
  source text not null check (source in ('sync-runner', 'living-ledger', 'workspace-api')),
  status text check (status in ('started', 'succeeded', 'failed', 'partial')),
  duration_ms integer check (duration_ms between 0 and 86400000),
  metrics jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metrics) = 'object')
    check ((metrics - array[
      'recordsSeen',
      'evidenceWritten',
      'transactionsWritten',
      'commitmentsTouched',
      'usageObservationsWritten'
    ]::text[]) = '{}'::jsonb)
    check (
      coalesce(jsonb_typeof(metrics -> 'recordsSeen') = 'number', true)
      and coalesce(jsonb_typeof(metrics -> 'evidenceWritten') = 'number', true)
      and coalesce(jsonb_typeof(metrics -> 'transactionsWritten') = 'number', true)
      and coalesce(jsonb_typeof(metrics -> 'commitmentsTouched') = 'number', true)
      and coalesce(jsonb_typeof(metrics -> 'usageObservationsWritten') = 'number', true)
    )
);

create index if not exists product_events_workspace_occurred_idx
  on product_events(workspace_id, occurred_at desc);

create index if not exists product_events_name_occurred_idx
  on product_events(event_name, occurred_at desc);

create table if not exists consent_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  subject_email text,
  purpose text not null check (length(btrim(purpose)) between 1 and 160),
  notice_version text not null check (length(btrim(notice_version)) between 1 and 80),
  source text not null check (length(btrim(source)) between 1 and 80),
  scopes jsonb not null default '[]'::jsonb check (jsonb_typeof(scopes) in ('array', 'object')),
  granted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  expires_at timestamptz,
  check (withdrawn_at is null or withdrawn_at >= granted_at),
  check (expires_at is null or expires_at >= granted_at)
);

create index if not exists consent_grants_workspace_granted_idx
  on consent_grants(workspace_id, granted_at desc);

create index if not exists consent_grants_active_idx
  on consent_grants(purpose, granted_at desc)
  where withdrawn_at is null;
