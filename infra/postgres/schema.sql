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

create table auth_identities (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('google')),
  issuer text not null,
  subject text not null,
  user_id uuid not null references users(id) on delete cascade,
  email_at_link text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, issuer, subject),
  unique (provider, user_id)
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

-- Shared API rate-limit buckets persist only namespaced opaque identities.
-- The application hashes network and user identifiers before they reach this
-- table, so raw IP addresses, emails, and session tokens are not retained.
create table rate_limit_buckets (
  bucket_key text primary key check (length(bucket_key) between 16 and 240),
  request_count integer not null check (request_count > 0),
  reset_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index rate_limit_buckets_reset_idx on rate_limit_buckets(reset_at);

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
  workspace_id uuid references workspaces(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  lead_id uuid references private_audit_leads(id) on delete set null,
  customer_email text not null check (length(btrim(customer_email)) between 3 and 320),
  plan text not null check (plan in ('personal', 'founder', 'team', 'annual', 'assisted-audit')),
  offer_id text not null default 'legacy-unversioned-offer',
  offer_version integer not null default 1 check (offer_version > 0),
  terms_version text not null default 'legacy-unversioned',
  provider text not null check (provider in ('razorpay', 'payment-link')),
  status text not null default 'created' check (status in ('created', 'pending', 'paid', 'partially_refunded', 'failed', 'reconciliation_required', 'cancelled', 'expired', 'refunded')),
  currency char(3) not null default 'INR',
  amount_minor bigint not null check (amount_minor > 0),
  refunded_amount_minor bigint not null default 0 check (refunded_amount_minor >= 0 and refunded_amount_minor <= amount_minor),
  idempotency_key text not null unique check (length(idempotency_key) between 16 and 128),
  provider_checkout_id text,
  provider_payment_id text,
  provider_checkout_url text,
  provider_creation_started_at timestamptz,
  paid_at timestamptz,
  refunded_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status in ('paid', 'partially_refunded', 'refunded')) = (paid_at is not null)),
  check (status <> 'refunded' or refunded_at is not null)
);

create unique index billing_checkout_provider_id_idx on billing_checkout_sessions(provider, provider_checkout_id) where provider_checkout_id is not null;
create index billing_checkout_workspace_created_idx on billing_checkout_sessions(workspace_id, created_at desc);
create unique index billing_checkout_payment_idx on billing_checkout_sessions(provider, provider_payment_id) where provider_payment_id is not null;
create index billing_checkout_lead_idx on billing_checkout_sessions(lead_id) where lead_id is not null;
create unique index billing_checkout_assisted_offer_idx on billing_checkout_sessions(lead_id, offer_id, offer_version) where plan = 'assisted-audit' and lead_id is not null;

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

create table billing_refunds (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('razorpay')),
  provider_refund_id text not null,
  provider_payment_id text not null,
  checkout_session_id uuid references billing_checkout_sessions(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  status text not null check (status in ('pending_payment', 'applied', 'rejected')),
  rejection_code text,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (provider, provider_refund_id)
);

create index billing_refunds_payment_idx on billing_refunds(provider, provider_payment_id, created_at);

create table assisted_audit_orders (
  id uuid primary key default gen_random_uuid(),
  checkout_session_id uuid not null unique references billing_checkout_sessions(id) on delete restrict,
  workspace_id uuid references workspaces(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  lead_id uuid references private_audit_leads(id) on delete set null,
  offer_id text not null,
  offer_version integer not null check (offer_version > 0),
  terms_version text not null,
  status text not null check (status in ('review_required', 'pending', 'in_progress', 'delivered', 'cancelled', 'refunded')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  delivered_at timestamptz,
  refunded_at timestamptz,
  updated_at timestamptz not null default now()
);

create index assisted_audit_orders_status_created_idx on assisted_audit_orders(status, created_at);

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
  status text not null default 'active' check (status in ('pending', 'active', 'needs_reauth', 'blocked', 'revoked', 'manual')),
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
    'export.created',
    'private_audit.requested',
    'billing.checkout_started',
    'billing.payment_settled',
    'billing.payment_refunded'
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
  weekly_digest_enabled boolean not null default false,
  seven_day_enabled boolean not null default true,
  one_day_enabled boolean not null default true,
  time_zone text not null default 'UTC' check (length(btrim(time_zone)) between 1 and 64),
  send_hour_local smallint not null default 9 check (send_hour_local between 0 and 23),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id),
  constraint renewal_alert_preferences_delivery_consent_check
    check (not (enabled or weekly_digest_enabled) or consent_grant_id is not null)
);

