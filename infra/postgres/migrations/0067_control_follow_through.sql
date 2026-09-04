-- Commitment Control follow-through: an evidence-independent human outcome
-- observation, and an append-only human disposition for an adverse record.
--
-- Additive only. Nothing here observes, decides, matches a merchant, selects a
-- receipt, or moves money. Every row is a value a person typed or a judgement a
-- person made, recorded once and never edited.
--
-- Reverting this migration is:
--   drop trigger commitment_control_reconciliations_single_outcome
--     on commitment_control_reconciliations;
--   drop table commitment_control_exception_reviews;
--   drop table commitment_control_outcome_observations;
--   drop function commitment_control_assert_exception_target();
--   drop function commitment_control_assert_single_actual_outcome();
-- then re-apply the 0057 bodies of commitment_control_reject_mutation(),
-- product_events_event_name_check, and
-- recovery_workspace_versions_mutation_kind_check. There is no backfill and no
-- dependant, so that sequence restores the exact 0066 shape.

alter table recovery_workspace_versions
  drop constraint if exists recovery_workspace_versions_mutation_kind_check;
alter table recovery_workspace_versions
  add constraint recovery_workspace_versions_mutation_kind_check check (mutation_kind in (
    'EVIDENCE',
    'CORRECTION',
    'CORRECTION_REVERSAL',
    'DECISION',
    'MANDATE',
    'CANDIDATE',
    'CONTROL_POLICY',
    'CONTROL_PROPOSAL',
    'CONTROL_DECISION',
    'CONTROL_RECONCILIATION',
    'CONTROL_OUTCOME_OBSERVATION',
    'CONTROL_EXCEPTION_REVIEW'
  ));

-- The observed value stands alone: a business outcome is not proven by a
-- receipt, so this record deliberately cites no evidence row. The frozen target
-- is copied in full so the verdict stays readable against the boundary that
-- existed when the proposal was authorized.
create table if not exists commitment_control_outcome_observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  proposal_id uuid not null,
  decision_id uuid not null,
  observed_value text not null
    check (observed_value ~ '^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$'),
  observed_on date not null,
  target_metric text not null check (length(btrim(target_metric)) between 1 and 120),
  target_direction text not null check (target_direction in ('AT_LEAST', 'AT_MOST')),
  target_value text not null
    check (target_value ~ '^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$'),
  target_unit text not null check (length(btrim(target_unit)) between 1 and 40),
  target_review_on date not null,
  verdict text not null check (verdict in ('MET', 'MISSED')),
  observation_basis text not null default 'USER_ENTERED_OBSERVATION'
    check (observation_basis = 'USER_ENTERED_OBSERVATION'),
  observed_by_user_id uuid references users(id) on delete set null,
  observed_at timestamptz not null default now(),
  unique (workspace_id, id),
  constraint cc_outcome_observations_proposal_key unique (workspace_id, proposal_id),
  foreign key (workspace_id, proposal_id)
    references commitment_control_proposals(workspace_id, id) on delete cascade,
  foreign key (workspace_id, decision_id)
    references commitment_control_decisions(workspace_id, id) on delete restrict,
  constraint cc_outcome_observations_review_window_check
    check (observed_on >= target_review_on),
  constraint cc_outcome_observations_verdict_check check (
    (target_direction = 'AT_LEAST'
      and verdict = (case when observed_value::numeric >= target_value::numeric then 'MET' else 'MISSED' end))
    or (target_direction = 'AT_MOST'
      and verdict = (case when observed_value::numeric <= target_value::numeric then 'MET' else 'MISSED' end))
  )
);

-- One human disposition per adverse record. The note is required because the
-- product records what a person concluded, not that a row was acknowledged.
create table if not exists commitment_control_exception_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  proposal_id uuid not null,
  decision_id uuid not null,
  reconciliation_id uuid,
  outcome_observation_id uuid,
  disposition text not null check (disposition in (
    'NO_FURTHER_ACTION', 'NEW_PROPOSAL_REQUIRED', 'CORRECTED_OUTSIDE_VOGNARY'
  )),
  note text not null check (length(btrim(note)) between 1 and 500),
  reviewed_by_user_id uuid references users(id) on delete set null,
  reviewed_at timestamptz not null default now(),
  unique (workspace_id, id),
  constraint cc_exception_reviews_target_check
    check (num_nonnulls(reconciliation_id, outcome_observation_id) = 1),
  constraint cc_exception_reviews_reconciliation_key unique (workspace_id, reconciliation_id),
  constraint cc_exception_reviews_observation_key unique (workspace_id, outcome_observation_id),
  foreign key (workspace_id, proposal_id)
    references commitment_control_proposals(workspace_id, id) on delete cascade,
  foreign key (workspace_id, decision_id)
    references commitment_control_decisions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, reconciliation_id)
    references commitment_control_reconciliations(workspace_id, id) on delete cascade,
  foreign key (workspace_id, outcome_observation_id)
    references commitment_control_outcome_observations(workspace_id, id) on delete cascade
);

create index if not exists cc_exception_reviews_proposal_idx
  on commitment_control_exception_reviews(workspace_id, proposal_id, reviewed_at desc, id);

