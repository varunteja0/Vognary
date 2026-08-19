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
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
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
  unique nulls not distinct (workspace_id, connector_id, provider_account_id),
  unique (workspace_id, id)
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
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
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
    'billing.payment_refunded',
    'mandate.signed',
    'mandate.revoked',
    'candidate.evaluated',
    'candidate.vetoed',
    'candidate.authorized',
    'notice.queued',
    'notice.delivered',
    'notice.failed',
    'execution.started',
    'execution.completed',
    'execution.failed',
    'exception.opened',
    'window.verified',
    'verification.pending',
    'invoice.created',
    'source.connected',
    'receipt_setup.started',
    'receipt_setup.completed',
    'receipt_forwarding.verified',
    'receipt_backfill.completed',
    'commitments.detected',
    'correction.recorded',
    'source.health_observed',
    'workspace.returned'
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
      'usageObservationsWritten',
      'commitmentsDetected',
      'correctionsRecorded',
      'healthySources',
      'secondsToTrustworthyPicture'
    ]::text[]) = '{}'::jsonb)
    check (
      coalesce(jsonb_typeof(metrics -> 'recordsSeen') = 'number', true)
      and coalesce(jsonb_typeof(metrics -> 'evidenceWritten') = 'number', true)
      and coalesce(jsonb_typeof(metrics -> 'transactionsWritten') = 'number', true)
      and coalesce(jsonb_typeof(metrics -> 'commitmentsTouched') = 'number', true)
      and coalesce(jsonb_typeof(metrics -> 'usageObservationsWritten') = 'number', true)
      and coalesce(jsonb_typeof(metrics -> 'commitmentsDetected') = 'number', true)
      and coalesce(jsonb_typeof(metrics -> 'correctionsRecorded') = 'number', true)
      and coalesce(jsonb_typeof(metrics -> 'healthySources') = 'number', true)
      and coalesce(jsonb_typeof(metrics -> 'secondsToTrustworthyPicture') = 'number', true)
    )
);

create index product_events_workspace_occurred_idx on product_events(workspace_id, occurred_at desc);
create index product_events_name_occurred_idx on product_events(event_name, occurred_at desc);
create unique index product_events_workspace_activated_once_idx
  on product_events (workspace_id)
  where event_name = 'workspace.activated' and workspace_id is not null;
create unique index product_events_phase_a_workspace_once_idx
  on product_events(workspace_id, event_name)
  where workspace_id is not null and event_name in (
    'receipt_setup.started',
    'receipt_setup.completed',
    'receipt_forwarding.verified',
    'receipt_backfill.completed',
    'commitments.detected',
    'workspace.returned'
  );

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
  mutation_kind text not null check (mutation_kind in ('EVIDENCE', 'CORRECTION', 'CORRECTION_REVERSAL', 'DECISION', 'MANDATE', 'CANDIDATE')),
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

create table if not exists recovery_commitment_context (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  commitment_id uuid not null,
  purpose text check (
    purpose is null or purpose in (
      'CODING', 'RESEARCH', 'WRITING', 'DESIGN', 'INFRASTRUCTURE', 'CRM',
      'MARKETING', 'COMMUNICATION', 'ANALYTICS', 'OPERATIONS', 'OTHER'
    )
  ),
  importance text check (
    importance is null or importance in (
      'PRODUCTION_BREAKS', 'TEAM_WORKFLOW_BREAKS', 'CUSTOMER_FACING_BREAKS',
      'PRODUCTIVITY_DECREASES', 'NOTHING_IMPORTANT', 'NOT_SURE'
    )
  ),
  owner text check (
    owner is null or owner in (
      'FOUNDER', 'ENGINEERING', 'SALES', 'MARKETING', 'OPERATIONS', 'OTHER'
    )
  ),
  updated_by_user_id uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, commitment_id),
  foreign key (workspace_id, commitment_id) references recovery_commitments(workspace_id, id) on delete cascade,
  check (purpose is not null or importance is not null or owner is not null)
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

-- Recovery receipt inbox: secret alias routing and replay-safe provider events.
alter table recovery_submissions
  drop constraint if exists recovery_submissions_source_type_check;
alter table recovery_submissions
  add constraint recovery_submissions_source_type_check
  check (source_type in ('RECEIPT_PASTE', 'CSV_IMPORT', 'FORWARDED_EMAIL', 'GMAIL_OAUTH'));

alter table recovery_sources
  drop constraint if exists recovery_sources_source_type_check;
alter table recovery_sources
  add constraint recovery_sources_source_type_check
  check (source_type in ('RECEIPT_PASTE', 'CSV_IMPORT', 'FORWARDED_EMAIL', 'GMAIL_OAUTH'));

alter table recovery_evidence
  drop constraint if exists recovery_evidence_provenance_kind_check;
alter table recovery_evidence
  add constraint recovery_evidence_provenance_kind_check
  check (provenance_kind in ('USER_SUBMITTED', 'PROVIDER_RECEIVED'));

create table if not exists recovery_inbound_aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connected_account_id uuid not null,
  receiving_domain text not null check (
    receiving_domain = lower(btrim(receiving_domain))
    and length(receiving_domain) between 3 and 253
  ),
  alias_hmac char(64) not null check (alias_hmac ~ '^[0-9a-f]{64}$'),
  hmac_key_id text not null check (length(btrim(hmac_key_id)) between 1 and 120),
  encrypted_display jsonb check (encrypted_display is null or jsonb_typeof(encrypted_display) = 'object'),
  encryption_key_fingerprint text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ROTATED', 'REVOKED')),
  replaced_by_id uuid,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  revoked_at timestamptz,
  gmail_verification_code text
    check (gmail_verification_code is null or gmail_verification_code ~ '^[0-9]{6,12}$'),
  gmail_verification_url text
    check (gmail_verification_url is null or gmail_verification_url like 'https://mail-settings.google.com/mail/%'),
  gmail_verification_received_at timestamptz,
  setup_completed_at timestamptz,
  forwarding_verified_at timestamptz,
  backfill_completed_at timestamptz,
  unique (hmac_key_id, alias_hmac),
  unique (workspace_id, id),
  foreign key (workspace_id, connected_account_id)
    references connected_accounts(workspace_id, id) on delete cascade,
  foreign key (workspace_id, replaced_by_id)
    references recovery_inbound_aliases(workspace_id, id) on delete set null (replaced_by_id),
  check (
    (status = 'ACTIVE' and rotated_at is null and revoked_at is null and encrypted_display is not null)
    or (status = 'ROTATED' and rotated_at is not null and revoked_at is null and encrypted_display is null)
    or (status = 'REVOKED' and revoked_at is not null and encrypted_display is null)
  ),
  constraint recovery_inbound_aliases_gmail_verification_check check (
    (gmail_verification_received_at is null
      and gmail_verification_code is null
      and gmail_verification_url is null)
    or (gmail_verification_received_at is not null
      and (gmail_verification_code is not null or gmail_verification_url is not null))
  ),
  constraint recovery_inbound_aliases_phase_a_milestones_check check (
    (setup_completed_at is null or setup_completed_at >= created_at)
    and (forwarding_verified_at is null or (
      setup_completed_at is not null
      and forwarding_verified_at >= created_at
    ))
    and (backfill_completed_at is null or (
      setup_completed_at is not null
      and backfill_completed_at >= created_at
    ))
  )
);

create or replace function reject_recovery_inbound_alias_milestone_rewrite()
returns trigger
language plpgsql
as $$
begin
  if old.setup_completed_at is not null
    and new.setup_completed_at is distinct from old.setup_completed_at
  then
    raise exception 'Receipt setup completion is immutable.' using errcode = '55000';
  end if;
  if old.forwarding_verified_at is not null
    and new.forwarding_verified_at is distinct from old.forwarding_verified_at
  then
    raise exception 'Receipt forwarding verification is immutable.' using errcode = '55000';
  end if;
  if old.backfill_completed_at is not null
    and new.backfill_completed_at is distinct from old.backfill_completed_at
  then
    raise exception 'Receipt backfill completion is immutable.' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger recovery_inbound_alias_milestones_immutable
  before update on recovery_inbound_aliases
  for each row execute function reject_recovery_inbound_alias_milestone_rewrite();

create unique index if not exists recovery_inbound_aliases_active_workspace_idx
  on recovery_inbound_aliases(workspace_id)
  where status = 'ACTIVE';
create index if not exists recovery_inbound_aliases_account_idx
  on recovery_inbound_aliases(connected_account_id, status);

