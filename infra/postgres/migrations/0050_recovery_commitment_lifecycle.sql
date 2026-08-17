-- The living commitment state.
--
-- One row per commitment describing what we currently believe, why, when it was
-- last verified, what we expect next, and what would prove it wrong. This is
-- additive: recovery_commitments and its corrections remain the authority on
-- money, merchant and cadence, and nothing here writes those facts.
--
-- The database enforces the one reservation that matters: a cancellation may
-- never be recorded as settled, because settlement requires a regulated money
-- feed this product does not have.
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
  -- Settlement proof needs a regulated money feed. Until one exists, this state
  -- is unreachable by construction rather than by convention.
  constraint recovery_commitment_states_settlement_reserved_check
    check (cancellation_state <> 'CONFIRMED_BY_SETTLEMENT'),
  -- A withheld prediction must not also publish an expected window.
  constraint recovery_commitment_states_prediction_check
    check (prediction_state <> 'PREDICTED' or expected_window_end is not null)
);

create index if not exists recovery_commitment_states_lifecycle_idx
  on recovery_commitment_states(workspace_id, lifecycle_state);
create index if not exists recovery_commitment_states_due_idx
  on recovery_commitment_states(workspace_id, next_verification_due_on)
  where next_verification_due_on is not null;

-- Every cancellation transition, append-only, so the outcome can be audited.
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
  -- 'SETTLEMENT' is deliberately absent: no email-derived event may claim it.
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

-- Per-source liveness. Coverage is a property of each source, so a healthy feed
-- can never vouch for a merchant that only a dead feed would have carried.
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
  -- A one-off import is never live, and a live feed is never a mere baseline.
  constraint recovery_source_health_automatic_check
    check (automatic or liveness_state in ('BASELINE_ONLY', 'BROKEN', 'NO_EVIDENCE'))
);

create index if not exists recovery_source_health_broken_idx
  on recovery_source_health(workspace_id)
  where liveness_state = 'BROKEN';
