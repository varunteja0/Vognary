-- Bind covered windows to Recovery sources and currency. Fee periods are
-- unique per workspace+currency and must not overlap.

alter table recovery_covered_windows
  add column if not exists currency char(3);

update recovery_covered_windows
  set currency = 'INR'
  where currency is null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'recovery_covered_windows'
      and column_name = 'currency'
      and is_nullable = 'YES'
  ) then
    alter table recovery_covered_windows
      alter column currency set not null;
  end if;
end $$;

alter table recovery_covered_windows
  drop constraint if exists recovery_covered_windows_currency_check;
alter table recovery_covered_windows
  add constraint recovery_covered_windows_currency_check
  check (currency ~ '^[A-Z]{3}$');

alter table recovery_covered_windows
  alter column coverage_source_id drop not null;

alter table recovery_covered_windows
  drop constraint if exists recovery_covered_windows_source_fk;
alter table recovery_covered_windows
  add constraint recovery_covered_windows_source_fk
  foreign key (workspace_id, coverage_source_id)
  references recovery_sources(workspace_id, id)
  on delete restrict;

alter table recovery_fee_ledger
  drop constraint if exists recovery_fee_ledger_workspace_id_period_start_period_end_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'recovery_fee_ledger_workspace_currency_period_key'
  ) then
    alter table recovery_fee_ledger
      add constraint recovery_fee_ledger_workspace_currency_period_key
      unique (workspace_id, currency, period_start, period_end);
  end if;
end $$;
