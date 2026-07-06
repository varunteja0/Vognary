create extension if not exists pgcrypto;

create type source_kind as enum (
  'csv_upload',
  'manual_entry',
  'gmail_receipt',
  'pdf_statement',
  'account_aggregator',
  'cloud_connector',
  'app_store',
  'upi_mandate',
  'card_mandate'
);

create type recurring_status as enum (
  'keep',
  'watch',
  'downgrade',
  'cancel',
  'investigate',
  'unknown'
);

create type connector_auth_type as enum (
  'oauth',
  'api-key',
  'iam-role',
  'partner-api',
  'manual',
  'file-fallback'
);

create type token_status as enum (
  'active',
  'expired',
  'revoked',
  'rotation_required'
);

create type sync_job_status as enum (
  'queued',
  'running',
  'succeeded',
  'failed',
  'paused',
  'blocked'
);

create type webhook_event_status as enum (
  'received',
  'verified',
  'processed',
  'failed',
  'ignored'
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table auth_magic_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text unique not null,
  email text not null,
  display_name text,
  workspace_name text,
  redirect_path text not null default '/',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index auth_magic_links_expires_idx on auth_magic_links(expires_at);

create table private_audit_leads (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  name text not null,
  email text not null,
  contact text,
  persona text not null,
  spend_guess text,
  payment_types text[] not null default '{}',
  source_types text[] not null default '{}',
  biggest_concern text,
  message text,
  score integer not null default 0,
  created_at timestamptz not null default now()
);

create index private_audit_leads_created_idx on private_audit_leads(created_at desc);
create index private_audit_leads_email_idx on private_audit_leads(email);

create table waitlist_leads (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  email text not null,
  name text,
  segment text,
  message text,
  created_at timestamptz not null default now()
);

create index waitlist_leads_created_idx on waitlist_leads(created_at desc);
create index waitlist_leads_email_idx on waitlist_leads(email);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references users(id),
  name text not null,
  plan text not null default 'private_beta',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table data_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind source_kind not null,
  provider text,
  display_name text not null,
  consent_scope text,
  status text not null default 'active',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table connected_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_id uuid references data_sources(id) on delete set null,
  connector_id text not null,
  auth_type connector_auth_type not null,
  provider_account_id text,
  display_name text not null,
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'needs_reauth', 'blocked', 'revoked', 'manual')),
  consent_expires_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (workspace_id, connector_id, provider_account_id)
);

create index connected_accounts_workspace_connector_idx on connected_accounts(workspace_id, connector_id);
create index connected_accounts_status_idx on connected_accounts(status);

create table connector_token_refs (
  id uuid primary key default gen_random_uuid(),
  connected_account_id uuid not null references connected_accounts(id) on delete cascade,
  token_kind text not null check (token_kind in ('access', 'refresh', 'api_key', 'iam_role', 'partner_secret')),
  secret_ref text not null,
  encrypted_payload jsonb not null default '{}'::jsonb,
  key_fingerprint text,
  scopes text[] not null default '{}',
  expires_at timestamptz,
  status token_status not null default 'active',
  last_rotated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connected_account_id, token_kind)
);

create index connector_token_refs_account_status_idx on connector_token_refs(connected_account_id, status);

create table connector_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connected_account_id uuid references connected_accounts(id) on delete cascade,
  connector_id text not null,
  job_type text not null check (job_type in ('initial_sync', 'incremental_sync', 'backfill', 'webhook_replay', 'manual_refresh')),
  status sync_job_status not null default 'queued',
  schedule_cron text,
  priority integer not null default 100,
  cursor_state jsonb not null default '{}'::jsonb,
  next_run_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index connector_sync_jobs_due_idx on connector_sync_jobs(status, next_run_at, priority);
create index connector_sync_jobs_workspace_idx on connector_sync_jobs(workspace_id, connector_id);

create table connector_sync_runs (
  id uuid primary key default gen_random_uuid(),
  sync_job_id uuid references connector_sync_jobs(id) on delete set null,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connected_account_id uuid references connected_accounts(id) on delete set null,
  connector_id text not null,
  status sync_job_status not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  records_seen integer not null default 0,
  records_written integer not null default 0,
  evidence_written integer not null default 0,
  next_cursor_state jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text
);

create index connector_sync_runs_workspace_started_idx on connector_sync_runs(workspace_id, started_at desc);
create index connector_sync_runs_connector_status_idx on connector_sync_runs(connector_id, status);

create table connector_webhook_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  connected_account_id uuid references connected_accounts(id) on delete set null,
  connector_id text not null,
  provider_event_id text,
  event_type text not null,
  signature_valid boolean not null default false,
  status webhook_event_status not null default 'received',
  payload_hash text not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_message text
);

