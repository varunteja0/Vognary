alter table data_sources
  add column if not exists external_reference text;

create unique index if not exists data_sources_workspace_state_external_idx
  on data_sources(workspace_id, external_reference)
  where external_reference like 'workspace-state:%';

create unique index if not exists transactions_workspace_state_external_idx
  on transactions(workspace_id, source_id, external_reference)
  where external_reference like 'workspace-state:%';

create unique index if not exists recurring_items_workspace_state_external_idx
  on recurring_items(workspace_id, external_reference)
  where external_reference like 'workspace-state:%';

create unique index if not exists evidence_links_workspace_state_external_idx
  on evidence_links(recurring_item_id, external_reference)
  where external_reference like 'workspace-state:%';