-- Serialize fee finalization with covered-window inserts so a finalized period
-- cannot gain new facts after its input hash is recorded. Whole-workspace
-- privacy erasure still cascades after the workspace row is gone.

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