-- A proposal holds at most one observed outcome in total, whichever table it
-- landed in. NOT_OBSERVED is the absence of an observation and never blocks one.
create or replace function commitment_control_assert_single_actual_outcome()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'commitment_control_outcome_observations' then
    if exists (
      select 1 from commitment_control_reconciliations reconciliation
      where reconciliation.workspace_id = new.workspace_id
        and reconciliation.proposal_id = new.proposal_id
        and reconciliation.outcome_verdict in ('MET', 'MISSED')
    ) then
      raise exception 'This proposal already records an observed outcome on a reconciliation.'
        using errcode = '23505';
    end if;
    return new;
  end if;

  if new.outcome_verdict in ('MET', 'MISSED') and exists (
    select 1 from commitment_control_outcome_observations observation
    where observation.workspace_id = new.workspace_id
      and observation.proposal_id = new.proposal_id
  ) then
    raise exception 'This proposal already records a standalone observed outcome.'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists commitment_control_outcome_observations_single_outcome
  on commitment_control_outcome_observations;
create trigger commitment_control_outcome_observations_single_outcome
  before insert on commitment_control_outcome_observations
  for each row execute function commitment_control_assert_single_actual_outcome();

drop trigger if exists commitment_control_reconciliations_single_outcome
  on commitment_control_reconciliations;
create trigger commitment_control_reconciliations_single_outcome
  before insert on commitment_control_reconciliations
  for each row execute function commitment_control_assert_single_actual_outcome();

-- A review exists only where something actually went wrong, and only against a
-- record that belongs to the same authorized proposal decision.
create or replace function commitment_control_assert_exception_target()
returns trigger
language plpgsql
as $$
declare
  adverse boolean;
begin
  if new.reconciliation_id is not null then
    select reconciliation.verdict in ('OVER_CAP', 'CURRENCY_MISMATCH', 'CANNOT_EVALUATE', 'AUTHORIZATION_EXPIRED')
        or coalesce(reconciliation.outcome_verdict, '') = 'MISSED'
      into adverse
    from commitment_control_reconciliations reconciliation
    where reconciliation.workspace_id = new.workspace_id
      and reconciliation.id = new.reconciliation_id
      and reconciliation.proposal_id = new.proposal_id
      and reconciliation.decision_id = new.decision_id;
  else
    select observation.verdict = 'MISSED'
      into adverse
    from commitment_control_outcome_observations observation
    where observation.workspace_id = new.workspace_id
      and observation.id = new.outcome_observation_id
      and observation.proposal_id = new.proposal_id
      and observation.decision_id = new.decision_id;
  end if;

  if adverse is null then
    raise exception 'An exception review target must be an existing record on the same authorized proposal decision.'
      using errcode = '23503';
  end if;
  if not adverse then
    raise exception 'Only an adverse Commitment Control record can be reviewed.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists commitment_control_exception_reviews_adverse_target
  on commitment_control_exception_reviews;
create trigger commitment_control_exception_reviews_adverse_target
  before insert on commitment_control_exception_reviews
  for each row execute function commitment_control_assert_exception_target();

-- Extends the 0057 immutability function with the two new actor columns so an
-- erased user is still forgotten without any other field becoming editable.
create or replace function commitment_control_reject_mutation()
returns trigger
language plpgsql
as $$
declare
  actor_column text;
  old_actor text;
  new_actor text;
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from workspaces where id = old.workspace_id) then
      raise exception '% cannot be deleted while the workspace exists.', tg_table_name using errcode = '55000';
    end if;
    return old;
  end if;

  actor_column := case tg_table_name
    when 'commitment_control_policies' then 'created_by_user_id'
    when 'commitment_control_proposals' then 'submitted_by_user_id'
    when 'commitment_control_decisions' then 'decided_by_user_id'
    when 'commitment_control_reconciliations' then 'reconciled_by_user_id'
    when 'commitment_control_outcome_observations' then 'observed_by_user_id'
    when 'commitment_control_exception_reviews' then 'reviewed_by_user_id'
    else null
  end;
  old_actor := case when actor_column is null then null else to_jsonb(old) ->> actor_column end;
  new_actor := case when actor_column is null then null else to_jsonb(new) ->> actor_column end;

  if actor_column is not null
    and old_actor is not null
    and new_actor is null
    and (to_jsonb(new) - actor_column) = (to_jsonb(old) - actor_column)
    and not exists (select 1 from users where id = old_actor::uuid)
  then
    return new;
  end if;
  raise exception '% cannot be updated.', tg_table_name using errcode = '55000';
end;
$$;

drop trigger if exists commitment_control_outcome_observations_immutable
  on commitment_control_outcome_observations;
create trigger commitment_control_outcome_observations_immutable
  before update or delete on commitment_control_outcome_observations
  for each row execute function commitment_control_reject_mutation();

drop trigger if exists commitment_control_exception_reviews_immutable
  on commitment_control_exception_reviews;
create trigger commitment_control_exception_reviews_immutable
  before update or delete on commitment_control_exception_reviews
  for each row execute function commitment_control_reject_mutation();

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
  'source.connected',
  'receipt_setup.started',
  'receipt_setup.completed',
  'receipt_forwarding.verified',
  'receipt_backfill.completed',
  'commitments.detected',
  'correction.recorded',
  'source.health_observed',
  'workspace.returned',
  'control.policy_recorded',
  'control.proposal_submitted',
  'control.decision_recorded',
  'control.reconciliation_recorded',
  'control.outcome_recorded',
  'control.exception_reviewed'
));