create table if not exists recovery_inbound_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'RESEND'),
  svix_id text not null check (length(btrim(svix_id)) between 1 and 240),
  provider_email_id text not null check (length(btrim(provider_email_id)) between 1 and 240),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  alias_id uuid,
  event_type text not null check (length(btrim(event_type)) between 1 and 120),
  payload_hash char(64) not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'RECEIVED'
    check (status in ('RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'TERMINAL_FAILED')),
  error_code text check (error_code is null or length(error_code) <= 120),
  received_at timestamptz not null default now(),
  processing_started_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  processed_at timestamptz,
  foreign key (workspace_id, alias_id)
    references recovery_inbound_aliases(workspace_id, id) on delete set null (alias_id),
  unique (provider, svix_id),
  unique (provider, provider_email_id),
  unique (workspace_id, id),
  check ((status in ('PROCESSED', 'IGNORED', 'TERMINAL_FAILED')) = (processed_at is not null)),
  constraint recovery_inbound_events_processing_lease_check
    check ((status = 'PROCESSING') = (processing_started_at is not null))
);

create index if not exists recovery_inbound_events_workspace_received_idx
  on recovery_inbound_events(workspace_id, received_at desc);
create index if not exists recovery_inbound_events_pending_idx
  on recovery_inbound_events(received_at)
  where status in ('RECEIVED', 'PROCESSING');
create index if not exists recovery_inbound_events_retention_idx
  on recovery_inbound_events(received_at)
  where status in ('PROCESSED', 'IGNORED', 'TERMINAL_FAILED');

create table if not exists recovery_inbound_replay_keys (
  provider text not null check (provider = 'RESEND'),
  key_kind text not null check (key_kind in ('SVIX_ID', 'PROVIDER_EMAIL_ID')),
  key_hash char(64) not null check (key_hash ~ '^[0-9a-f]{64}$'),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (provider, key_kind, key_hash)
);

create index if not exists recovery_inbound_replay_keys_workspace_idx
  on recovery_inbound_replay_keys(workspace_id, created_at desc);

alter table recovery_submissions
  add column if not exists inbound_event_id uuid;
alter table recovery_submissions
  drop constraint if exists recovery_submissions_inbound_event_id_fkey;
alter table recovery_submissions
  add constraint recovery_submissions_inbound_event_id_fkey
  foreign key (workspace_id, inbound_event_id)
  references recovery_inbound_events(workspace_id, id) on delete set null (inbound_event_id);
create unique index if not exists recovery_submissions_inbound_event_idx
  on recovery_submissions(inbound_event_id)
  where inbound_event_id is not null;

-- Sender provenance for forwarded receipt mail. Mail authentication is an
-- assertion made by some other party, so every stored verdict names the
-- authority that made it. Nothing here re-verifies cryptography.
create table if not exists recovery_inbound_sender_assessments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  inbound_event_id uuid,
  client_ref text not null check (length(btrim(client_ref)) between 1 and 240),
  source_id uuid,
  trust_tier text not null check (
    trust_tier in ('VERIFIED_SENDER', 'KNOWN_SENDER', 'UNVERIFIED_SENDER', 'SUSPICIOUS_SENDER')
  ),
  from_domain text check (
    from_domain is null
    or (from_domain = lower(btrim(from_domain)) and length(from_domain) between 3 and 253)
  ),
  trusted_authority text check (
    trusted_authority is null
    or (trusted_authority = lower(btrim(trusted_authority)) and length(trusted_authority) between 1 and 253)
  ),
  assertions jsonb not null default '[]'::jsonb check (jsonb_typeof(assertions) = 'array'),
  signing_domains text[] not null default '{}',
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  assessed_at timestamptz not null default now(),
  foreign key (workspace_id, inbound_event_id)
    references recovery_inbound_events(workspace_id, id) on delete set null (inbound_event_id),
  foreign key (workspace_id, source_id)
    references recovery_sources(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  unique (workspace_id, inbound_event_id, client_ref),
  constraint recovery_inbound_sender_assessments_verified_needs_authority_check
    check (trust_tier <> 'VERIFIED_SENDER' or (trusted_authority is not null and from_domain is not null))
);

create index if not exists recovery_inbound_sender_assessments_known_domain_idx
  on recovery_inbound_sender_assessments(workspace_id, from_domain)
  where source_id is not null and from_domain is not null;
create index if not exists recovery_inbound_sender_assessments_source_idx
  on recovery_inbound_sender_assessments(workspace_id, source_id);

create or replace function reject_recovery_sender_assessment_mutation()
returns trigger
language plpgsql
as $$
begin
  -- Releasing the retained transport reference is the one permitted update.
  if tg_op = 'UPDATE'
    and old.inbound_event_id is not null
    and new.inbound_event_id is null
    and (to_jsonb(new) - 'inbound_event_id') = (to_jsonb(old) - 'inbound_event_id')
  then
    return new;
  end if;
  if tg_op = 'DELETE'
    and not exists (select 1 from workspaces where id = old.workspace_id)
  then
    return old;
  end if;
  raise exception 'Recovery sender assessments are immutable.' using errcode = '55000';
end;
$$;

drop trigger if exists recovery_inbound_sender_assessments_immutable_trigger
  on recovery_inbound_sender_assessments;
create trigger recovery_inbound_sender_assessments_immutable_trigger
  before update or delete on recovery_inbound_sender_assessments
  for each row execute function reject_recovery_sender_assessment_mutation();


-- Add canonical Recovery subscriptions as renewal reminder targets without
-- rewriting or deleting historical deliveries tied to the legacy ledger.
alter table renewal_alert_deliveries
  alter column recurring_item_id drop not null;

alter table renewal_alert_deliveries
  add column if not exists recovery_commitment_id uuid;

alter table renewal_alert_deliveries
  drop constraint if exists renewal_alert_deliveries_recovery_commitment_fkey;
alter table renewal_alert_deliveries
  add constraint renewal_alert_deliveries_recovery_commitment_fkey
  foreign key (workspace_id, recovery_commitment_id)
  references recovery_commitments(workspace_id, id) on delete cascade;

alter table renewal_alert_deliveries
  drop constraint if exists renewal_alert_deliveries_exactly_one_target_check;
alter table renewal_alert_deliveries
  add constraint renewal_alert_deliveries_exactly_one_target_check
  check (num_nonnulls(recurring_item_id, recovery_commitment_id) = 1);

create unique index if not exists renewal_alert_deliveries_recovery_unique_idx
  on renewal_alert_deliveries(preference_id, recovery_commitment_id, alert_window, renewal_date)
  where recovery_commitment_id is not null;

create index if not exists renewal_alert_deliveries_recovery_target_idx
  on renewal_alert_deliveries(workspace_id, recovery_commitment_id)
  where recovery_commitment_id is not null;

-- The candidate retention worker reports terminal inbound-event deletion while
-- 0026 is deliberately held back for the post-deploy worker-drain cutover.
alter table retention_runs drop constraint if exists retention_runs_counts_check;
alter table retention_runs drop constraint if exists retention_runs_counts_check1;
alter table retention_runs drop constraint if exists retention_runs_counts_check2;
alter table retention_runs drop constraint if exists retention_runs_counts_object_check;
alter table retention_runs drop constraint if exists retention_runs_counts_keys_check;
alter table retention_runs drop constraint if exists retention_runs_counts_types_check;

alter table retention_runs
  add constraint retention_runs_counts_object_check
    check (jsonb_typeof(counts) = 'object'),
  add constraint retention_runs_counts_keys_check
    check ((counts - array[
      'connectorEvidencePayloadsMinimized',
      'recoveryRawEvidenceMinimized',
      'recoveryInboundEventsDeleted',
      'webhookPayloadsMinimized',
      'webhookErrorsMinimized',
      'connectorTransactionRowsMinimized',
      'productEventsDeleted',
      'syncRunErrorsMinimized',
      'syncJobErrorsMinimized',
      'connectedAccountErrorsMinimized',
      'dataSubjectRequestsDeleted',
      'retentionRunsDeleted'
    ]::text[]) = '{}'::jsonb),
  add constraint retention_runs_counts_types_check
    check (
      coalesce(jsonb_typeof(counts -> 'connectorEvidencePayloadsMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'recoveryRawEvidenceMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'recoveryInboundEventsDeleted') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'webhookPayloadsMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'webhookErrorsMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'connectorTransactionRowsMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'productEventsDeleted') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'syncRunErrorsMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'syncJobErrorsMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'connectedAccountErrorsMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'dataSubjectRequestsDeleted') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'retentionRunsDeleted') = 'number', true)
    );