create index connector_webhook_events_status_idx on connector_webhook_events(status, received_at);
create unique index connector_webhook_events_provider_event_idx on connector_webhook_events(connector_id, provider_event_id) where provider_event_id is not null;

create table uploaded_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_id uuid references data_sources(id) on delete set null,
  file_name text not null,
  mime_type text not null,
  byte_size bigint not null,
  storage_key text not null,
  sha256 text not null,
  encrypted boolean not null default true,
  parsed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_id uuid references data_sources(id) on delete set null,
  uploaded_file_id uuid references uploaded_files(id) on delete set null,
  transaction_date date not null,
  description text not null,
  normalized_merchant text not null,
  category text not null default 'Other',
  amount numeric(14, 2) not null,
  currency char(3) not null default 'INR',
  direction text not null check (direction in ('debit', 'credit', 'unknown')),
  external_reference text,
  raw_row jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index transactions_workspace_date_idx on transactions(workspace_id, transaction_date desc);
create index transactions_workspace_merchant_idx on transactions(workspace_id, normalized_merchant);

create table recurring_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  merchant text not null,
  normalized_merchant text not null,
  category text not null default 'Other',
  frequency text not null,
  amount_min numeric(14, 2) not null,
  amount_max numeric(14, 2) not null,
  average_amount numeric(14, 2) not null,
  monthly_cost numeric(14, 2) not null,
  annual_cost numeric(14, 2) not null,
  last_charge_date date,
  next_expected_date date,
  confidence_score integer not null check (confidence_score between 0 and 100),
  status recurring_status not null default 'unknown',
  recommendation_reason text,
  risk_tags text[] not null default '{}',
  first_detected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recurring_items_workspace_next_idx on recurring_items(workspace_id, next_expected_date);
create index recurring_items_workspace_status_idx on recurring_items(workspace_id, status);

create table evidence_links (
  id uuid primary key default gen_random_uuid(),
  recurring_item_id uuid not null references recurring_items(id) on delete cascade,
  transaction_id uuid references transactions(id) on delete set null,
  source_id uuid references data_sources(id) on delete set null,
  evidence_type text not null default 'transaction',
  evidence_text text not null,
  evidence_date date,
  amount numeric(14, 2),
  created_at timestamptz not null default now()
);

create table connector_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connected_account_id uuid references connected_accounts(id) on delete set null,
  sync_run_id uuid references connector_sync_runs(id) on delete set null,
  source_id uuid references data_sources(id) on delete set null,
  recurring_item_id uuid references recurring_items(id) on delete set null,
  connector_id text not null,
  provider text not null,
  evidence_type text not null,
  external_id text,
  observed_at timestamptz not null,
  merchant_raw text,
  amount numeric(14, 2),
  currency char(3),
  cadence_hint text,
  next_debit_hint date,
  confidence_score integer not null check (confidence_score between 0 and 100),
  payload_hash text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index connector_evidence_workspace_observed_idx on connector_evidence(workspace_id, observed_at desc);
create index connector_evidence_recurring_item_idx on connector_evidence(recurring_item_id);
create unique index connector_evidence_external_idx on connector_evidence(workspace_id, connector_id, external_id) where external_id is not null;

create table usage_observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connected_account_id uuid references connected_accounts(id) on delete set null,
  recurring_item_id uuid references recurring_items(id) on delete set null,
  connector_id text not null,
  provider text not null,
  metric_name text not null,
  metric_value numeric(18, 6) not null,
  metric_unit text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  payload_hash text,
  created_at timestamptz not null default now()
);

create index usage_observations_workspace_window_idx on usage_observations(workspace_id, window_end desc);
create index usage_observations_recurring_item_idx on usage_observations(recurring_item_id);

create table recommendations (
  id uuid primary key default gen_random_uuid(),
  recurring_item_id uuid not null references recurring_items(id) on delete cascade,
  recommendation_type recurring_status not null,
  reason text not null,
  estimated_monthly_savings numeric(14, 2) not null default 0,
  confidence_score integer not null check (confidence_score between 0 and 100),
  accepted_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  recurring_item_id uuid references recurring_items(id) on delete cascade,
  alert_type text not null,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  status text not null default 'scheduled',
  created_at timestamptz not null default now()
);

create table audit_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title text not null,
  summary jsonb not null,
  report_json jsonb not null,
  exported_at timestamptz,
  created_at timestamptz not null default now()
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_workspace_created_idx on audit_log(workspace_id, created_at desc);