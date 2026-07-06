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

create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

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