create index renewal_alert_preferences_enabled_idx
  on renewal_alert_preferences(workspace_id, user_id)
  where enabled;

create index renewal_alert_preferences_weekly_digest_idx
  on renewal_alert_preferences(workspace_id, user_id)
  where weekly_digest_enabled;

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
  last_invocation text check (last_invocation is null or last_invocation in ('internal-api', 'cron')),
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

create table weekly_digest_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  preference_id uuid not null references renewal_alert_preferences(id) on delete cascade,
  consent_grant_id uuid not null references consent_grants(id) on delete restrict,
  week_start date not null,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 5),
  next_attempt_at timestamptz,
  last_invocation text check (last_invocation is null or last_invocation in ('internal-api', 'cron')),
  locked_at timestamptz,
  locked_by text check (locked_by is null or length(locked_by) between 1 and 80),
  sent_at timestamptz,
  last_error_code text check (last_error_code is null or length(last_error_code) between 1 and 80),
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (preference_id, week_start),
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

create index weekly_digest_deliveries_due_idx
  on weekly_digest_deliveries(status, next_attempt_at, scheduled_for)
  where status in ('scheduled', 'failed', 'sending');

create index weekly_digest_deliveries_workspace_idx
  on weekly_digest_deliveries(workspace_id, created_at desc);

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
      'recoveryRawEvidenceMinimized',
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
      and coalesce(jsonb_typeof(counts -> 'recoveryRawEvidenceMinimized') = 'number', true)
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

-- Living Proof Graph and append-only workspace history. The normalized ledger
-- tables remain the typed source of truth; these tables provide stable graph
-- identities, edges, confidence explanations, and reconstructible mutations.
alter table workspaces
  add column if not exists workspace_type text not null default 'personal'
    check (workspace_type in ('personal', 'family', 'founder', 'team'));

create table merchant_entities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  normalized_name text not null check (length(btrim(normalized_name)) between 1 and 240),
  display_name text not null check (length(btrim(display_name)) between 1 and 240),
  country_code char(2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, normalized_name)
);

alter table recurring_items add column merchant_entity_id uuid references merchant_entities(id) on delete set null;
create index recurring_items_merchant_entity_idx on recurring_items(workspace_id, merchant_entity_id);

create table payment_rails (
  id text primary key check (id ~ '^[a-z][a-z0-9-]{1,62}$'),
  label text not null check (length(btrim(label)) between 1 and 120),
  regulated boolean not null default false,
  created_at timestamptz not null default now()
);

alter table data_sources add column rail_id text references payment_rails(id) on delete set null;

create table proof_nodes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null check (kind in ('commitment', 'evidence', 'source', 'merchant', 'rail', 'action', 'saving')),
  entity_ref text not null check (length(btrim(entity_ref)) between 1 and 240),
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  unique (workspace_id, kind, entity_ref),
  unique (workspace_id, id),
  check ((status = 'retired') = (retired_at is not null))
);

create table workspace_event_counters (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  next_sequence bigint not null default 1 check (next_sequence > 0),
  updated_at timestamptz not null default now()
);

create table ledger_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  workspace_sequence bigint not null check (workspace_sequence > 0),
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.-]{2,119}$'),
  schema_version integer not null default 1 check (schema_version > 0),
  actor_user_id uuid references users(id) on delete set null,
  entity_kind text not null check (length(btrim(entity_kind)) between 1 and 80),
  entity_ref text not null check (length(btrim(entity_ref)) between 1 and 240),
  idempotency_key text not null check (length(idempotency_key) between 16 and 160),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  payload_hash char(64) not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  previous_event_hash char(64),
  event_hash char(64) not null check (event_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz not null default now(),
  unique (workspace_id, workspace_sequence),
  unique (workspace_id, idempotency_key),
  unique (workspace_id, event_hash),
  check (previous_event_hash is null or previous_event_hash ~ '^[0-9a-f]{64}$')
);