-- Terminal receipt-inbox transport metadata follows the workspace operational
-- retention window. Canonical Recovery submissions and evidence remain intact.
alter table recovery_inbound_events
  drop constraint if exists recovery_inbound_events_workspace_id_alias_id_fkey;
alter table recovery_inbound_events
  add constraint recovery_inbound_events_workspace_id_alias_id_fkey
  foreign key (workspace_id, alias_id)
  references recovery_inbound_aliases(workspace_id, id) on delete set null (alias_id);

alter table recovery_submissions
  drop constraint if exists recovery_submissions_inbound_event_id_fkey;
alter table recovery_submissions
  add constraint recovery_submissions_inbound_event_id_fkey
  foreign key (workspace_id, inbound_event_id)
  references recovery_inbound_events(workspace_id, id) on delete set null (inbound_event_id);

alter table recovery_inbound_events
  add column if not exists processing_started_at timestamptz,
  add column if not exists attempt_count integer not null default 0;
alter table recovery_inbound_events
  drop constraint if exists recovery_inbound_events_attempt_count_check;
alter table recovery_inbound_events
  add constraint recovery_inbound_events_attempt_count_check
  check (attempt_count >= 0);
update recovery_inbound_events
set processing_started_at = received_at
where status = 'PROCESSING' and processing_started_at is null;

create or replace function reject_retired_connector_sync_job()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('queued', 'running', 'failed', 'paused') then
    raise exception 'Legacy connector synchronization is retired at Recovery cutover.' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists connector_sync_jobs_recovery_cutover_guard on connector_sync_jobs;
create trigger connector_sync_jobs_recovery_cutover_guard
before insert or update of status on connector_sync_jobs
for each row execute function reject_retired_connector_sync_job();

create or replace function reject_retired_connector_evidence_write()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - array['payload', 'payload_minimized_at']::text[])
       = (to_jsonb(old) - array['payload', 'payload_minimized_at']::text[])
     and new.payload = '{}'::jsonb
     and new.payload_minimized_at is not null then
    return new;
  end if;
  raise exception 'Connector evidence writes are retired at Recovery cutover.' using errcode = '55000';
end;
$$;

drop trigger if exists connector_evidence_running_job_guard on connector_evidence;
create trigger connector_evidence_running_job_guard
before insert or update on connector_evidence
for each row execute function reject_retired_connector_evidence_write();

create or replace function reject_nonterminal_legacy_renewal_delivery()
returns trigger
language plpgsql
as $$
begin
  if new.recurring_item_id is not null and new.status in ('scheduled', 'sending', 'failed') then
    raise exception 'Legacy renewal deliveries are retired at Recovery cutover.' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists renewal_alert_deliveries_recovery_cutover_guard on renewal_alert_deliveries;
create trigger renewal_alert_deliveries_recovery_cutover_guard
before insert or update of recurring_item_id, status on renewal_alert_deliveries
for each row execute function reject_nonterminal_legacy_renewal_delivery();

update connector_sync_runs run
set status = 'blocked',
    finished_at = coalesce(run.finished_at, now()),
    error_code = 'recovery_cutover',
    error_message = 'Legacy connector synchronization retired at Recovery cutover.'
from connector_sync_jobs job
where run.sync_job_id = job.id
  and run.status = 'running'
  and job.status in ('queued', 'running', 'failed', 'paused');

update connector_sync_jobs
set status = 'blocked',
    next_run_at = null,
    locked_at = null,
    locked_by = null,
    last_error = 'Legacy connector synchronization retired at Recovery cutover.',
    last_error_at = now(),
    updated_at = now()
where status in ('queued', 'running', 'failed', 'paused');

update renewal_alert_deliveries
set status = 'cancelled',
    next_attempt_at = null,
    locked_at = null,
    locked_by = null,
    updated_at = now()
where recurring_item_id is not null
  and status in ('scheduled', 'sending', 'failed');

alter table recovery_inbound_events
  drop constraint if exists recovery_inbound_events_processing_lease_check;
alter table recovery_inbound_events
  add constraint recovery_inbound_events_processing_lease_check
  check ((status = 'PROCESSING') = (processing_started_at is not null));

-- Tenant integrity for legacy ledger relations. These constraints stay after
-- the Recovery v1 boundary so synthetic 0022 fixtures can still represent
-- historical cross-workspace rows that cutover must refuse rather than rehome.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'data_sources'::regclass
      and conname = 'data_sources_workspace_id_id_key'
  ) then
    alter table data_sources
      add constraint data_sources_workspace_id_id_key unique (workspace_id, id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'recurring_items'::regclass
      and conname = 'recurring_items_workspace_id_id_key'
  ) then
    alter table recurring_items
      add constraint recurring_items_workspace_id_id_key unique (workspace_id, id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'commitment_decisions'::regclass
      and conname = 'commitment_decisions_workspace_recurring_item_fkey'
  ) then
    alter table commitment_decisions
      add constraint commitment_decisions_workspace_recurring_item_fkey
      foreign key (workspace_id, recurring_item_id)
      references recurring_items(workspace_id, id);
  end if;
end
$$;

create or replace function reject_cross_workspace_evidence_link()
returns trigger
language plpgsql
as $$
declare
  item_workspace uuid;
  source_workspace uuid;
begin
  if new.source_id is null then
    return new;
  end if;
  select workspace_id into item_workspace from recurring_items where id = new.recurring_item_id;
  select workspace_id into source_workspace from data_sources where id = new.source_id;
  if item_workspace is null or source_workspace is null or source_workspace <> item_workspace then
    raise exception 'Evidence source workspace must match the recurring item workspace.' using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists evidence_links_tenant_workspace_guard on evidence_links;
create trigger evidence_links_tenant_workspace_guard
  before insert or update of recurring_item_id, source_id on evidence_links
  for each row execute function reject_cross_workspace_evidence_link();

create or replace function reject_legacy_workspace_reassignment()
returns trigger
language plpgsql
as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'Legacy workspace ownership is immutable.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists data_sources_workspace_immutable on data_sources;
create trigger data_sources_workspace_immutable
  before update of workspace_id on data_sources
  for each row execute function reject_legacy_workspace_reassignment();

drop trigger if exists recurring_items_workspace_immutable on recurring_items;
create trigger recurring_items_workspace_immutable
  before update of workspace_id on recurring_items
  for each row execute function reject_legacy_workspace_reassignment();

-- Autopilot loop (standing mandate, shadow candidates, notices, proof, fees).
-- Execution remains fail-closed in application code until founder switches pass.
create table if not exists recovery_standing_mandates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null check (status in ('ACTIVE', 'REVOKED')),
  terms_version text not null check (length(btrim(terms_version)) between 8 and 120),
  signed_text text not null check (length(btrim(signed_text)) between 40 and 8000),
  signed_text_hash char(64) not null check (signed_text_hash ~ '^[0-9a-f]{64}$'),
  currency char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  per_action_ceiling_minor bigint not null check (per_action_ceiling_minor > 0),
  rolling_30d_ceiling_minor bigint not null check (rolling_30d_ceiling_minor > 0),
  veto_window_hours integer not null default 48 check (veto_window_hours = 48),
  signed_by_user_id uuid not null references users(id) on delete restrict,
  signed_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_user_id uuid references users(id) on delete set null,
  unique (workspace_id, id),
  unique (workspace_id, version),
  check (rolling_30d_ceiling_minor >= per_action_ceiling_minor),
  check (
    (status = 'ACTIVE' and revoked_at is null and revoked_by_user_id is null)
    or (status = 'REVOKED' and revoked_at is not null)
  )
);

create unique index if not exists recovery_standing_mandates_active_idx
  on recovery_standing_mandates(workspace_id) where status = 'ACTIVE';

create table if not exists recovery_billing_year_anchors (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  anchor_date date not null,
  created_at timestamptz not null default now()
);

create or replace function recovery_billing_year_anchors_reject_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from workspaces where id = old.workspace_id) then
      raise exception 'Billing-year anchors cannot be deleted directly.';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and (
    new.anchor_date is distinct from old.anchor_date
    or new.workspace_id is distinct from old.workspace_id
  ) then
    raise exception 'Billing-year anchors cannot be mutated.';
  end if;
  return new;
end;
$$;

drop trigger if exists recovery_billing_year_anchors_immutable on recovery_billing_year_anchors;
create trigger recovery_billing_year_anchors_immutable
  before update or delete on recovery_billing_year_anchors
  for each row execute function recovery_billing_year_anchors_reject_mutation();

