create table if not exists platform_api_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  token_prefix text not null,
  token_hash text not null unique,
  scopes text[] not null,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (scopes <@ array['ledger:read', 'sources:read']::text[]),
  check (cardinality(scopes) > 0)
);

create index if not exists platform_api_tokens_workspace_created_idx
  on platform_api_tokens(workspace_id, created_at desc);

create index if not exists platform_api_tokens_active_hash_idx
  on platform_api_tokens(token_hash)
  where revoked_at is null;
