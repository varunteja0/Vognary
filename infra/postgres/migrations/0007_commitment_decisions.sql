create table if not exists commitment_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  recurring_item_id uuid not null references recurring_items(id) on delete cascade,
  decided_by_user_id uuid references users(id) on delete set null,
  action text not null check (action in ('keep', 'watch', 'downgrade', 'cancel', 'investigate')),
  decided_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, recurring_item_id)
);

create index if not exists commitment_decisions_workspace_updated_idx
  on commitment_decisions(workspace_id, updated_at desc);