create table if not exists recovery_standing_mandate_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  mandate_id uuid not null,
  kind text not null check (kind in ('SIGNED', 'REVOKED')),
  actor_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, mandate_id)
    references recovery_standing_mandates(workspace_id, id) on delete cascade
);

create table if not exists recovery_classification_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  commitment_id uuid not null,
  commitment_class text not null check (commitment_class in (
    'discretionary-subscription', 'usage-based-cloud', 'debt-emi',
    'insurance', 'investment-sip', 'utility', 'contractual-other'
  )),
  protected_override boolean not null,
  cited_category text not null check (length(btrim(cited_category)) between 1 and 120),
  cited_merchant text,
  confidence_score integer not null check (confidence_score between 0 and 100),
  evidence_ids uuid[] not null check (cardinality(evidence_ids) > 0),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, commitment_id)
    references recovery_commitments(workspace_id, id) on delete cascade
);

create table if not exists recovery_action_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  commitment_id uuid not null,
  mandate_id uuid not null,
  mandate_version integer not null check (mandate_version > 0),
  classification_snapshot_id uuid not null references recovery_classification_snapshots(id) on delete restrict,
  commitment_class text not null check (commitment_class in (
    'discretionary-subscription', 'usage-based-cloud', 'debt-emi',
    'insurance', 'investment-sip', 'utility', 'contractual-other'
  )),
  eligibility text not null check (eligibility in ('ELIGIBLE', 'INELIGIBLE', 'PROTECTED', 'UNSUPPORTED_ROUTE')),
  ineligible_reasons text[] not null default '{}',
  status text not null check (status in (
    'SHADOW', 'NOTICE_QUEUED', 'AUTHORIZED_BY_RULE', 'IN_PROGRESS', 'PROVIDER_PENDING',
    'EXECUTED', 'VERIFYING', 'VERIFIED', 'VETOED', 'REVOKED', 'EXCEPTION', 'FAILED', 'DISPUTED', 'WITHDRAWN'
  )),
  provider_id text,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  notice_delivered_at timestamptz,
  veto_deadline_at timestamptz,
  exception_code text,
  next_debit_date date,
  next_debit_inputs_hash char(64),
  next_debit_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, commitment_id, mandate_id, mandate_version),
  foreign key (workspace_id, commitment_id)
    references recovery_commitments(workspace_id, id) on delete cascade,
  foreign key (workspace_id, mandate_id)
    references recovery_standing_mandates(workspace_id, id) on delete cascade,
  check (eligibility <> 'ELIGIBLE' or commitment_class = 'discretionary-subscription'),
  check (status = 'SHADOW' or eligibility = 'ELIGIBLE' or status in ('VETOED', 'REVOKED', 'WITHDRAWN', 'EXCEPTION')),
  check (veto_deadline_at is null or notice_delivered_at is not null)
);

create index if not exists recovery_action_candidates_workspace_status_idx
  on recovery_action_candidates(workspace_id, status, updated_at desc);

create table if not exists recovery_candidate_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  candidate_id uuid not null,
  previous_status text,
  status text not null,
  actor_kind text not null check (actor_kind in ('CUSTOMER', 'OPERATOR', 'SYSTEM')),
  actor_user_id uuid references users(id) on delete set null,
  reason_code text not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, candidate_id)
    references recovery_action_candidates(workspace_id, id) on delete cascade
);

create table if not exists recovery_veto_notices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  candidate_id uuid not null,
  channel text not null check (channel = 'EMAIL'),
  delivery_status text not null check (delivery_status in ('QUEUED', 'ACCEPTED', 'DELIVERED', 'DELAYED', 'BOUNCED', 'FAILED', 'COMPLAINED')),
  delivered_at timestamptz,
  provider_message_id text,
  provider_timestamp timestamptz,
  veto_token_hash char(64),
  veto_expires_at timestamptz,
  notice_body_hash char(64) check (notice_body_hash is null or notice_body_hash ~ '^[0-9a-f]{64}$'),
  notice_from_email text,
  notice_to_email text,
  notice_subject text,
  notice_text text,
  notice_tags jsonb not null default '[{"name":"vognary","value":"autopilot-notice"}]'::jsonb
    check (jsonb_typeof(notice_tags) = 'array'),
  notice_payload_version integer not null default 1 check (notice_payload_version >= 1),
  notice_hash_version smallint not null default 2 check (notice_hash_version in (1, 2)),
  frozen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, candidate_id),
  foreign key (workspace_id, candidate_id)
    references recovery_action_candidates(workspace_id, id) on delete cascade,
  check (delivery_status <> 'DELIVERED' or delivered_at is not null)
);

create unique index if not exists recovery_veto_notices_provider_message_id_idx
  on recovery_veto_notices (provider_message_id)
  where provider_message_id is not null;

create or replace function reject_recovery_frozen_notice_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.frozen_at is not null
      and exists (select 1 from workspaces where id = old.workspace_id)
    then
      raise exception 'Frozen notice cannot be deleted directly.';
    end if;
    return old;
  end if;

  if old.frozen_at is not null and (
    new.id is distinct from old.id
    or new.workspace_id is distinct from old.workspace_id
    or new.candidate_id is distinct from old.candidate_id
    or new.channel is distinct from old.channel
    or new.created_at is distinct from old.created_at
    or new.notice_from_email is distinct from old.notice_from_email
    or new.notice_to_email is distinct from old.notice_to_email
    or new.notice_subject is distinct from old.notice_subject
    or new.notice_text is distinct from old.notice_text
    or new.notice_tags is distinct from old.notice_tags
    or new.notice_payload_version is distinct from old.notice_payload_version
    or new.notice_hash_version is distinct from old.notice_hash_version
    or new.notice_body_hash is distinct from old.notice_body_hash
    or new.veto_token_hash is distinct from old.veto_token_hash
    or new.veto_expires_at is distinct from old.veto_expires_at
    or new.frozen_at is distinct from old.frozen_at
  ) then
    raise exception 'Frozen notice payload cannot be mutated.';
  end if;
  return new;
end;
$$;

drop trigger if exists recovery_veto_notices_frozen_immutable on recovery_veto_notices;
create trigger recovery_veto_notices_frozen_immutable
  before update or delete on recovery_veto_notices
  for each row execute function reject_recovery_frozen_notice_mutation();

create table if not exists recovery_notice_pending_events (
  provider_event_id text primary key check (length(btrim(provider_event_id)) between 8 and 200),
  event_type text not null check (event_type in (
    'email.sent', 'email.delivered', 'email.delayed', 'email.delivery_delayed',
    'email.bounced', 'email.failed', 'email.complained'
  )),
  provider_message_id text not null check (length(btrim(provider_message_id)) >= 8),
  occurred_at timestamptz not null,
  payload_hash char(64) not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create index if not exists recovery_notice_pending_events_message_idx
  on recovery_notice_pending_events (provider_message_id);

create table if not exists recovery_connected_mandate_cohort (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  started_at timestamptz not null,
  recorded_at timestamptz not null default now()
);

create or replace function reject_recovery_cohort_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE'
    and not exists (select 1 from workspaces where id = old.workspace_id)
  then
    return old;
  end if;
  raise exception 'Connected-mandate cohort is immutable.' using errcode = '55000';
end;
$$;

drop trigger if exists recovery_cohort_immutable_trigger on recovery_connected_mandate_cohort;
create trigger recovery_cohort_immutable_trigger
  before update or delete on recovery_connected_mandate_cohort
  for each row execute function reject_recovery_cohort_mutation();

create table if not exists recovery_source_disconnections (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_id uuid not null,
  disconnected_at timestamptz not null default now(),
  reconnected_at timestamptz,
  primary key (workspace_id, source_id),
  foreign key (workspace_id, source_id)
    references recovery_sources(workspace_id, id) on delete cascade
);

create table if not exists recovery_executions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  candidate_id uuid not null,
  provider_id text not null,
  route text not null,
  actor_kind text not null check (actor_kind in ('OPERATOR', 'SYSTEM')),
  actor_user_id uuid references users(id) on delete set null,
  operator_minutes numeric(8, 2) check (operator_minutes is null or operator_minutes >= 0),
  outcome text not null check (outcome in ('EXECUTED', 'EXCEPTION', 'FAILED')),
  proof_kind text,
  proof_reference text,
  failure_reason text,
  attempt_id uuid,
  attempt_no integer not null default 1,
  operation_key text,
  created_at timestamptz not null default now(),
  unique (workspace_id, candidate_id, attempt_no),
  foreign key (workspace_id, candidate_id)
    references recovery_action_candidates(workspace_id, id) on delete cascade,
  check (outcome <> 'EXECUTED' or (proof_kind is not null and proof_reference is not null))
);

