-- Lock fee, billing-year, and first-value activation rows against direct
-- deletion while the workspace still exists. Additive only. Do not rewrite
-- 0031-0043. Whole-workspace privacy erasure still cascades/set-nulls.

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
