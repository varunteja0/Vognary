create table zoho_books_reviews (
  connection_id uuid not null,
  workspace_id uuid not null,
  bill_id text not null,
  sequence bigint not null,
  reviewed_by_user_id uuid not null references users(id),
  reviewed_at timestamptz not null default now(),
  primary key (connection_id, sequence),
  foreign key (sequence, connection_id, workspace_id, bill_id)
    references zoho_books_snapshots(sequence, connection_id, workspace_id, bill_id) on delete cascade
);

create trigger zoho_books_review_immutable before update on zoho_books_reviews
for each row execute function reject_zoho_books_snapshot_update();
