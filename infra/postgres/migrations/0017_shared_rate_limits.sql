-- Provide a shared, fail-closed rate-limit backend using the production
-- Postgres service. Bucket keys contain only namespaced opaque identities;
-- raw IP addresses, emails, and session tokens are never stored here.

create table if not exists rate_limit_buckets (
  bucket_key text primary key check (length(bucket_key) between 16 and 240),
  request_count integer not null check (request_count > 0),
  reset_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists rate_limit_buckets_reset_idx
  on rate_limit_buckets(reset_at);
