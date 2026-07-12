create table if not exists billing_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  customer_email text not null check (length(btrim(customer_email)) between 3 and 320),
  plan text not null check (plan in ('personal', 'founder', 'team', 'annual')),
  provider text not null check (provider in ('razorpay', 'payment-link')),
  status text not null default 'created' check (status in ('created', 'pending', 'paid', 'failed', 'cancelled', 'expired', 'refunded')),
  currency char(3) not null default 'INR',
  amount_minor bigint not null check (amount_minor > 0),
  refunded_amount_minor bigint not null default 0 check (refunded_amount_minor >= 0 and refunded_amount_minor <= amount_minor),
  idempotency_key text not null unique check (length(idempotency_key) between 16 and 128),
  provider_checkout_id text,
  provider_payment_id text,
  provider_checkout_url text,
  paid_at timestamptz,
  refunded_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'paid') = (paid_at is not null) or status = 'refunded'),
  check (status <> 'refunded' or refunded_at is not null)
);

create unique index if not exists billing_checkout_provider_id_idx
  on billing_checkout_sessions(provider, provider_checkout_id)
  where provider_checkout_id is not null;

create index if not exists billing_checkout_workspace_created_idx
  on billing_checkout_sessions(workspace_id, created_at desc);

create index if not exists billing_checkout_payment_idx
  on billing_checkout_sessions(provider, provider_payment_id)
  where provider_payment_id is not null;

create table if not exists billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('razorpay')),
  external_event_id text not null,
  event_type text not null,
  payload_hash char(64) not null,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, external_event_id)
);

create index if not exists billing_webhook_received_idx
  on billing_webhook_events(received_at desc);

create table if not exists workspace_entitlements (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entitlement_key text not null check (entitlement_key in ('monitoring', 'annual-audit')),
  source_checkout_session_id uuid references billing_checkout_sessions(id) on delete set null,
  status text not null check (status in ('active', 'revoked', 'expired')),
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entitlement_key),
  check (expires_at > starts_at),
  check ((status = 'revoked') = (revoked_at is not null))
);

create index if not exists workspace_entitlements_active_idx
  on workspace_entitlements(expires_at)
  where status = 'active';