create unique index if not exists recovery_executions_one_success_idx
  on recovery_executions (workspace_id, candidate_id)
  where outcome = 'EXECUTED';

create table if not exists recovery_execution_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  candidate_id uuid not null,
  attempt_no integer not null check (attempt_no > 0),
  operation_key text not null unique check (length(btrim(operation_key)) between 16 and 200),
  idempotency_key text check (idempotency_key is null or length(btrim(idempotency_key)) between 8 and 160),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid references users(id) on delete set null,
  provider_id text not null,
  outcome text check (outcome in ('EXECUTED', 'EXCEPTION', 'FAILED')),
  status text not null check (status in ('PENDING', 'AUTHORIZED', 'PROVIDER_CALLED', 'RECORDED', 'FAILED', 'EXCEPTION')),
  proof_kind text,
  proof_reference_hash char(64) check (proof_reference_hash is null or proof_reference_hash ~ '^[0-9a-f]{64}$'),
  failure_reason text,
  operator_minutes numeric(8, 2) check (operator_minutes is null or operator_minutes >= 0),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, candidate_id, attempt_no),
  foreign key (workspace_id, candidate_id)
    references recovery_action_candidates(workspace_id, id) on delete cascade
);

create unique index if not exists recovery_execution_attempts_idempotency_idx
  on recovery_execution_attempts (workspace_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists recovery_operator_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  candidate_id uuid not null,
  actor_user_id uuid not null references users(id) on delete restrict,
  minutes numeric(8, 2) not null check (minutes >= 0),
  outcome text not null check (outcome in ('EXECUTED', 'EXCEPTION', 'FAILED')),
  failure_reason text,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, candidate_id)
    references recovery_action_candidates(workspace_id, id) on delete cascade
);

create table if not exists recovery_covered_windows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  candidate_id uuid not null,
  coverage_source_id uuid,
  window_start date not null,
  window_end date not null,
  expected_debit_date date not null,
  baseline_debit_minor bigint not null check (baseline_debit_minor >= 0),
  observed_debit_minor bigint check (observed_debit_minor is null or observed_debit_minor >= 0),
  saving_minor bigint check (saving_minor is null or saving_minor >= 0),
  status text not null check (status in ('PENDING', 'COVERED_CLEAN', 'NOT_ELIMINATED', 'MISSING_COVERAGE')),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  inputs_hash char(64),
  commitment_id uuid,
  created_at timestamptz not null default now(),
  unique (workspace_id, candidate_id, expected_debit_date),
  foreign key (workspace_id, candidate_id)
    references recovery_action_candidates(workspace_id, id) on delete cascade,
  constraint recovery_covered_windows_source_fk
    foreign key (workspace_id, coverage_source_id)
    references recovery_sources(workspace_id, id) on delete cascade,
  check (status in ('PENDING', 'MISSING_COVERAGE') or saving_minor is not null),
  check (window_start <= window_end)
);

create extension if not exists btree_gist;

create table if not exists recovery_fee_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  currency char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  monitoring_minor bigint not null check (monitoring_minor >= 0),
  verified_saving_minor bigint not null check (verified_saving_minor >= 0),
  outcome_fee_minor bigint not null check (outcome_fee_minor >= 0),
  retained_minor bigint not null check (retained_minor >= 0),
  refund_credit_minor bigint not null check (refund_credit_minor >= 0),
  additional_charge_minor bigint not null check (additional_charge_minor >= 0),
  razorpay_charge_status text not null default 'FAIL_CLOSED'
    check (razorpay_charge_status in ('FAIL_CLOSED', 'INVOICE_ONLY', 'CHARGED', 'REFUNDED')),
  inputs_hash char(64) not null check (inputs_hash ~ '^[0-9a-f]{64}$'),
  year_start date not null,
  finalized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint recovery_fee_ledger_workspace_currency_period_key
    unique (workspace_id, currency, period_start, period_end),
  constraint recovery_fee_ledger_period_order check (period_start <= period_end),
  constraint recovery_fee_ledger_no_overlap
    exclude using gist (
      workspace_id with =,
      currency with =,
      daterange(period_start, period_end, '[]') with &&
    )
);

create or replace function recovery_fee_ledger_reject_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from workspaces where id = new.workspace_id) then
      perform pg_advisory_xact_lock(hashtextextended('recovery:' || new.workspace_id::text, 0));
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if exists (select 1 from workspaces where id = old.workspace_id) then
      perform pg_advisory_xact_lock(hashtextextended('recovery:' || old.workspace_id::text, 0));
      raise exception 'Finalized fee ledger rows cannot be deleted directly.';
    end if;
    return old;
  end if;

  if exists (select 1 from workspaces where id = old.workspace_id) then
    perform pg_advisory_xact_lock(hashtextextended('recovery:' || old.workspace_id::text, 0));
  end if;
  if new.monitoring_minor is distinct from old.monitoring_minor
    or new.verified_saving_minor is distinct from old.verified_saving_minor
    or new.outcome_fee_minor is distinct from old.outcome_fee_minor
    or new.retained_minor is distinct from old.retained_minor
    or new.refund_credit_minor is distinct from old.refund_credit_minor
    or new.additional_charge_minor is distinct from old.additional_charge_minor
    or new.currency is distinct from old.currency
    or new.period_start is distinct from old.period_start
    or new.period_end is distinct from old.period_end
    or new.inputs_hash is distinct from old.inputs_hash
    or new.workspace_id is distinct from old.workspace_id
    or new.year_start is distinct from old.year_start
    or new.finalized_at is distinct from old.finalized_at
    or new.razorpay_charge_status is distinct from old.razorpay_charge_status
  then
    raise exception 'Finalized fee ledger rows cannot be mutated.';
  end if;
  return new;
end;
$$;

drop trigger if exists recovery_fee_ledger_immutable on recovery_fee_ledger;
create trigger recovery_fee_ledger_immutable
  before insert or update or delete on recovery_fee_ledger
  for each row execute function recovery_fee_ledger_reject_mutation();

create table if not exists recovery_shadow_gate_snapshots (
  id uuid primary key default gen_random_uuid(),
  measured_at timestamptz not null default now(),
  connected_mandates integer not null check (connected_mandates >= 0),
  eligible_candidates integer not null check (eligible_candidates >= 0),
  protected_leakage integer not null check (protected_leakage >= 0),
  passed boolean not null,
  evidence jsonb not null default '{}'::jsonb,
  snapshot_hash char(64) not null check (snapshot_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists recovery_notice_delivery_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  candidate_id uuid not null,
  provider_event_id text not null check (length(btrim(provider_event_id)) between 8 and 200),
  event_type text not null check (event_type in (
    'email.sent', 'email.delivered', 'email.delayed', 'email.delivery_delayed',
    'email.bounced', 'email.failed', 'email.complained'
  )),
  provider_message_id text,
  occurred_at timestamptz not null,
  payload_hash char(64) not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (provider_event_id),
  foreign key (workspace_id, candidate_id)
    references recovery_action_candidates(workspace_id, id) on delete cascade
);

create table if not exists recovery_autopilot_dead_letters (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('NOTICE', 'EXECUTION', 'WEBHOOK', 'INVOICE')),
  workspace_id uuid references workspaces(id) on delete cascade,
  candidate_id uuid,
  payload_hash char(64) not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  last_error_code text not null check (length(btrim(last_error_code)) between 3 and 80),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists recovery_provider_disables (
  provider_id text primary key check (length(btrim(provider_id)) between 2 and 80),
  disabled boolean not null default true,
  reason text not null check (length(btrim(reason)) between 3 and 240),
  updated_at timestamptz not null default now()
);

-- 0043: keep this after the Recovery v1 boundary so the synthetic 0022 seed
-- can still insert historically unmarked workspace.activated rows.
alter table product_events
  add column if not exists activation_semantic_version smallint;
alter table product_events
  drop constraint if exists product_events_workspace_activated_semantic_version_check;
alter table product_events
  add constraint product_events_workspace_activated_semantic_version_check
  check (
    (event_name = 'workspace.activated' and activation_semantic_version is not distinct from 1)
    or (event_name <> 'workspace.activated' and activation_semantic_version is null)
  );

-- 0044: audit-row immutability. Direct DELETE of fees, billing anchors, and
-- version-1 activations is forbidden while the workspace still exists.
create or replace function reject_workspace_activation_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE'
    and old.event_name = 'workspace.activated'
    and old.activation_semantic_version is not distinct from 1
    and old.workspace_id is not null
    and exists (select 1 from workspaces where id = old.workspace_id)
  then
    raise exception 'Workspace activation cannot be deleted directly.';
  end if;
  return old;
end;
$$;

drop trigger if exists product_events_workspace_activated_immutable on product_events;
create trigger product_events_workspace_activated_immutable
  before delete on product_events
  for each row execute function reject_workspace_activation_mutation();

-- 0045: tamper-evident mandates, append-only Autopilot audit facts,
-- constrained execution-attempt transitions, frozen fee charge status.
create or replace function recovery_standing_mandates_constrain_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from workspaces where id = old.workspace_id) then
      raise exception 'Standing mandates cannot be deleted while the workspace exists.';
    end if;
    return old;
  end if;

  if new.id is distinct from old.id
    or new.workspace_id is distinct from old.workspace_id
    or new.version is distinct from old.version
    or new.terms_version is distinct from old.terms_version
    or new.signed_text is distinct from old.signed_text
    or new.signed_text_hash is distinct from old.signed_text_hash
    or new.currency is distinct from old.currency
    or new.per_action_ceiling_minor is distinct from old.per_action_ceiling_minor
    or new.rolling_30d_ceiling_minor is distinct from old.rolling_30d_ceiling_minor
    or new.veto_window_hours is distinct from old.veto_window_hours
    or new.signed_by_user_id is distinct from old.signed_by_user_id
    or new.signed_at is distinct from old.signed_at
  then
    raise exception 'Standing mandate terms cannot be mutated.';
  end if;

  if old.status = 'REVOKED' then
    raise exception 'Revoked standing mandates cannot be mutated.';
  end if;

  if old.status = 'ACTIVE' and new.status = 'ACTIVE' then
    if new.revoked_at is distinct from old.revoked_at
      or new.revoked_by_user_id is distinct from old.revoked_by_user_id
    then
      raise exception 'Standing mandate revoke fields cannot change while ACTIVE.';
    end if;
    return new;
  end if;

  if old.status = 'ACTIVE' and new.status = 'REVOKED' then
    if new.revoked_at is null or new.revoked_by_user_id is null then
      raise exception 'Standing mandate revoke requires a timestamp and revoking user.';
    end if;
    return new;
  end if;

  raise exception 'Standing mandate status transition is not allowed.';
