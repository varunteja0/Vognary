create table if not exists auth_sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  workspace_id uuid references workspaces(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists auth_sessions_user_active_idx
  on auth_sessions(user_id, expires_at)
  where revoked_at is null;
