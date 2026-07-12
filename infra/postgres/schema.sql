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

-- Only an opaque token hash is persisted. Protected requests validate this row
-- as well as the user's current workspace membership, which makes logout and
-- membership removal effective immediately rather than waiting for cookie TTL.
create table auth_sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  workspace_id uuid references workspaces(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index auth_sessions_user_active_idx on auth_sessions(user_id, expires_at) where revoked_at is null;

create table platform_api_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  token_prefix text not null,
  token_hash text not null unique,
  scopes text[] not null,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (scopes <@ array['ledger:read', 'sources:read']::text[]),
  check (cardinality(scopes) > 0)
);

create index platform_api_tokens_workspace_created_idx on platform_api_tokens(workspace_id, created_at desc);
create index platform_api_tokens_active_hash_idx on platform_api_tokens(token_hash) where revoked_at is null;

create table billing_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  customer_email text not null check (length(btrim(customer_email)) between 3 and 320),
  plan text not null check (plan in ('personal', 'founder', 'team', 'annual')),
  provider text not null check (provider in ('razorpay', 'payment-link')),
  status text not null default 'created' check (status in ('created', 'pending', 'paid', 'failed', 'cancelled', 'expired', 'refunded')),
  currency char(3) not null default 'INR',
  amount_minor bigint not null check (amount_minor > 0),
  refunded_amount_minor bigint not null default 0 check (refunded_amount_minor >= 0 and refunded_amount_minor <= amount_minor),
  idempotency_key text not null unique check (length(idempotency_key) between 16 and 128),
  provider_checkout_id text,
  provider_payment_id text,
  provider_checkout_url text,
  paid_at timestamptz,
  refunded_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'paid') = (paid_at is not null) or status = 'refunded'),
  check (status <> 'refunded' or refunded_at is not null)
);

create unique index billing_checkout_provider_id_idx on billing_checkout_sessions(provider, provider_checkout_id) where provider_checkout_id is not null;
create index billing_checkout_workspace_created_idx on billing_checkout_sessions(workspace_id, created_at desc);
create index billing_checkout_payment_idx on billing_checkout_sessions(provider, provider_payment_id) where provider_payment_id is not null;

create table billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('razorpay')),
  external_event_id text not null,
  event_type text not null,
  payload_hash char(64) not null,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, external_event_id)
);

create index billing_webhook_received_idx on billing_webhook_events(received_at desc);

create table workspace_entitlements (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entitlement_key text not null check (entitlement_key in ('monitoring', 'annual-audit')),
  source_checkout_session_id uuid references billing_checkout_sessions(id) on delete set null,
  status text not null check (status in ('active', 'revoked', 'expired')),
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entitlement_key),
  check (expires_at > starts_at),
  check ((status = 'revoked') = (revoked_at is not null))
);

create index workspace_entitlements_active_idx on workspace_entitlements(expires_at) where status = 'active';

create table data_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  external_reference text,
  kind source_kind not null,
  provider text,
  display_name text not null,
  consent_scope text,
  status text not null default 'active',
  last_synced_at timestamptz,
  coverage_start_at timestamptz,
  coverage_end_at timestamptz,
  coverage_completeness text not null default 'partial' check (coverage_completeness in ('partial', 'complete')),
  freshness_status text not null default 'unknown' check (freshness_status in ('unknown', 'fresh', 'stale', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index data_sources_workspace_state_external_idx
  on data_sources(workspace_id, external_reference)
  where external_reference like 'workspace-state:%';

create table connected_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_id uuid references data_sources(id) on delete set null,
  consent_grant_id uuid,
  connector_id text not null,
  auth_type connector_auth_type not null,
  provider_account_id text,
  display_name text not null,
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'needs_reauth', 'blocked', 'revoked', 'manual')),
  consent_expires_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (workspace_id, connector_id, provider_account_id)
);

create index connected_accounts_workspace_connector_idx on connected_accounts(workspace_id, connector_id);
create index connected_accounts_status_idx on connected_accounts(status);
create index connected_accounts_error_retention_idx on connected_accounts(workspace_id, last_error_at) where last_error is not null;

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
  last_error_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_succeeded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index connector_sync_jobs_due_idx on connector_sync_jobs(status, next_run_at, priority);
create index connector_sync_jobs_workspace_idx on connector_sync_jobs(workspace_id, connector_id);
create index connector_sync_jobs_error_retention_idx on connector_sync_jobs(workspace_id, last_error_at) where last_error is not null;

