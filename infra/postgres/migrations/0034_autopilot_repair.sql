-- Autopilot repair: upgrade-path fee default, immutable year grouping,
-- Resend delivery_delayed events, and a persisted 12-month billing-year anchor.
-- Additive only. Do not rewrite 0033.

alter table recovery_fee_ledger
  alter column finalized_at set default now();

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
  before update on recovery_fee_ledger
  for each row execute function recovery_fee_ledger_reject_mutation();

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.recovery_notice_delivery_events'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%event_type%'
  loop
    execute format('alter table recovery_notice_delivery_events drop constraint %I', constraint_name);
  end loop;
end $$;
alter table recovery_notice_delivery_events
  add constraint recovery_notice_delivery_events_event_type_check
  check (event_type in (
    'email.sent', 'email.delivered', 'email.delayed', 'email.delivery_delayed',
    'email.bounced', 'email.failed', 'email.complained'
  ));

create table if not exists recovery_billing_year_anchors (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  anchor_date date not null,
  created_at timestamptz not null default now()
);

insert into recovery_billing_year_anchors (workspace_id, anchor_date)
select workspace_id, min(signed_at)::date
from recovery_standing_mandates
group by workspace_id
on conflict (workspace_id) do nothing;

create or replace function recovery_billing_year_anchors_reject_mutation()
returns trigger
language plpgsql
as $$
begin
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
  before update on recovery_billing_year_anchors
  for each row execute function recovery_billing_year_anchors_reject_mutation();
