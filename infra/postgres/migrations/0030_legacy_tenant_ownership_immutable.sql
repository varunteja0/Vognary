-- Frozen legacy tables keep their original workspace_id.
-- Existing cross-workspace rows are left untouched and must still block
-- Recovery cutover. Do not rewrite workspace_id to guess ownership.

create or replace function reject_legacy_workspace_reassignment()
returns trigger
language plpgsql
as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'Legacy workspace ownership is immutable.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists data_sources_workspace_immutable on data_sources;
create trigger data_sources_workspace_immutable
  before update of workspace_id on data_sources
  for each row execute function reject_legacy_workspace_reassignment();

drop trigger if exists recurring_items_workspace_immutable on recurring_items;
create trigger recurring_items_workspace_immutable
  before update of workspace_id on recurring_items
  for each row execute function reject_legacy_workspace_reassignment();