create table connector_sync_runs (
  id uuid primary key default gen_random_uuid(),
  sync_job_id uuid references connector_sync_jobs(id) on delete set null,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connected_account_id uuid references connected_accounts(id) on delete set null,
  connector_id text not null,
  invocation text not null default 'internal-api' check (invocation in ('cron', 'internal-api', 'manual', 'initial-setup')),
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
create index connector_sync_runs_cron_evidence_idx on connector_sync_runs(finished_at desc) where invocation = 'cron' and status = 'succeeded' and evidence_written > 0;
create index connector_sync_runs_error_retention_idx on connector_sync_runs(workspace_id, finished_at) where error_message is not null and finished_at is not null;

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
  payload_minimized_at timestamptz,
  error_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_message text
);

create index connector_webhook_events_status_idx on connector_webhook_events(status, received_at);
create unique index connector_webhook_events_provider_event_idx on connector_webhook_events(connector_id, provider_event_id) where provider_event_id is not null;
create index connector_webhook_events_retention_idx on connector_webhook_events(workspace_id, received_at) where payload_minimized_at is null and status in ('verified', 'processed', 'failed', 'ignored');
create index connector_webhook_events_error_retention_idx on connector_webhook_events(workspace_id, (coalesce(error_at, processed_at, received_at))) where error_message is not null;

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
  raw_row_minimized_at timestamptz,
  created_at timestamptz not null default now()
);

create index transactions_workspace_date_idx on transactions(workspace_id, transaction_date desc);
create index transactions_workspace_merchant_idx on transactions(workspace_id, normalized_merchant);
create unique index transactions_connector_external_idx on transactions(workspace_id, source_id, external_reference) where external_reference like 'connector:%';
create unique index transactions_workspace_state_external_idx on transactions(workspace_id, source_id, external_reference) where external_reference like 'workspace-state:%';
create index transactions_connector_retention_idx on transactions(workspace_id, created_at) where raw_row_minimized_at is null and raw_row <> '{}'::jsonb and external_reference like 'connector:%';

create table recurring_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  external_reference text,
  merchant text not null,
  normalized_merchant text not null,
  category text not null default 'Other',
  frequency text not null,
  currency char(3) not null default 'INR',
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
create unique index recurring_items_connector_external_idx on recurring_items(workspace_id, external_reference) where external_reference like 'connector:%';
create unique index recurring_items_workspace_state_external_idx on recurring_items(workspace_id, external_reference) where external_reference like 'workspace-state:%';

create table evidence_links (
  id uuid primary key default gen_random_uuid(),
  recurring_item_id uuid not null references recurring_items(id) on delete cascade,
  transaction_id uuid references transactions(id) on delete set null,
  source_id uuid references data_sources(id) on delete set null,
  external_reference text,
  evidence_type text not null default 'transaction',
  evidence_text text not null,
  evidence_date date,
  amount numeric(14, 2),
  created_at timestamptz not null default now()
);

create unique index evidence_links_connector_external_idx on evidence_links(recurring_item_id, external_reference) where external_reference like 'connector:%';
create unique index evidence_links_workspace_state_external_idx on evidence_links(recurring_item_id, external_reference) where external_reference like 'workspace-state:%';

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
  payload_minimized_at timestamptz,
  created_at timestamptz not null default now()
);

create index connector_evidence_workspace_observed_idx on connector_evidence(workspace_id, observed_at desc);
create index connector_evidence_recurring_item_idx on connector_evidence(recurring_item_id);
create unique index connector_evidence_external_idx on connector_evidence(workspace_id, connector_id, connected_account_id, external_id) nulls not distinct where external_id is not null;
create index connector_evidence_retention_idx on connector_evidence(workspace_id, created_at) where payload_minimized_at is null and payload <> '{}'::jsonb;

create table usage_observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connected_account_id uuid references connected_accounts(id) on delete set null,
  recurring_item_id uuid references recurring_items(id) on delete set null,
  connector_id text not null,
  provider text not null,
  external_id text,
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
create unique index usage_observations_external_idx on usage_observations(workspace_id, connector_id, connected_account_id, external_id) nulls not distinct where external_id is not null;

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

create table commitment_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  recurring_item_id uuid not null references recurring_items(id) on delete cascade,
  decided_by_user_id uuid references users(id) on delete set null,
  action text not null check (action in ('keep', 'watch', 'downgrade', 'cancel', 'investigate')),
  decided_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, recurring_item_id)
);

create index commitment_decisions_workspace_updated_idx on commitment_decisions(workspace_id, updated_at desc);

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

