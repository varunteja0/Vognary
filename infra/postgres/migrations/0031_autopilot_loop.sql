-- Autopilot loop: standing mandate, shadow candidates, notice, execution,
-- covered windows, and fee ledger. Execution remains fail-closed in application
-- code until founder-controlled switches and the shadow gate pass.

alter table recovery_workspace_versions
  drop constraint if exists recovery_workspace_versions_mutation_kind_check;

alter table recovery_workspace_versions
  add constraint recovery_workspace_versions_mutation_kind_check
  check (mutation_kind in (
    'EVIDENCE', 'CORRECTION', 'CORRECTION_REVERSAL', 'DECISION', 'MANDATE', 'CANDIDATE'
  ));

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
  delivery_status text not null check (delivery_status in ('QUEUED', 'DELIVERED', 'FAILED')),
  delivered_at timestamptz,
  provider_message_id text,
  created_at timestamptz not null default now(),
  unique (workspace_id, candidate_id),
  foreign key (workspace_id, candidate_id)
    references recovery_action_candidates(workspace_id, id) on delete cascade,
  check (delivery_status <> 'DELIVERED' or delivered_at is not null)
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
  created_at timestamptz not null default now(),
  unique (workspace_id, candidate_id),
  foreign key (workspace_id, candidate_id)
    references recovery_action_candidates(workspace_id, id) on delete cascade,
  check (outcome <> 'EXECUTED' or (proof_kind is not null and proof_reference is not null))
);

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
  coverage_source_id uuid not null,
  window_start date not null,
  window_end date not null,
  expected_debit_date date not null,
  baseline_debit_minor bigint not null check (baseline_debit_minor >= 0),
  observed_debit_minor bigint check (observed_debit_minor is null or observed_debit_minor >= 0),
  saving_minor bigint check (saving_minor is null or saving_minor >= 0),
  status text not null check (status in ('PENDING', 'COVERED_CLEAN', 'NOT_ELIMINATED', 'MISSING_COVERAGE')),
  created_at timestamptz not null default now(),
  unique (workspace_id, candidate_id, expected_debit_date),
  foreign key (workspace_id, candidate_id)
    references recovery_action_candidates(workspace_id, id) on delete cascade,
  check (status in ('PENDING', 'MISSING_COVERAGE') or saving_minor is not null),
  check (window_start <= window_end)
);

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
  created_at timestamptz not null default now(),
  unique (workspace_id, period_start, period_end)
);

create table if not exists recovery_provider_disables (
  provider_id text primary key check (length(btrim(provider_id)) between 2 and 80),
  disabled boolean not null default true,
  reason text not null check (length(btrim(reason)) between 3 and 240),
  updated_at timestamptz not null default now()
);

alter table product_events drop constraint if exists product_events_event_name_check;
alter table product_events add constraint product_events_event_name_check check (event_name in (
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
  'notice.delivered',
  'execution.completed',
  'exception.opened',
  'window.verified'
));
