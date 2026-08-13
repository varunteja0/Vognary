-- Tenant integrity for legacy ledger relations.
-- Existing cross-workspace rows are left untouched and must block Recovery
-- cutover. New writes fail closed. Do not rewrite workspace_id to guess ownership.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'data_sources'::regclass
      and conname = 'data_sources_workspace_id_id_key'
  ) then
    alter table data_sources
      add constraint data_sources_workspace_id_id_key unique (workspace_id, id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'recurring_items'::regclass
      and conname = 'recurring_items_workspace_id_id_key'
  ) then
    alter table recurring_items
      add constraint recurring_items_workspace_id_id_key unique (workspace_id, id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'commitment_decisions'::regclass
      and conname = 'commitment_decisions_workspace_recurring_item_fkey'
  ) then
    alter table commitment_decisions
      add constraint commitment_decisions_workspace_recurring_item_fkey
      foreign key (workspace_id, recurring_item_id)
      references recurring_items(workspace_id, id)
      not valid;
  end if;
end
$$;

create or replace function reject_cross_workspace_evidence_link()
returns trigger
language plpgsql
as $$
declare
  item_workspace uuid;
  source_workspace uuid;
begin
  if new.source_id is null then
    return new;
  end if;
  select workspace_id into item_workspace from recurring_items where id = new.recurring_item_id;
  select workspace_id into source_workspace from data_sources where id = new.source_id;
  if item_workspace is null or source_workspace is null or source_workspace <> item_workspace then
    raise exception 'Evidence source workspace must match the recurring item workspace.' using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists evidence_links_tenant_workspace_guard on evidence_links;
create trigger evidence_links_tenant_workspace_guard
  before insert or update of recurring_item_id, source_id on evidence_links
  for each row execute function reject_cross_workspace_evidence_link();
