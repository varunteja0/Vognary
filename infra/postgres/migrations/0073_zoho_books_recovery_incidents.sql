create table zoho_books_incidents (
  id uuid primary key,
  connection_id uuid not null,
  workspace_id uuid not null,
  generation bigint not null,
  failure_code text not null,
  assigned_operator_user_id uuid references users(id),
  delivery_status text not null default 'PENDING' check (delivery_status in ('PENDING','DELIVERED','FAILED','UNCONFIGURED')),
  delivery_attempts integer not null default 0 check (delivery_attempts between 0 and 5),
  delivery_receipt text,
  next_delivery_at timestamptz not null,
  delivered_at timestamptz,
  created_at timestamptz not null,
  resumed_by_user_id uuid references users(id),
  resumed_at timestamptz,
  recovered_at timestamptz,
  foreign key (connection_id,workspace_id) references zoho_books_connections(id,workspace_id) on delete cascade,
  check (delivery_status <> 'DELIVERED' or (delivery_receipt is not null and delivered_at is not null and assigned_operator_user_id is not null)),
  check ((resumed_at is null) = (resumed_by_user_id is null)),
  check (recovered_at is null or resumed_at is not null)
);

create unique index zoho_books_open_incident on zoho_books_incidents(connection_id) where resumed_at is null;
