-- Recovery-native receipt inbox routing. Financial facts still materialize only
-- through recovery_sources, recovery_evidence, and recovery_commitments.
alter table recovery_submissions
  drop constraint if exists recovery_submissions_source_type_check;
alter table recovery_submissions
  add constraint recovery_submissions_source_type_check
  check (source_type in ('RECEIPT_PASTE', 'CSV_IMPORT', 'FORWARDED_EMAIL'));

alter table recovery_sources
  drop constraint if exists recovery_sources_source_type_check;
alter table recovery_sources
  add constraint recovery_sources_source_type_check
  check (source_type in ('RECEIPT_PASTE', 'CSV_IMPORT', 'FORWARDED_EMAIL'));

alter table recovery_evidence
  drop constraint if exists recovery_evidence_provenance_kind_check;
alter table recovery_evidence
  add constraint recovery_evidence_provenance_kind_check
  check (provenance_kind in ('USER_SUBMITTED', 'PROVIDER_RECEIVED'));

alter table connected_accounts
  drop constraint if exists connected_accounts_workspace_id_id_key;
alter table connected_accounts
  add constraint connected_accounts_workspace_id_id_key
  unique (workspace_id, id);

create table if not exists recovery_inbound_aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connected_account_id uuid not null,
  receiving_domain text not null check (
    receiving_domain = lower(btrim(receiving_domain))
    and length(receiving_domain) between 3 and 253
  ),
  alias_hmac char(64) not null check (alias_hmac ~ '^[0-9a-f]{64}$'),
  hmac_key_id text not null check (length(btrim(hmac_key_id)) between 1 and 120),
  encrypted_display jsonb check (encrypted_display is null or jsonb_typeof(encrypted_display) = 'object'),
  encryption_key_fingerprint text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ROTATED', 'REVOKED')),
  replaced_by_id uuid,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  revoked_at timestamptz,
  unique (hmac_key_id, alias_hmac),
  unique (workspace_id, id),
  foreign key (workspace_id, connected_account_id)
    references connected_accounts(workspace_id, id) on delete cascade,
  foreign key (workspace_id, replaced_by_id)
    references recovery_inbound_aliases(workspace_id, id) on delete set null (replaced_by_id),
  check (
    (status = 'ACTIVE' and rotated_at is null and revoked_at is null and encrypted_display is not null)
    or (status = 'ROTATED' and rotated_at is not null and revoked_at is null and encrypted_display is null)
    or (status = 'REVOKED' and revoked_at is not null and encrypted_display is null)
  )
);

create unique index if not exists recovery_inbound_aliases_active_workspace_idx
  on recovery_inbound_aliases(workspace_id)
  where status = 'ACTIVE';
create index if not exists recovery_inbound_aliases_account_idx
  on recovery_inbound_aliases(connected_account_id, status);

create table if not exists recovery_inbound_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'RESEND'),
  svix_id text not null check (length(btrim(svix_id)) between 1 and 240),
  provider_email_id text not null check (length(btrim(provider_email_id)) between 1 and 240),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  alias_id uuid,
  event_type text not null check (length(btrim(event_type)) between 1 and 120),
  payload_hash char(64) not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'RECEIVED'
    check (status in ('RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'TERMINAL_FAILED')),
  error_code text check (error_code is null or length(error_code) <= 120),
  received_at timestamptz not null default now(),
  processing_started_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  processed_at timestamptz,
  foreign key (workspace_id, alias_id)
    references recovery_inbound_aliases(workspace_id, id) on delete set null (alias_id),
  unique (provider, svix_id),
  unique (provider, provider_email_id),
  unique (workspace_id, id),
  check ((status in ('PROCESSED', 'IGNORED', 'TERMINAL_FAILED')) = (processed_at is not null)),
  constraint recovery_inbound_events_processing_lease_check
    check ((status = 'PROCESSING') = (processing_started_at is not null))
);

create index if not exists recovery_inbound_events_workspace_received_idx
  on recovery_inbound_events(workspace_id, received_at desc);
create index if not exists recovery_inbound_events_pending_idx
  on recovery_inbound_events(received_at)
  where status in ('RECEIVED', 'PROCESSING');
create index if not exists recovery_inbound_events_retention_idx
  on recovery_inbound_events(received_at)
  where status in ('PROCESSED', 'IGNORED', 'TERMINAL_FAILED');

create table if not exists recovery_inbound_replay_keys (
  provider text not null check (provider = 'RESEND'),
  key_kind text not null check (key_kind in ('SVIX_ID', 'PROVIDER_EMAIL_ID')),
  key_hash char(64) not null check (key_hash ~ '^[0-9a-f]{64}$'),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (provider, key_kind, key_hash)
);

create index if not exists recovery_inbound_replay_keys_workspace_idx
  on recovery_inbound_replay_keys(workspace_id, created_at desc);

insert into recovery_inbound_replay_keys (provider, key_kind, key_hash, workspace_id, created_at)
select provider, 'SVIX_ID', encode(digest(svix_id, 'sha256'), 'hex'), workspace_id, received_at
from recovery_inbound_events
on conflict do nothing;

insert into recovery_inbound_replay_keys (provider, key_kind, key_hash, workspace_id, created_at)
select provider, 'PROVIDER_EMAIL_ID', encode(digest(provider_email_id, 'sha256'), 'hex'), workspace_id, received_at
from recovery_inbound_events
on conflict do nothing;

alter table recovery_submissions
  add column if not exists inbound_event_id uuid;
alter table recovery_submissions
  drop constraint if exists recovery_submissions_inbound_event_id_fkey;
alter table recovery_submissions
  add constraint recovery_submissions_inbound_event_id_fkey
  foreign key (workspace_id, inbound_event_id)
  references recovery_inbound_events(workspace_id, id) on delete set null (inbound_event_id);
create unique index if not exists recovery_submissions_inbound_event_idx
  on recovery_submissions(inbound_event_id)
  where inbound_event_id is not null;