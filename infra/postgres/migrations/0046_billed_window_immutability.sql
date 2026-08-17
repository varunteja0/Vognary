-- Finalized fee rows freeze the covered-window facts they bill.
-- Whole-workspace privacy erasure still cascades after the workspace row is gone.

create or replace function recovery_covered_windows_constrain_billed_mutation()
returns trigger
language plpgsql
as $$
declare
  billed boolean := false;
begin
  if exists (select 1 from workspaces where id = old.workspace_id) then
    select exists (
      select 1
      from recovery_fee_ledger fee
      where fee.workspace_id = old.workspace_id
        and fee.currency = old.currency
        and old.expected_debit_date between fee.period_start and fee.period_end
    ) into billed;
  end if;

  if billed then
    raise exception 'Billed covered windows cannot be mutated.';
  end if;

  if tg_op = 'UPDATE'
    and exists (select 1 from workspaces where id = new.workspace_id)
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

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists recovery_covered_windows_billed_immutable on recovery_covered_windows;
create trigger recovery_covered_windows_billed_immutable
  before update or delete on recovery_covered_windows
  for each row execute function recovery_covered_windows_constrain_billed_mutation();
