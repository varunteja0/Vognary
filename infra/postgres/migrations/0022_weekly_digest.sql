alter table renewal_alert_preferences
  add column if not exists weekly_digest_enabled boolean not null default false;

alter table renewal_alert_preferences
  drop constraint if exists renewal_alert_preferences_delivery_consent_check;

alter table renewal_alert_preferences
  add constraint renewal_alert_preferences_delivery_consent_check
  check (not (enabled or weekly_digest_enabled) or consent_grant_id is not null);

create index if not exists renewal_alert_preferences_weekly_digest_idx
  on renewal_alert_preferences(workspace_id, user_id)
  where weekly_digest_enabled;

-- One row per consenting preference and local calendar week. The row stores
-- delivery state only; financial totals and merchant text are resolved at send
-- time so disabling consent or deleting a workspace cannot leave a payload.
create table if not exists weekly_digest_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  preference_id uuid not null references renewal_alert_preferences(id) on delete cascade,
  consent_grant_id uuid not null references consent_grants(id) on delete restrict,
  week_start date not null,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 5),
  next_attempt_at timestamptz,
  last_invocation text check (last_invocation is null or last_invocation in ('internal-api', 'cron')),
  locked_at timestamptz,
  locked_by text check (locked_by is null or length(locked_by) between 1 and 80),
  sent_at timestamptz,
  last_error_code text check (last_error_code is null or length(last_error_code) between 1 and 80),
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (preference_id, week_start),
  check (
    (status = 'sending' and locked_at is not null and locked_by is not null)
    or (status <> 'sending' and locked_at is null and locked_by is null)
  ),
  check (
    (status = 'sent' and sent_at is not null)
    or (status <> 'sent' and sent_at is null)
  ),
  check (status <> 'failed' or last_error_code is not null)
);

create index if not exists weekly_digest_deliveries_due_idx
  on weekly_digest_deliveries(status, next_attempt_at, scheduled_for)
  where status in ('scheduled', 'failed', 'sending');

create index if not exists weekly_digest_deliveries_workspace_idx
  on weekly_digest_deliveries(workspace_id, created_at desc);