create index ledger_events_workspace_occurred_idx on ledger_events(workspace_id, occurred_at desc);
create index ledger_events_entity_idx on ledger_events(workspace_id, entity_kind, entity_ref, workspace_sequence desc);

create table proof_edges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  from_node_id uuid not null,
  to_node_id uuid not null,
  edge_type text not null check (edge_type in ('describes', 'proven_by', 'observed_in', 'paid_via', 'resolved_to', 'authorized_by', 'produced', 'amends')),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by_event_id uuid references ledger_events(id) on delete set null,
  foreign key (workspace_id, from_node_id) references proof_nodes(workspace_id, id) on delete cascade,
  foreign key (workspace_id, to_node_id) references proof_nodes(workspace_id, id) on delete cascade,
  check (from_node_id <> to_node_id),
  check (valid_to is null or valid_to >= valid_from)
);

create unique index proof_edges_active_unique_idx
  on proof_edges(workspace_id, from_node_id, to_node_id, edge_type)
  where valid_to is null;
create index proof_edges_from_idx on proof_edges(workspace_id, from_node_id, edge_type) where valid_to is null;
create index proof_edges_to_idx on proof_edges(workspace_id, to_node_id, edge_type) where valid_to is null;

create table confidence_explanations (
  recurring_item_id uuid primary key references recurring_items(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  score integer not null check (score between 0 and 99),
  proof_density numeric(6, 5) not null check (proof_density between 0 and 1),
  source_diversity numeric(6, 5) not null check (source_diversity between 0 and 1),
  freshness numeric(6, 5) not null check (freshness between 0 and 1),
  cadence_stability numeric(6, 5) not null check (cadence_stability between 0 and 1),
  model_version text not null check (length(btrim(model_version)) between 1 and 80),
  graph_revision bigint not null check (graph_revision > 0),
  explanation jsonb not null default '{}'::jsonb check (jsonb_typeof(explanation) = 'object'),
  computed_at timestamptz not null default now()
);

create index confidence_explanations_workspace_score_idx on confidence_explanations(workspace_id, score desc);

-- Permissioned concierge actions, proof-gated verification, and outcome billing.
-- No action may begin until a versioned, single-commitment authorization exists.

create table if not exists action_cases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  recurring_item_id uuid not null references recurring_items(id) on delete restrict,
  requested_by_user_id uuid not null references users(id) on delete restrict,
  assigned_operator_user_id uuid references users(id) on delete set null,
  action text not null check (action in ('cancel', 'downgrade', 'renegotiate')),
  commitment_class text not null check (commitment_class in (
    'discretionary-subscription', 'usage-based-cloud', 'debt-emi',
    'insurance', 'investment-sip', 'utility', 'contractual-other'
  )),
  status text not null default 'awaiting-authorization' check (status in (
    'awaiting-authorization', 'authorized', 'in-progress', 'provider-pending',
    'executed', 'verifying', 'verified', 'failed', 'withdrawn', 'disputed'
  )),
  currency char(3) not null,
  baseline_monthly_amount numeric(14, 2) not null check (baseline_monthly_amount >= 0),
  baseline_annual_amount numeric(14, 2) not null check (baseline_annual_amount >= 0),
  target_monthly_amount numeric(14, 2) check (target_monthly_amount >= 0),
  maximum_success_fee_minor bigint not null check (maximum_success_fee_minor > 0),
  idempotency_key text not null check (length(idempotency_key) between 16 and 128),
  failure_code text check (failure_code is null or failure_code ~ '^[a-z][a-z0-9_-]{1,79}$'),
  authorized_at timestamptz,
  execution_started_at timestamptz,
  executed_at timestamptz,
  verification_started_at timestamptz,
  verified_at timestamptz,
  withdrawn_at timestamptz,
  disputed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  unique (workspace_id, id),
  check (action <> 'downgrade' or target_monthly_amount is null or target_monthly_amount < baseline_monthly_amount)
);

create index if not exists action_cases_workspace_status_idx
  on action_cases(workspace_id, status, updated_at desc);
create index if not exists action_cases_commitment_idx
  on action_cases(workspace_id, recurring_item_id, created_at desc);

