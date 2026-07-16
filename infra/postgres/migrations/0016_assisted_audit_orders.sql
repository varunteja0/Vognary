-- Replace the misleading annual-audit purchase model with a versioned,
-- one-time assisted-audit order while preserving historical plan values. This
-- launch-closeout migration also binds Google login to immutable provider
-- identity and removes legacy financial summaries from audit metadata.

create table if not exists auth_identities (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('google')),
  issuer text not null,
  subject text not null,
  user_id uuid not null references users(id) on delete cascade,
  email_at_link text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, issuer, subject),
  unique (provider, user_id)
);

update audit_log
set metadata = jsonb_strip_nulls(jsonb_build_object(
  'revision', metadata -> 'revision',
  'materialized', metadata -> 'materialized'
))
where action = 'workspace_state.saved'
  and (metadata ? 'title' or metadata ? 'summary');

alter table renewal_alert_deliveries
  add column if not exists last_invocation text
  check (last_invocation is null or last_invocation in ('internal-api', 'cron'));

alter table billing_checkout_sessions
  drop constraint if exists billing_checkout_sessions_plan_check,
  drop constraint if exists billing_checkout_sessions_status_check,
  drop constraint if exists billing_checkout_sessions_offer_version_check,
  drop constraint if exists billing_checkout_sessions_check,
  drop constraint if exists billing_checkout_sessions_check1;

alter table billing_checkout_sessions
  add column if not exists offer_id text default 'legacy-unversioned-offer',
  add column if not exists offer_version integer default 1,
  add column if not exists terms_version text default 'legacy-unversioned',
  add column if not exists provider_creation_started_at timestamptz;

update billing_checkout_sessions
set offer_id = case when plan = 'annual' then 'assisted-private-audit' else 'legacy-' || plan end,
    offer_version = 1,
    terms_version = 'legacy-unversioned'
where offer_id is null or offer_version is null or terms_version is null;

update billing_checkout_sessions
set paid_at = coalesce(paid_at, refunded_at, updated_at, created_at)
where status = 'refunded' and paid_at is null;

do $$
begin
  if exists (
    select 1
    from billing_checkout_sessions
    where provider_payment_id is not null
    group by provider, provider_payment_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate provider payment IDs must be reconciled before migration 0016 can enforce settlement identity.';
  end if;
end $$;

alter table billing_checkout_sessions
  alter column offer_id set not null,
  alter column offer_version set not null,
  alter column terms_version set not null,
  add constraint billing_checkout_sessions_offer_version_check
    check (offer_version > 0),
  add constraint billing_checkout_sessions_plan_check
    check (plan in ('personal', 'founder', 'team', 'annual', 'assisted-audit')),
  add constraint billing_checkout_sessions_status_check
    check (status in ('created', 'pending', 'paid', 'partially_refunded', 'failed', 'reconciliation_required', 'cancelled', 'expired', 'refunded')),
  add constraint billing_checkout_sessions_payment_state_check
    check ((status in ('paid', 'partially_refunded', 'refunded')) = (paid_at is not null)),
  add constraint billing_checkout_sessions_refund_state_check
    check (status <> 'refunded' or refunded_at is not null);

alter table billing_checkout_sessions
  drop constraint if exists billing_checkout_sessions_workspace_id_fkey;

alter table billing_checkout_sessions
  add constraint billing_checkout_sessions_workspace_id_fkey
  foreign key (workspace_id) references workspaces(id) on delete set null;

drop index if exists billing_checkout_payment_idx;
create unique index billing_checkout_payment_idx
  on billing_checkout_sessions(provider, provider_payment_id)
  where provider_payment_id is not null;

create unique index if not exists billing_checkout_assisted_offer_idx
  on billing_checkout_sessions(lead_id, offer_id, offer_version)
  where plan = 'assisted-audit' and lead_id is not null;

create table if not exists billing_refunds (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('razorpay')),
  provider_refund_id text not null,
  provider_payment_id text not null,
  checkout_session_id uuid references billing_checkout_sessions(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  status text not null check (status in ('pending_payment', 'applied', 'rejected')),
  rejection_code text,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (provider, provider_refund_id)
);

create index if not exists billing_refunds_payment_idx
  on billing_refunds(provider, provider_payment_id, created_at);

create table if not exists assisted_audit_orders (
  id uuid primary key default gen_random_uuid(),
  checkout_session_id uuid not null unique references billing_checkout_sessions(id) on delete restrict,
  workspace_id uuid references workspaces(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  lead_id uuid references private_audit_leads(id) on delete set null,
  offer_id text not null,
  offer_version integer not null check (offer_version > 0),
  terms_version text not null,
  status text not null check (status in ('review_required', 'pending', 'in_progress', 'delivered', 'cancelled', 'refunded')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  delivered_at timestamptz,
  refunded_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into assisted_audit_orders (
  checkout_session_id, workspace_id, user_id, lead_id,
  offer_id, offer_version, terms_version, status, created_at, refunded_at
)
select id, workspace_id, user_id, lead_id,
       offer_id, offer_version, terms_version,
       case when status = 'refunded' then 'refunded' else 'review_required' end,
       coalesce(paid_at, created_at), refunded_at
from billing_checkout_sessions
where plan = 'annual' and paid_at is not null
on conflict (checkout_session_id) do nothing;

create index if not exists assisted_audit_orders_status_created_idx
  on assisted_audit_orders(status, created_at);