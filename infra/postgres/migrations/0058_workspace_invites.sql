-- Workspace invites for a two-human Commitment Control desk.
-- Additive only. Does not merge money across workspaces, invent seats, or
-- create Slack/SAML. Owner is never an inviteable role.

create table if not exists workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254),
  role text not null check (role in ('admin', 'member')),
  token_hash text not null unique,
  invited_by_user_id uuid references users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_user_id uuid references users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (accepted_at is null or revoked_at is null),
  check (accepted_at is null or accepted_by_user_id is not null)
);

create unique index if not exists workspace_invites_open_email_idx
  on workspace_invites (workspace_id, email)
  where accepted_at is null and revoked_at is null;

create index if not exists workspace_invites_email_open_idx
  on workspace_invites (email, expires_at)
  where accepted_at is null and revoked_at is null;