end;
$$;

drop trigger if exists recovery_standing_mandates_immutable on recovery_standing_mandates;
create trigger recovery_standing_mandates_immutable
  before update or delete on recovery_standing_mandates
  for each row execute function recovery_standing_mandates_constrain_mutation();

create or replace function recovery_audit_reject_direct_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from workspaces where id = old.workspace_id) then
      raise exception '% cannot be deleted while the workspace exists.', tg_table_name;
    end if;
    return old;
  end if;
  raise exception '% cannot be updated.', tg_table_name;
end;
$$;

drop trigger if exists recovery_classification_snapshots_immutable on recovery_classification_snapshots;
create trigger recovery_classification_snapshots_immutable
  before update or delete on recovery_classification_snapshots
  for each row execute function recovery_audit_reject_direct_mutation();

drop trigger if exists recovery_standing_mandate_events_immutable on recovery_standing_mandate_events;
create trigger recovery_standing_mandate_events_immutable
  before update or delete on recovery_standing_mandate_events
  for each row execute function recovery_audit_reject_direct_mutation();

drop trigger if exists recovery_candidate_events_immutable on recovery_candidate_events;
create trigger recovery_candidate_events_immutable
  before update or delete on recovery_candidate_events
  for each row execute function recovery_audit_reject_direct_mutation();

drop trigger if exists recovery_executions_immutable on recovery_executions;
create trigger recovery_executions_immutable
  before update or delete on recovery_executions
  for each row execute function recovery_audit_reject_direct_mutation();

drop trigger if exists recovery_operator_actions_immutable on recovery_operator_actions;
create trigger recovery_operator_actions_immutable
  before update or delete on recovery_operator_actions
  for each row execute function recovery_audit_reject_direct_mutation();

create or replace function recovery_execution_attempts_constrain_mutation()
returns trigger
language plpgsql
as $$
declare
  legal boolean := false;
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from workspaces where id = old.workspace_id) then
      raise exception 'Execution attempts cannot be deleted while the workspace exists.';
    end if;
    return old;
  end if;

  if new.id is distinct from old.id
    or new.workspace_id is distinct from old.workspace_id
    or new.candidate_id is distinct from old.candidate_id
    or new.attempt_no is distinct from old.attempt_no
    or new.operation_key is distinct from old.operation_key
    or new.idempotency_key is distinct from old.idempotency_key
    or new.request_hash is distinct from old.request_hash
    or new.actor_user_id is distinct from old.actor_user_id
    or new.provider_id is distinct from old.provider_id
    or new.outcome is distinct from old.outcome
    or new.proof_kind is distinct from old.proof_kind
    or new.proof_reference_hash is distinct from old.proof_reference_hash
    or new.operator_minutes is distinct from old.operator_minutes
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Execution attempt identity cannot be mutated.';
  end if;

  if old.status is not distinct from new.status then
    if new.failure_reason is distinct from old.failure_reason then
      raise exception 'Execution attempt status transition is not allowed.';
    end if;
    return new;
  end if;

  if old.status in ('RECORDED', 'FAILED', 'EXCEPTION') then
    raise exception 'Terminal execution attempts cannot be mutated.';
  end if;

  legal :=
    (old.status = 'PENDING' and new.status = 'AUTHORIZED')
    or (old.status = 'AUTHORIZED' and new.status in ('PROVIDER_CALLED', 'FAILED', 'EXCEPTION'))
    or (old.status = 'PROVIDER_CALLED' and new.status in ('RECORDED', 'FAILED', 'EXCEPTION'));

  if not legal then
    raise exception 'Execution attempt status transition is not allowed.';
  end if;
  return new;
end;
$$;

drop trigger if exists recovery_execution_attempts_immutable on recovery_execution_attempts;
create trigger recovery_execution_attempts_immutable
  before update or delete on recovery_execution_attempts
  for each row execute function recovery_execution_attempts_constrain_mutation();

-- 0047: finalized fee periods reject new covered-window facts too.
create or replace function recovery_covered_windows_constrain_billed_mutation()
returns trigger
language plpgsql
as $$
declare
  locked_workspace_id uuid;
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from workspaces where id = new.workspace_id) then
      perform pg_advisory_xact_lock(hashtextextended('recovery:' || new.workspace_id::text, 0));
      if exists (
        select 1
        from recovery_fee_ledger fee
        where fee.workspace_id = new.workspace_id
          and fee.currency = new.currency
          and new.expected_debit_date between fee.period_start and fee.period_end
      ) then
        raise exception 'Billed covered windows cannot be mutated.';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if exists (select 1 from workspaces where id = old.workspace_id) then
      perform pg_advisory_xact_lock(hashtextextended('recovery:' || old.workspace_id::text, 0));
      if exists (
        select 1
        from recovery_fee_ledger fee
        where fee.workspace_id = old.workspace_id
          and fee.currency = old.currency
          and old.expected_debit_date between fee.period_start and fee.period_end
      ) then
        raise exception 'Billed covered windows cannot be mutated.';
      end if;
    end if;
    return old;
  end if;

  for locked_workspace_id in
    select workspace.id
    from workspaces workspace
    where workspace.id in (old.workspace_id, new.workspace_id)
    order by workspace.id
  loop
    perform pg_advisory_xact_lock(hashtextextended('recovery:' || locked_workspace_id::text, 0));
  end loop;

  if exists (select 1 from workspaces where id = old.workspace_id)
    and exists (
      select 1
      from recovery_fee_ledger fee
      where fee.workspace_id = old.workspace_id
        and fee.currency = old.currency
        and old.expected_debit_date between fee.period_start and fee.period_end
    )
  then
    raise exception 'Billed covered windows cannot be mutated.';
  end if;

  if exists (select 1 from workspaces where id = new.workspace_id)
    and exists (
      select 1
      from recovery_fee_ledger fee
      where fee.workspace_id = new.workspace_id
        and fee.currency = new.currency
        and new.expected_debit_date between fee.period_start and fee.period_end
    )
  then
    raise exception 'Billed covered windows cannot be mutated.';
  end if;
  return new;
end;
$$;

drop trigger if exists recovery_covered_windows_billed_immutable on recovery_covered_windows;
create trigger recovery_covered_windows_billed_immutable
  before insert or update or delete on recovery_covered_windows
  for each row execute function recovery_covered_windows_constrain_billed_mutation();

