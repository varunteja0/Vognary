create table zoho_books_dispositions (
  id uuid primary key,
  event_sequence bigserial unique not null,
  connection_id uuid not null,
  workspace_id uuid not null,
  bill_id text not null,
  source_sequence bigint not null,
  version bigint not null check (version > 0),
  actor_user_id uuid not null references users(id),
  kind text not null check (kind in ('FOLLOW_UP','RESOLVED')),
  note text not null check (length(trim(note)) between 1 and 2000),
  follow_up_on date,
  responsible_user_id uuid references users(id),
  basis text not null default 'HUMAN_REVIEW_NOT_PAYMENT' check (basis='HUMAN_REVIEW_NOT_PAYMENT'),
  request_key text not null,
  request_hash text not null,
  created_at timestamptz not null,
  foreign key (source_sequence,connection_id,workspace_id,bill_id)
    references zoho_books_snapshots(sequence,connection_id,workspace_id,bill_id) on delete cascade,
  unique (connection_id,source_sequence,version),
  unique (workspace_id,request_key),
  check ((kind='FOLLOW_UP' and follow_up_on is not null and responsible_user_id is not null and responsible_user_id=actor_user_id)
    or (kind='RESOLVED' and follow_up_on is null and responsible_user_id is null))
);

create index zoho_books_disposition_history on zoho_books_dispositions(connection_id,bill_id,event_sequence desc);
create trigger zoho_books_disposition_immutable before update on zoho_books_dispositions
for each row execute function reject_zoho_books_snapshot_update();
