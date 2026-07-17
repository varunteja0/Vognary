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