-- Commitment graph: canonical merchant identity, living commitment state,
-- change signals with their notifications, and the correction learning dataset.
-- Additive throughout. recovery_commitments, recovery_evidence and
-- recovery_corrections remain the authority on money, merchant and cadence.
create table if not exists recovery_merchants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, currency, display_name)
);

create index if not exists recovery_merchants_workspace_idx
  on recovery_merchants(workspace_id, currency);

create table if not exists recovery_merchant_signals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  merchant_id uuid not null,
  evidence_id uuid not null,
  signal_kind text not null check (
    signal_kind in (
      'EXPLICIT_MERCHANT_ID', 'GSTIN', 'BILLING_DOMAIN', 'SENDER_DOMAIN',
      'PROCESSOR_DESCRIPTOR', 'ACCOUNT_IDENTIFIER', 'INVOICE_IDENTIFIER', 'FUZZY_ALIAS'
    )
  ),
  signal_key text not null check (length(btrim(signal_key)) between 1 and 253),
  observed_at timestamptz not null default now(),
  foreign key (workspace_id, merchant_id)
    references recovery_merchants(workspace_id, id) on delete cascade,
  foreign key (workspace_id, evidence_id)
    references recovery_evidence(workspace_id, id) on delete cascade,
  unique (workspace_id, merchant_id, signal_kind, signal_key, evidence_id)
);

create index if not exists recovery_merchant_signals_lookup_idx
  on recovery_merchant_signals(workspace_id, signal_kind, signal_key);

create table if not exists recovery_merchant_links (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  commitment_id uuid not null,
  merchant_id uuid not null,
  decision text not null check (decision in ('AUTO_MERGE', 'USER_CONFIRMED')),
  score smallint not null check (score between 0 and 100),
  strongest_signal_kind text not null,
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  cited_evidence_ids uuid[] not null default '{}' check (cardinality(cited_evidence_ids) >= 1),
  linked_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by_user_id uuid references users(id) on delete set null,
  primary key (workspace_id, commitment_id, merchant_id),
  foreign key (workspace_id, commitment_id)
    references recovery_commitments(workspace_id, id) on delete cascade,
  foreign key (workspace_id, merchant_id)
    references recovery_merchants(workspace_id, id) on delete cascade,
  constraint recovery_merchant_links_reversal_check
    check (reversed_at is not null or reversed_by_user_id is null)
);

create unique index if not exists recovery_merchant_links_active_idx
  on recovery_merchant_links(workspace_id, commitment_id)
  where reversed_at is null;

create table if not exists recovery_merchant_merge_rejections (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  commitment_id uuid not null,
  merchant_id uuid not null,
  rejected_at timestamptz not null default now(),
  rejected_by_user_id uuid references users(id) on delete set null,
  primary key (workspace_id, commitment_id, merchant_id),
  foreign key (workspace_id, commitment_id)
    references recovery_commitments(workspace_id, id) on delete cascade,
  foreign key (workspace_id, merchant_id)
    references recovery_merchants(workspace_id, id) on delete cascade
);

create or replace function recovery_merchant_link_currency_guard()
returns trigger
language plpgsql
as $$
declare
  merchant_currency char(3);
  commitment_currency char(3);
begin
  select currency into merchant_currency
    from recovery_merchants
    where workspace_id = new.workspace_id and id = new.merchant_id;
  select base_currency into commitment_currency
    from recovery_commitments
    where workspace_id = new.workspace_id and id = new.commitment_id;
  if merchant_currency is distinct from commitment_currency then
    raise exception 'Recovery merchant links may not cross currency.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists recovery_merchant_links_currency_trigger on recovery_merchant_links;
create trigger recovery_merchant_links_currency_trigger
  before insert or update on recovery_merchant_links
  for each row execute function recovery_merchant_link_currency_guard();

create or replace function reject_recovery_merchant_signal_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE'
    and not exists (select 1 from workspaces where id = old.workspace_id)
  then
    return old;
  end if;
  raise exception 'Recovery merchant signals are append-only.' using errcode = '55000';
end;
$$;

drop trigger if exists recovery_merchant_signals_append_only_trigger on recovery_merchant_signals;
create trigger recovery_merchant_signals_append_only_trigger
  before update or delete on recovery_merchant_signals
  for each row execute function reject_recovery_merchant_signal_mutation();

create table if not exists recovery_commitment_states (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  commitment_id uuid not null,
  lifecycle_state text not null check (
    lifecycle_state in ('OBSERVED', 'ESTABLISHED', 'CHANGED', 'AT_RISK', 'ENDING', 'LIKELY_ENDED', 'ENDED', 'UNVERIFIABLE')
  ),
  coverage_state text not null check (
    coverage_state in ('CURRENT', 'PARTIAL', 'STALE', 'BROKEN', 'BASELINE_ONLY', 'NO_EVIDENCE')
  ),
  conflict_state text not null check (
    conflict_state in ('NONE', 'IDENTITY_CONFLICT', 'CANCELLATION_NOT_EFFECTIVE')
  ),
  prediction_state text not null check (
    prediction_state in (
      'PREDICTED', 'WITHHELD_UNKNOWN_RHYTHM', 'WITHHELD_INSUFFICIENT_EVIDENCE',
      'WITHHELD_COVERAGE_NOT_TRUSTWORTHY', 'WITHHELD_ENDED'
    )
  ),
  cancellation_state text not null default 'NONE' check (
    cancellation_state in (
      'NONE', 'CANCELLATION_INTENT_RECORDED', 'CANCELLATION_CLAIMED', 'WAITING_FOR_EXPECTED_WINDOW',
      'LIKELY_STOPPED_BY_COVERED_ABSENCE', 'CHARGED_AGAIN', 'CANNOT_VERIFY', 'CONFIRMED_BY_SETTLEMENT'
    )
  ),
  last_verified_on date,
  next_verification_due_on date,
  expected_window_start date,
  expected_window_end date,
  belief text not null check (length(btrim(belief)) between 1 and 400),
  because jsonb not null default '[]'::jsonb check (jsonb_typeof(because) = 'array'),
  falsifiability jsonb not null default '[]'::jsonb check (jsonb_typeof(falsifiability) = 'array'),
  cited_evidence_ids uuid[] not null default '{}',
  coverage_source_ids uuid[] not null default '{}',
  evaluated_on date not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, commitment_id),
  foreign key (workspace_id, commitment_id)
    references recovery_commitments(workspace_id, id) on delete cascade,
  constraint recovery_commitment_states_window_order_check
    check (expected_window_start is null or expected_window_end is null or expected_window_start <= expected_window_end),
  constraint recovery_commitment_states_window_pairing_check
    check ((expected_window_start is null) = (expected_window_end is null)),
  constraint recovery_commitment_states_settlement_reserved_check
    check (cancellation_state <> 'CONFIRMED_BY_SETTLEMENT'),
  constraint recovery_commitment_states_prediction_check
    check (prediction_state <> 'PREDICTED' or expected_window_end is not null)
);

create index if not exists recovery_commitment_states_lifecycle_idx
  on recovery_commitment_states(workspace_id, lifecycle_state);
create index if not exists recovery_commitment_states_due_idx
  on recovery_commitment_states(workspace_id, next_verification_due_on)
  where next_verification_due_on is not null;

create table if not exists recovery_cancellation_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  commitment_id uuid not null,
  idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 200),
  event_kind text not null check (
    event_kind in ('INTENT_RECORDED', 'CANCELLATION_CLAIMED', 'WINDOW_OPENED', 'CHARGE_EVALUATED')
  ),
  from_state text not null,
  to_state text not null check (to_state <> 'CONFIRMED_BY_SETTLEMENT'),
  proof text not null check (proof in ('NONE', 'COVERED_ABSENCE')),
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  cited_evidence_ids uuid[] not null default '{}',
  recorded_by_user_id uuid references users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  foreign key (workspace_id, commitment_id)
    references recovery_commitments(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  unique (workspace_id, commitment_id, idempotency_key),
  constraint recovery_cancellation_events_covered_absence_check
    check (proof <> 'COVERED_ABSENCE' or to_state = 'LIKELY_STOPPED_BY_COVERED_ABSENCE')
);

create index if not exists recovery_cancellation_events_commitment_idx
  on recovery_cancellation_events(workspace_id, commitment_id, recorded_at desc);

create or replace function reject_recovery_cancellation_event_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE'
    and not exists (select 1 from workspaces where id = old.workspace_id)
  then
    return old;
  end if;
  raise exception 'Recovery cancellation events are append-only.' using errcode = '55000';
end;
$$;