create table if not exists action_authorizations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  action_case_id uuid not null,
  authorized_by_user_id uuid not null references users(id) on delete restrict,
  action text not null check (action in ('cancel', 'downgrade', 'renegotiate')),
  scope text not null check (scope = 'one-action-one-commitment'),
  authorization_version integer not null check (authorization_version > 0),
  terms_version text not null check (length(btrim(terms_version)) between 8 and 120),
  authorization_text text
    check (authorization_text is null or length(btrim(authorization_text)) between 40 and 4000),
  authorization_text_hash char(64) not null check (authorization_text_hash ~ '^[0-9a-f]{64}$'),
  success_fee_basis_points integer not null check (success_fee_basis_points between 0 and 10000),
  minimum_fee_minor bigint not null check (minimum_fee_minor >= 0),
  maximum_fee_minor bigint not null check (maximum_fee_minor > 0),
  authorized_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (workspace_id, action_case_id) references action_cases(workspace_id, id) on delete cascade,
  unique (action_case_id, authorization_version),
  unique (workspace_id, id),
  check (revoked_at is null or revoked_at >= authorized_at)
);

create unique index if not exists action_authorizations_active_idx
  on action_authorizations(action_case_id) where revoked_at is null;

create table if not exists action_case_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  action_case_id uuid not null,
  previous_status text,
  status text not null check (status in (
    'awaiting-authorization', 'authorized', 'in-progress', 'provider-pending',
    'executed', 'verifying', 'verified', 'failed', 'withdrawn', 'disputed'
  )),
  actor_kind text not null check (actor_kind in ('customer', 'operator', 'system')),
  actor_user_id uuid references users(id) on delete set null,
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9_-]{1,79}$'),
  idempotency_key text not null check (length(idempotency_key) between 16 and 160),
  occurred_at timestamptz not null default now(),
  foreign key (workspace_id, action_case_id) references action_cases(workspace_id, id) on delete cascade,
  unique (workspace_id, idempotency_key)
);

create index if not exists action_case_events_case_idx
  on action_case_events(action_case_id, occurred_at, id);

create table if not exists saving_verification_windows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  action_case_id uuid not null,
  ordinal integer not null check (ordinal between 1 and 120),
  expected_debit_on date not null,
  window_start_on date not null,
  window_end_on date not null,
  source_id uuid references data_sources(id) on delete set null,
  status text not null default 'pending' check (status in (
    'pending', 'coverage-missing', 'covered-clean', 'charge-observed',
    'reduced-charge-observed', 'covered-no-charge'
  )),
  observed_transaction_id uuid references transactions(id) on delete set null,
  coverage_confirmed_at timestamptz,
  evaluated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, action_case_id) references action_cases(workspace_id, id) on delete cascade,
  unique (action_case_id, ordinal),
  check (window_start_on <= expected_debit_on and expected_debit_on <= window_end_on),
  check ((status in ('charge-observed', 'reduced-charge-observed')) = (observed_transaction_id is not null))
);

create index if not exists saving_verification_windows_due_idx
  on saving_verification_windows(status, window_end_on, workspace_id);

create table if not exists verified_saving_receipts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  action_case_id uuid not null,
  status text not null default 'active' check (status in ('active', 'amended', 'reversed', 'disputed')),
  currency char(3) not null,
  baseline_monthly_amount numeric(14, 2) not null check (baseline_monthly_amount >= 0),
  current_monthly_amount numeric(14, 2) not null check (current_monthly_amount >= 0),
  verified_monthly_saving numeric(14, 2) not null check (verified_monthly_saving > 0),
  verified_annual_saving numeric(14, 2) not null check (verified_annual_saving > 0),
  clean_cycles integer not null check (clean_cycles > 0),
  required_clean_cycles integer not null check (required_clean_cycles > 0),
  coverage_start_on date not null,
  coverage_end_on date not null,
  proof_version text not null check (length(btrim(proof_version)) between 1 and 80),
  evidence_manifest jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence_manifest) = 'object'),
  receipt_hash char(64) not null check (receipt_hash ~ '^[0-9a-f]{64}$'),
  supersedes_receipt_id uuid references verified_saving_receipts(id) on delete restrict,
  minted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, action_case_id) references action_cases(workspace_id, id) on delete cascade,
  unique (workspace_id, receipt_hash)
);

