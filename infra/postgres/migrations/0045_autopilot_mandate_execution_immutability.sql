-- Tamper-evident standing mandates, append-only Autopilot audit facts,
-- constrained execution-attempt transitions, and frozen fee charge status.
-- Additive only. Do not rewrite 0031-0044. Whole-workspace privacy erasure
-- still cascades after the workspace row is gone.

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

create or replace function recovery_fee_ledger_reject_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from workspaces where id = old.workspace_id) then
      raise exception 'Finalized fee ledger rows cannot be deleted directly.';
    end if;
    return old;
  end if;
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
    or new.year_start is distinct from old.year_start
    or new.finalized_at is distinct from old.finalized_at
    or new.razorpay_charge_status is distinct from old.razorpay_charge_status
  ) then
    raise exception 'Finalized fee ledger rows cannot be mutated.';
  end if;
  return new;
end;
$$;

drop trigger if exists recovery_fee_ledger_immutable on recovery_fee_ledger;
create trigger recovery_fee_ledger_immutable
  before update or delete on recovery_fee_ledger
  for each row execute function recovery_fee_ledger_reject_mutation();