drop trigger if exists recovery_cancellation_events_append_only_trigger on recovery_cancellation_events;
create trigger recovery_cancellation_events_append_only_trigger
  before update or delete on recovery_cancellation_events
  for each row execute function reject_recovery_cancellation_event_mutation();

create table if not exists recovery_source_health (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_id uuid not null,
  liveness_state text not null check (
    liveness_state in ('CURRENT', 'PARTIAL', 'STALE', 'BROKEN', 'BASELINE_ONLY', 'NO_EVIDENCE')
  ),
  automatic boolean not null,
  consecutive_failure_count integer not null default 0 check (consecutive_failure_count >= 0),
  credential_revoked boolean not null default false,
  last_delivery_at timestamptz,
  assessed_at timestamptz not null default now(),
  primary key (workspace_id, source_id),
  foreign key (workspace_id, source_id)
    references recovery_sources(workspace_id, id) on delete cascade,
  constraint recovery_source_health_automatic_check
    check (automatic or liveness_state in ('BASELINE_ONLY', 'BROKEN', 'NO_EVIDENCE'))
);

create index if not exists recovery_source_health_broken_idx
  on recovery_source_health(workspace_id)
  where liveness_state = 'BROKEN';

create table if not exists recovery_change_signals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  dedupe_key text not null check (length(btrim(dedupe_key)) between 1 and 400),
  kind text not null check (
    kind in (
      'TRIAL_CONVERTING', 'ANNUAL_RENEWAL_APPROACHING', 'PRICE_INCREASE', 'NEW_RECURRING_COMMITMENT',
      'DUPLICATE_SUSPECTED', 'EXPECTED_CHARGE_MISSING', 'CANCELLATION_NOT_EFFECTIVE', 'COVERAGE_BROKEN'
    )
  ),
  state text not null default 'OPEN' check (
    state in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPERSEDED', 'EXPIRED')
  ),
  commitment_id uuid,
  materiality text not null check (materiality in ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  confidence smallint not null check (confidence between 0 and 100),
  title text not null check (length(btrim(title)) between 1 and 200),
  detail text not null check (length(btrim(detail)) between 1 and 600),
  currency char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  delta_minor bigint,
  due_date date,
  citation_kind text not null check (citation_kind in ('EVIDENCE', 'COVERED_ABSENCE', 'SOURCE_HEALTH')),
  cited_evidence_ids uuid[] not null default '{}',
  cited_source_ids uuid[] not null default '{}',
  absence_window_start date,
  absence_window_end date,
  detected_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  superseded_at timestamptz,
  expired_at timestamptz,
  foreign key (workspace_id, commitment_id)
    references recovery_commitments(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  unique (workspace_id, dedupe_key),
  constraint recovery_change_signals_citation_check check (
    (citation_kind = 'EVIDENCE' and cardinality(cited_evidence_ids) >= 1)
    or (
      citation_kind = 'COVERED_ABSENCE'
      and cardinality(cited_source_ids) >= 1
      and absence_window_start is not null
      and absence_window_end is not null
      and absence_window_start <= absence_window_end
    )
    or (citation_kind = 'SOURCE_HEALTH' and cardinality(cited_source_ids) >= 1)
  ),
  constraint recovery_change_signals_money_check
    check ((amount_minor is null and delta_minor is null) or currency is not null),
  constraint recovery_change_signals_scope_check
    check (commitment_id is not null or kind = 'COVERAGE_BROKEN'),
  constraint recovery_change_signals_state_stamp_check check (
    (state <> 'ACKNOWLEDGED' or acknowledged_at is not null)
    and (state = 'RESOLVED') = (resolved_at is not null)
    and (state = 'SUPERSEDED') = (superseded_at is not null)
    and (state = 'EXPIRED') = (expired_at is not null)
  )
);

create index if not exists recovery_change_signals_open_idx
  on recovery_change_signals(workspace_id, materiality, detected_at desc)
  where state in ('OPEN', 'ACKNOWLEDGED');
create index if not exists recovery_change_signals_commitment_idx
  on recovery_change_signals(workspace_id, commitment_id)
  where commitment_id is not null;

create table if not exists recovery_change_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  change_signal_id uuid not null,
  channel text not null check (channel in ('IN_APP', 'EMAIL')),
  delivery_state text not null check (
    delivery_state in (
      'QUEUED', 'SENDING', 'PROVIDER_ACCEPTED', 'DELIVERED', 'FAILED',
      'RETRY_SCHEDULED', 'DEAD_LETTER', 'SUPPRESSED', 'UNSUBSCRIBED'
    )
  ),
  suppression_reason text check (
    suppression_reason in ('ALREADY_NOTIFIED', 'BELOW_MATERIALITY', 'NO_CONSENT', 'UNSUBSCRIBED', 'CHANNEL_NOT_READY')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  provider_message_id text,
  provider_accepted_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  error_code text check (error_code is null or length(btrim(error_code)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, change_signal_id)
    references recovery_change_signals(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  unique (workspace_id, change_signal_id, channel),
  constraint recovery_change_notifications_delivery_proof_check
    check (delivery_state <> 'DELIVERED' or (provider_message_id is not null and delivered_at is not null)),
  constraint recovery_change_notifications_suppression_check
    check ((delivery_state = 'SUPPRESSED') = (suppression_reason is not null)),
  constraint recovery_change_notifications_retry_check
    check ((delivery_state = 'RETRY_SCHEDULED') = (next_attempt_at is not null)),
  constraint recovery_change_notifications_accepted_check
    check (delivery_state not in ('PROVIDER_ACCEPTED', 'DELIVERED') or provider_accepted_at is not null)
);

create index if not exists recovery_change_notifications_due_idx
  on recovery_change_notifications(workspace_id, next_attempt_at)
  where delivery_state = 'RETRY_SCHEDULED';

create table if not exists recovery_notification_preferences (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  product_emails boolean not null default false,
  minimum_materiality text not null default 'HIGH' check (
    minimum_materiality in ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')
  ),
  digest_interval_hours smallint not null default 24 check (digest_interval_hours between 1 and 168),
  digest_last_sent_at timestamptz,
  unsubscribed_at timestamptz,
  unsubscribe_token_hash char(64),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  constraint recovery_notification_preferences_unsubscribe_check
    check (unsubscribed_at is null or product_emails = false)
);

create or replace function recovery_features_are_structural(features jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(features) = 'object'
    and not exists (
      select 1
      from jsonb_each(features) as entry(feature_key, feature_value)
      where jsonb_typeof(entry.feature_value) not in ('string', 'number', 'boolean')
        or (
          jsonb_typeof(entry.feature_value) = 'string'
          and (
            length(entry.feature_value #>> '{}') > 60
            or entry.feature_value #>> '{}' like '%@%'
            or entry.feature_value #>> '{}' like '% %'
          )
        )
    );
$$;

create table if not exists recovery_correction_outcomes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null check (
    kind in (
      'MERCHANT_CORRECTED', 'MERCHANT_ALIAS_ADDED', 'CADENCE_CORRECTED', 'AMOUNT_CORRECTED',
      'DUPLICATE_MERGE_ACCEPTED', 'DUPLICATE_MERGE_REJECTED', 'LIFECYCLE_CORRECTED',
      'CANCELLATION_OUTCOME_RECORDED'
    )
  ),
  label text not null check (label in ('ACCEPTED', 'REJECTED', 'CHANGED')),
  feature_version text not null check (length(btrim(feature_version)) between 1 and 60),
  features jsonb not null check (recovery_features_are_structural(features)),
  cited_evidence_ids uuid[] not null default '{}',
  commitment_id uuid,
  correction_id uuid,
  idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 200),
  observed_at timestamptz not null default now(),
  foreign key (workspace_id, commitment_id)
    references recovery_commitments(workspace_id, id) on delete cascade,
  foreign key (workspace_id, correction_id)
    references recovery_corrections(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  unique (workspace_id, kind, idempotency_key)
);

create index if not exists recovery_correction_outcomes_kind_idx
  on recovery_correction_outcomes(workspace_id, kind, observed_at desc);

create or replace function reject_recovery_correction_outcome_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE'
    and not exists (select 1 from workspaces where id = old.workspace_id)
  then
    return old;
  end if;
  raise exception 'Recovery correction outcomes are append-only.' using errcode = '55000';
end;
$$;

drop trigger if exists recovery_correction_outcomes_append_only_trigger on recovery_correction_outcomes;
create trigger recovery_correction_outcomes_append_only_trigger
  before update or delete on recovery_correction_outcomes
  for each row execute function reject_recovery_correction_outcome_mutation();