create table workspace_states (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  encrypted_snapshot jsonb not null,
  summary jsonb not null default '{}'::jsonb,
  revision bigint not null default 1 check (revision > 0),
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspace_states_updated_idx on workspace_states(updated_at desc);

-- Privacy-safe product telemetry: identifiers plus operational dimensions and
-- bounded numeric metrics only. Financial payloads, merchant names, email
-- addresses, connector tokens, and arbitrary metadata have no column here.
create table product_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  event_name text not null check (event_name in (
    'connector.sync.started',
    'connector.sync.succeeded',
    'connector.sync.failed',
    'ledger.materialized',
    'workspace.activated',
    'ledger.viewed',
    'review.action_recorded',
    'review.completed',
    'export.created'
  )),
  occurred_at timestamptz not null default now(),
  source text not null check (source in ('sync-runner', 'living-ledger', 'workspace-api', 'product-ui')),
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

create index product_events_workspace_occurred_idx on product_events(workspace_id, occurred_at desc);
create index product_events_name_occurred_idx on product_events(event_name, occurred_at desc);

create table consent_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  subject_email text,
  resource_key text check (resource_key is null or length(btrim(resource_key)) between 1 and 240),
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

create index consent_grants_workspace_granted_idx on consent_grants(workspace_id, granted_at desc);
create index consent_grants_active_idx on consent_grants(purpose, granted_at desc) where withdrawn_at is null;
create unique index consent_grants_active_workspace_user_purpose_resource_idx
  on consent_grants(workspace_id, user_id, purpose, coalesce(resource_key, ''))
  where withdrawn_at is null and workspace_id is not null and user_id is not null;

alter table connected_accounts
  add constraint connected_accounts_consent_grant_fk
  foreign key (consent_grant_id) references consent_grants(id) on delete restrict;

create index connected_accounts_consent_grant_idx on connected_accounts(consent_grant_id);

-- Renewal notifications are disabled until a specific workspace member opts
-- in. Delivery rows contain schedule/state identifiers only; recipient email
-- and current merchant text are resolved at send time instead of duplicated.
create table renewal_alert_preferences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  consent_grant_id uuid references consent_grants(id) on delete restrict,
  enabled boolean not null default false,
  seven_day_enabled boolean not null default true,
  one_day_enabled boolean not null default true,
  time_zone text not null default 'UTC' check (length(btrim(time_zone)) between 1 and 64),
  send_hour_local smallint not null default 9 check (send_hour_local between 0 and 23),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id),
  check (not enabled or consent_grant_id is not null)
);

create index renewal_alert_preferences_enabled_idx
  on renewal_alert_preferences(workspace_id, user_id)
  where enabled;

create table renewal_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  preference_id uuid not null references renewal_alert_preferences(id) on delete cascade,
  consent_grant_id uuid not null references consent_grants(id) on delete restrict,
  recurring_item_id uuid not null references recurring_items(id) on delete cascade,
  alert_window text not null check (alert_window in ('7_day', '1_day')),
  renewal_date date not null,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 5),
  next_attempt_at timestamptz,
  locked_at timestamptz,
  locked_by text check (locked_by is null or length(locked_by) between 1 and 80),
  sent_at timestamptz,
  last_error_code text check (last_error_code is null or length(last_error_code) between 1 and 80),
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (preference_id, recurring_item_id, alert_window, renewal_date),
  check (
    (status = 'sending' and locked_at is not null and locked_by is not null)
    or (status <> 'sending' and locked_at is null and locked_by is null)
  ),
  check (
    (status = 'sent' and sent_at is not null)
    or (status <> 'sent' and sent_at is null)
  ),
  check (status <> 'failed' or last_error_code is not null)
);

create index renewal_alert_deliveries_due_idx
  on renewal_alert_deliveries(status, next_attempt_at, scheduled_for)
  where status in ('scheduled', 'failed', 'sending');

create index renewal_alert_deliveries_workspace_idx
  on renewal_alert_deliveries(workspace_id, created_at desc);

create table workspace_retention_policies (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  raw_connector_payload_days integer not null default 30 check (raw_connector_payload_days between 7 and 90),
  product_event_days integer not null default 90 check (product_event_days between 30 and 365),
  operational_error_days integer not null default 30 check (operational_error_days between 7 and 90),
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table data_subject_requests (
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

create index data_subject_requests_requester_idx on data_subject_requests(requester_user_id, requested_at desc);
create index data_subject_requests_workspace_idx on data_subject_requests(workspace_id, requested_at desc);
create unique index data_subject_requests_ready_idx on data_subject_requests(workspace_id, requester_user_id, request_type) where status = 'ready';

create table retention_runs (
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

create index retention_runs_workspace_started_idx on retention_runs(workspace_id, started_at desc);

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
