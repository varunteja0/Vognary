-- Autopilot integrity: measured shadow-gate snapshots, retry-safe execution
-- attempts, authoritative fee-period non-overlap, notice delivery events, and
-- immutable invoice inputs. Additive only.

create extension if not exists btree_gist;

alter table recovery_fee_ledger
  add column if not exists inputs_hash char(64);
alter table recovery_fee_ledger
  add column if not exists year_start date;
alter table recovery_fee_ledger
  add column if not exists finalized_at timestamptz;

update recovery_fee_ledger
  set inputs_hash = coalesce(inputs_hash, repeat('0', 64)),
      year_start = coalesce(year_start, date_trunc('year', period_start)::date),
      finalized_at = coalesce(finalized_at, created_at);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'recovery_fee_ledger' and column_name = 'inputs_hash' and is_nullable = 'YES'
  ) then
    alter table recovery_fee_ledger alter column inputs_hash set not null;
    alter table recovery_fee_ledger alter column year_start set not null;
    alter table recovery_fee_ledger alter column finalized_at set not null;
  end if;
end $$;

alter table recovery_fee_ledger
  drop constraint if exists recovery_fee_ledger_inputs_hash_check;
alter table recovery_fee_ledger
  add constraint recovery_fee_ledger_inputs_hash_check
  check (inputs_hash ~ '^[0-9a-f]{64}$');

alter table recovery_fee_ledger
  drop constraint if exists recovery_fee_ledger_period_order;
alter table recovery_fee_ledger
  add constraint recovery_fee_ledger_period_order
  check (period_start <= period_end);

alter table recovery_fee_ledger
  drop constraint if exists recovery_fee_ledger_no_overlap;
alter table recovery_fee_ledger
  add constraint recovery_fee_ledger_no_overlap
  exclude using gist (
    workspace_id with =,
    currency with =,
    daterange(period_start, period_end, '[]') with &&
  );

create or replace function recovery_fee_ledger_reject_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and (
    new.monitoring_minor is distinct from old.monitoring_minor
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
  ) then
    raise exception 'Finalized fee ledger rows cannot be mutated.';
  end if;
  return new;
end;
$$;

drop trigger if exists recovery_fee_ledger_immutable on recovery_fee_ledger;
create trigger recovery_fee_ledger_immutable
  before update on recovery_fee_ledger
  for each row execute function recovery_fee_ledger_reject_mutation();

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

alter table recovery_executions
  add column if not exists attempt_id uuid;
alter table recovery_executions
  add column if not exists attempt_no integer;
alter table recovery_executions
  add column if not exists operation_key text;

update recovery_executions
  set attempt_no = coalesce(attempt_no, 1);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'recovery_executions' and column_name = 'attempt_no' and is_nullable = 'YES'
  ) then
    alter table recovery_executions alter column attempt_no set not null;
  end if;
end $$;

alter table recovery_executions
  drop constraint if exists recovery_executions_workspace_id_candidate_id_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'recovery_executions_attempt_key'
  ) then
    alter table recovery_executions
      add constraint recovery_executions_attempt_key
      unique (workspace_id, candidate_id, attempt_no);
  end if;
end $$;

create unique index if not exists recovery_executions_one_success_idx
  on recovery_executions (workspace_id, candidate_id)
  where outcome = 'EXECUTED';

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
    'email.sent', 'email.delivered', 'email.delayed', 'email.bounced', 'email.failed', 'email.complained'
  )),
  provider_message_id text,
  occurred_at timestamptz not null,
  payload_hash char(64) not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (provider_event_id),
  foreign key (workspace_id, candidate_id)
    references recovery_action_candidates(workspace_id, id) on delete cascade
);

alter table recovery_veto_notices
  drop constraint if exists recovery_veto_notices_delivery_status_check;
alter table recovery_veto_notices
  add constraint recovery_veto_notices_delivery_status_check
  check (delivery_status in ('QUEUED', 'ACCEPTED', 'DELIVERED', 'DELAYED', 'BOUNCED', 'FAILED', 'COMPLAINED'));

alter table recovery_veto_notices
  add column if not exists provider_timestamp timestamptz;
alter table recovery_veto_notices
  add column if not exists veto_token_hash char(64);

alter table recovery_action_candidates
  add column if not exists next_debit_date date;
alter table recovery_action_candidates
  add column if not exists next_debit_inputs_hash char(64);
alter table recovery_action_candidates
  add column if not exists next_debit_reason text;

alter table recovery_classification_snapshots
  add column if not exists cited_merchant text;
alter table recovery_covered_windows
  add column if not exists inputs_hash char(64);
alter table recovery_covered_windows
  add column if not exists commitment_id uuid;

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

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'recovery_autopilot_dead_letters' and c.contype = 'f'
  ) then
    alter table recovery_autopilot_dead_letters
      add constraint recovery_autopilot_dead_letters_workspace_fk
      foreign key (workspace_id) references workspaces(id) on delete cascade;
  end if;
exception
  when duplicate_object then null;
end $$;

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
  'source.connected'
));

alter table recovery_covered_windows
  drop constraint if exists recovery_covered_windows_source_fk;
alter table recovery_covered_windows
  add constraint recovery_covered_windows_source_fk
  foreign key (workspace_id, coverage_source_id)
  references recovery_sources(workspace_id, id)
  on delete cascade;

create unique index if not exists recovery_veto_notices_provider_message_id_idx
  on recovery_veto_notices (provider_message_id)
  where provider_message_id is not null;
