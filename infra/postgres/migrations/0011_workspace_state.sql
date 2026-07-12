create table if not exists workspace_states (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  encrypted_snapshot jsonb not null,
  summary jsonb not null default '{}'::jsonb,
  revision bigint not null default 1 check (revision > 0),
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_states_updated_idx
  on workspace_states(updated_at desc);