create unique index if not exists verified_saving_receipts_active_idx
  on verified_saving_receipts(action_case_id) where status = 'active';
create index if not exists verified_saving_receipts_workspace_idx
  on verified_saving_receipts(workspace_id, minted_at desc);

create table if not exists success_fee_invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  action_case_id uuid not null,
  verified_saving_receipt_id uuid not null references verified_saving_receipts(id) on delete restrict,
  checkout_session_id uuid references billing_checkout_sessions(id) on delete set null,
  offer_id text not null,
  offer_version integer not null check (offer_version > 0),
  terms_version text not null,
  success_fee_basis_points integer not null check (success_fee_basis_points between 0 and 10000),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  status text not null default 'pending-review' check (status in (
    'pending-review', 'ready-for-checkout', 'checkout-pending',
    'paid', 'disputed', 'void', 'refunded'
  )),
  review_available_until timestamptz not null,
  paid_at timestamptz,
  disputed_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, action_case_id) references action_cases(workspace_id, id) on delete cascade,
  unique (verified_saving_receipt_id),
  check (review_available_until >= created_at)
);

create index if not exists success_fee_invoices_workspace_status_idx
  on success_fee_invoices(workspace_id, status, review_available_until);

-- Recovery v1: immutable user-submitted evidence, canonical commitments,
-- correction history, decisions, and reconstructible workspace projections.
create table if not exists recovery_workspace_states (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  version bigint not null default 0 check (version >= 0),
  baseline_version bigint check (baseline_version is null or baseline_version > 0),
  latest_changed_state text not null default 'NO_PRIOR_BASELINE'
    check (latest_changed_state in ('NO_PRIOR_BASELINE', 'COMPARED')),
  latest_from_version bigint check (latest_from_version is null or latest_from_version >= 0),
  latest_changed_version bigint check (latest_changed_version is null or latest_changed_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((latest_changed_state = 'NO_PRIOR_BASELINE' and latest_from_version is null and latest_changed_version is null)
    or (latest_changed_state = 'COMPARED' and latest_from_version is not null
      and latest_changed_version is not null and latest_changed_version > latest_from_version))
);

create table if not exists recovery_workspace_versions (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  version bigint not null check (version > 0),
  actor_user_id uuid references users(id) on delete set null,
  mutation_kind text not null check (mutation_kind in ('EVIDENCE', 'CORRECTION', 'CORRECTION_REVERSAL', 'DECISION')),
  changed_state text not null check (changed_state in ('NO_PRIOR_BASELINE', 'COMPARED')),
  from_version bigint check (from_version is null or from_version >= 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, version),
  check ((changed_state = 'NO_PRIOR_BASELINE' and from_version is null)
    or (changed_state = 'COMPARED' and from_version is not null))
);

create table if not exists recovery_submissions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  submitted_by_user_id uuid references users(id) on delete set null,
  source_type text not null check (source_type in ('RECEIPT_PASTE', 'CSV_IMPORT')),
  accepted_evidence_count integer not null default 0 check (accepted_evidence_count >= 0),
  results jsonb not null default '[]'::jsonb check (jsonb_typeof(results) = 'array'),
  ingested_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create table if not exists recovery_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  submission_id uuid not null,
  source_type text not null check (source_type in ('RECEIPT_PASTE', 'CSV_IMPORT')),
  client_ref text not null check (length(btrim(client_ref)) between 1 and 240),
  label text not null check (length(btrim(label)) between 1 and 240),
  content_hash char(64) not null check (content_hash ~ '^[0-9a-f]{64}$'),
  raw_evidence jsonb not null check (jsonb_typeof(raw_evidence) = 'object'),
  raw_minimized_at timestamptz,
  coverage_start date,
  coverage_end date,
  ingested_at timestamptz not null default now(),
  foreign key (workspace_id, submission_id) references recovery_submissions(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  unique (workspace_id, content_hash),
  check (coverage_start is null or coverage_end is null or coverage_start <= coverage_end)
);

create table if not exists recovery_commitments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  identity_key text not null check (length(btrim(identity_key)) between 3 and 500),
  version bigint not null default 1 check (version > 0),
  base_status text not null check (base_status in ('ACTIVE', 'NOT_RECURRING')),
  base_merchant text not null check (length(btrim(base_merchant)) between 1 and 240),
  base_category text not null check (length(btrim(base_category)) between 1 and 120),
  base_cadence text not null check (base_cadence in ('WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'YEARLY', 'IRREGULAR')),
  base_currency char(3) not null check (base_currency ~ '^[A-Z]{3}$'),
  base_amount_minor bigint not null check (base_amount_minor >= 0),
  base_monthly_minor bigint not null check (base_monthly_minor >= 0),
  base_next_expected_date date,
  effective_status text not null check (effective_status in ('ACTIVE', 'NOT_RECURRING')),
  effective_merchant text not null check (length(btrim(effective_merchant)) between 1 and 240),
  effective_cadence text not null check (effective_cadence in ('WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'YEARLY', 'IRREGULAR')),
  effective_amount_minor bigint not null check (effective_amount_minor >= 0),
  effective_monthly_minor bigint not null check (effective_monthly_minor >= 0),
  effective_next_expected_date date,
  confidence_score integer not null check (confidence_score between 0 and 100),
  confidence_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(confidence_reasons) = 'array'),
  recommended_decision text not null check (recommended_decision in ('KEEP', 'MONITOR', 'DOWNGRADE', 'CANCEL', 'INVESTIGATE')),
  recommendation_reason text not null,
  risk_tags text[] not null default '{}',
  first_detected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, identity_key),
  unique (workspace_id, id)
);

create table if not exists recovery_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_id uuid not null,
  fingerprint char(64) not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  immutable boolean not null default true check (immutable),
  evidence_kind text not null check (evidence_kind in ('TRANSACTION', 'RECEIPT')),
  row_number integer not null check (row_number > 0),
  observed_at timestamptz,
  excerpt text not null check (length(excerpt) between 1 and 500),
  excerpt_truncated boolean not null default false,
  merchant text not null check (length(btrim(merchant)) between 1 and 240),
  normalized_merchant text not null check (length(btrim(normalized_merchant)) between 1 and 240),
  category text not null check (length(btrim(category)) between 1 and 120),
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  currency char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  evidence_date date,
  direction text check (direction is null or direction in ('debit', 'credit', 'unknown')),
  cadence_hint text check (cadence_hint is null or cadence_hint in ('WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'YEARLY', 'IRREGULAR')),
  next_expected_date date,
  provenance_kind text not null default 'USER_SUBMITTED' check (provenance_kind = 'USER_SUBMITTED'),
  provenance_reference text not null check (length(btrim(provenance_reference)) between 1 and 500),
  confidence_state text not null check (confidence_state in ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN')),
  confidence_score integer check (confidence_score is null or confidence_score between 0 and 100),
  confidence_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(confidence_reasons) = 'array'),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, source_id) references recovery_sources(workspace_id, id) on delete cascade,
  unique (workspace_id, fingerprint),
  unique (workspace_id, id)
);

create or replace function reject_recovery_evidence_mutation()
returns trigger
language plpgsql
as $$
begin
  -- A whole-workspace privacy deletion is the only destructive path. The
  -- parent row has already gone by the time its cascading delete reaches the
  -- evidence table; every direct update/delete remains forbidden.
  if tg_op = 'DELETE'
    and not exists (select 1 from workspaces where id = old.workspace_id)
  then
    return old;
  end if;
  raise exception 'Recovery evidence is immutable.' using errcode = '55000';
end;
$$;

drop trigger if exists recovery_evidence_immutable_trigger on recovery_evidence;
create trigger recovery_evidence_immutable_trigger
  before update or delete on recovery_evidence
  for each row execute function reject_recovery_evidence_mutation();

create table if not exists recovery_commitment_evidence (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  commitment_id uuid not null,
  evidence_id uuid not null,
  linked_at timestamptz not null default now(),
  primary key (workspace_id, commitment_id, evidence_id),
  foreign key (workspace_id, commitment_id) references recovery_commitments(workspace_id, id) on delete cascade,
  foreign key (workspace_id, evidence_id) references recovery_evidence(workspace_id, id) on delete cascade
);

create table if not exists recovery_corrections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  commitment_id uuid not null,
  created_by_user_id uuid references users(id) on delete set null,
  field text not null check (field in ('MERCHANT', 'AMOUNT', 'NEXT_EXPECTED_DATE', 'CADENCE', 'IS_RECURRING')),
  patch jsonb not null check (jsonb_typeof(patch) = 'object'),
  reason text check (reason is null or length(reason) <= 1000),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVERSED', 'SUPERSEDED')),
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  superseded_at timestamptz,
  foreign key (workspace_id, commitment_id) references recovery_commitments(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  check ((status = 'ACTIVE' and reversed_at is null and superseded_at is null)
    or (status = 'REVERSED' and reversed_at is not null and superseded_at is null)
    or (status = 'SUPERSEDED' and reversed_at is null and superseded_at is not null))
);

create unique index if not exists recovery_corrections_active_field_idx
  on recovery_corrections(workspace_id, commitment_id, field) where status = 'ACTIVE';

create table if not exists recovery_decisions (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  commitment_id uuid not null,
  decided_by_user_id uuid references users(id) on delete set null,
  decision text not null check (decision in ('KEEP', 'MONITOR', 'DOWNGRADE', 'CANCEL', 'INVESTIGATE')),
  decided_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, commitment_id),
  foreign key (workspace_id, commitment_id) references recovery_commitments(workspace_id, id) on delete cascade
);

create table if not exists recovery_changes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  commitment_id uuid not null,
  from_version bigint not null check (from_version >= 0),
  to_version bigint not null check (to_version > from_version),
  kind text not null check (kind in ('ADDED', 'MERCHANT', 'AMOUNT', 'DATE', 'CADENCE', 'RECURRING_CLASSIFICATION')),
  merchant text not null,
  before_value jsonb,
  after_value jsonb,
  provenance_kind text not null check (provenance_kind in ('EVIDENCE', 'CORRECTION', 'CORRECTION_REVERSAL')),
  evidence_submission_id uuid,
  correction_id uuid,
  evidence_ids uuid[] not null default '{}',
  detected_at timestamptz not null default now(),
  foreign key (workspace_id, commitment_id) references recovery_commitments(workspace_id, id) on delete cascade,
  foreign key (workspace_id, evidence_submission_id) references recovery_submissions(workspace_id, id) on delete cascade,
  foreign key (workspace_id, correction_id) references recovery_corrections(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  check (
    (provenance_kind = 'EVIDENCE' and evidence_submission_id is not null
      and correction_id is null and cardinality(evidence_ids) > 0)
    or (provenance_kind in ('CORRECTION', 'CORRECTION_REVERSAL')
      and evidence_submission_id is null and correction_id is not null
      and cardinality(evidence_ids) = 0)
  )
);

create table if not exists recovery_idempotency_keys (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 8 and 160),
  operation text not null check (length(operation) between 3 and 120),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response_payload jsonb not null check (jsonb_typeof(response_payload) = 'object'),
  workspace_version bigint not null check (workspace_version >= 0),
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key),
  unique (workspace_id, idempotency_key)
);

create index if not exists recovery_workspace_versions_created_idx on recovery_workspace_versions(workspace_id, created_at desc);
create index if not exists recovery_sources_ingested_idx on recovery_sources(workspace_id, ingested_at desc);
create index if not exists recovery_sources_retention_idx on recovery_sources(workspace_id, ingested_at) where raw_minimized_at is null and raw_evidence <> '{}'::jsonb;
create index if not exists recovery_commitments_next_idx on recovery_commitments(workspace_id, effective_status, effective_next_expected_date);
create index if not exists recovery_commitments_page_idx on recovery_commitments(workspace_id, updated_at desc, id desc);
create index if not exists recovery_evidence_created_idx on recovery_evidence(workspace_id, created_at, id);
create index if not exists recovery_evidence_source_idx on recovery_evidence(workspace_id, source_id);
create index if not exists recovery_commitment_evidence_page_idx on recovery_commitment_evidence(workspace_id, commitment_id, linked_at desc, evidence_id);
create index if not exists recovery_corrections_history_idx on recovery_corrections(workspace_id, commitment_id, created_at desc, id desc);
create index if not exists recovery_changes_version_idx on recovery_changes(workspace_id, to_version, detected_at, id);
