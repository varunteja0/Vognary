-- Restore 0023 evidence immutability, insert-once cohort facts, and source
-- disconnection without deleting financial evidence. Additive only. Do not rewrite 0036.

create or replace function reject_recovery_evidence_mutation()
returns trigger
language plpgsql
as $$
begin
  -- A whole-workspace privacy deletion is the only destructive path. The
  -- parent row has already gone by the time its cascading delete reaches the
  -- evidence table; every direct update/delete remains forbidden.
  if tg_op = 'DELETE'
    and not exists (select 1 from workspaces where id = old.workspace_id)
  then
    return old;
  end if;
  raise exception 'Recovery evidence is immutable.' using errcode = '55000';
end;
$$;

create or replace function reject_recovery_cohort_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE'
    and not exists (select 1 from workspaces where id = old.workspace_id)
  then
    return old;
  end if;
  raise exception 'Connected-mandate cohort is immutable.' using errcode = '55000';
end;
$$;

drop trigger if exists recovery_cohort_immutable_trigger on recovery_connected_mandate_cohort;
create trigger recovery_cohort_immutable_trigger
  before update or delete on recovery_connected_mandate_cohort
  for each row execute function reject_recovery_cohort_mutation();

create table if not exists recovery_source_disconnections (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_id uuid not null,
  disconnected_at timestamptz not null default now(),
  primary key (workspace_id, source_id),
  foreign key (workspace_id, source_id)
    references recovery_sources(workspace_id, id) on delete cascade
);
