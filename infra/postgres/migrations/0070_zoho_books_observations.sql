create table zoho_books_connections (
  id uuid primary key,
  workspace_id uuid not null unique references workspaces(id) on delete cascade,
  authorized_by_user_id uuid not null references users(id),
  revision bigint not null default 1 check (revision > 0),
  generation bigint not null default 1 check (generation > 0),
  status text not null check (status in ('AUTHORIZING','AWAITING_ORGANIZATION','QUEUED','SYNCING','READY','RETRY_WAIT','REAUTH_REQUIRED','FAILED','REVOKED')),
  oauth_state_hash text,
  oauth_expires_at timestamptz,
  access_secret jsonb,
  refresh_secret jsonb,
  access_expires_at timestamptz,
  organizations jsonb not null default '[]'::jsonb,
  organization_id text,
  organization_name text,
  organization_currency text,
  coverage_start date not null,
  scan_id uuid,
  scan_page integer not null default 1 check (scan_page > 0),
  scan_phase text not null default 'FETCH' check (scan_phase in ('FETCH','VERIFY')),
  scan_kind text not null default 'INITIAL' check (scan_kind in ('INITIAL','FULL','INCREMENTAL')),
  scan_started_at timestamptz,
  scan_since timestamptz,
  last_success_at timestamptz,
  last_full_at timestamptz,
  next_run_at timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0),
  last_error_code text,
  lease_token uuid,
  lease_until timestamptz,
  reviewed_through bigint not null default 0 check (reviewed_through >= 0),
  provider_revocation text check (provider_revocation in ('CONFIRMED','UNCONFIRMED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  check (organization_id is null or organization_id ~ '^[0-9]{1,64}$'),
  check (status <> 'REVOKED' or (access_secret is null and refresh_secret is null and lease_token is null))
);

create index zoho_books_due on zoho_books_connections(next_run_at) where status in ('QUEUED','READY','RETRY_WAIT','SYNCING');

create table zoho_books_snapshots (
  sequence bigserial primary key,
  connection_id uuid not null,
  workspace_id uuid not null,
  bill_id text not null check (bill_id ~ '^[0-9]{1,64}$'),
  fingerprint text not null,
  bill jsonb not null,
  change_kind text not null check (change_kind in ('BASELINE','NEW','AMENDED','VOIDED','REMOVED')),
  observed_at timestamptz not null,
  foreign key (connection_id, workspace_id) references zoho_books_connections(id, workspace_id) on delete cascade,
  unique (connection_id, bill_id, fingerprint),
  unique (sequence, connection_id, workspace_id, bill_id),
  check (bill->>'billId' = bill_id),
  check (bill->>'basis' = 'PROVIDER_BILL_TOTAL'),
  check ((bill->>'totalMinor') ~ '^(0|[1-9][0-9]*)$' and (bill->>'totalMinor')::numeric <= 9223372036854775807),
  check ((bill->>'balanceMinor') ~ '^(0|[1-9][0-9]*)$' and (bill->>'balanceMinor')::numeric <= 9223372036854775807)
);

create index zoho_books_bill_history on zoho_books_snapshots(connection_id, bill_id, sequence desc);

create table zoho_books_records (
  connection_id uuid not null,
  workspace_id uuid not null,
  bill_id text not null,
  latest_sequence bigint not null,
  provider_modified_at timestamptz not null,
  last_seen_scan_id uuid,
  deleted boolean not null default false,
  primary key (connection_id, bill_id),
  foreign key (connection_id, workspace_id) references zoho_books_connections(id, workspace_id) on delete cascade,
  foreign key (latest_sequence, connection_id, workspace_id, bill_id) references zoho_books_snapshots(sequence, connection_id, workspace_id, bill_id) on delete cascade
);

create function reject_zoho_books_snapshot_update() returns trigger language plpgsql as $$
begin
  raise exception 'Zoho Books observations are immutable; append a new source revision.';
end;
$$;

create trigger zoho_books_snapshot_immutable before update on zoho_books_snapshots
for each row execute function reject_zoho_books_snapshot_update();
