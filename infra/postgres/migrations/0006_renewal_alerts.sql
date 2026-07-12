create table if not exists renewal_alert_preferences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  consent_grant_id uuid references consent_grants(id) on delete restrict,
  enabled boolean not null default false,
  seven_day_enabled boolean not null default true,
  one_day_enabled boolean not null default true,
  time_zone text not null default 'UTC'
    check (length(btrim(time_zone)) between 1 and 64),
  send_hour_local smallint not null default 9
    check (send_hour_local between 0 and 23),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id),
  check (not enabled or consent_grant_id is not null)
);

create index if not exists renewal_alert_preferences_enabled_idx
  on renewal_alert_preferences(workspace_id, user_id)
  where enabled;

create table if not exists renewal_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  preference_id uuid not null references renewal_alert_preferences(id) on delete cascade,
  consent_grant_id uuid not null references consent_grants(id) on delete restrict,
  recurring_item_id uuid not null references recurring_items(id) on delete cascade,
  alert_window text not null check (alert_window in ('7_day', '1_day')),
  renewal_date date not null,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 5),
  next_attempt_at timestamptz,
  locked_at timestamptz,
  locked_by text check (locked_by is null or length(locked_by) between 1 and 80),
  sent_at timestamptz,
  last_error_code text check (last_error_code is null or length(last_error_code) between 1 and 80),
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (preference_id, recurring_item_id, alert_window, renewal_date),
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

create index if not exists renewal_alert_deliveries_due_idx
  on renewal_alert_deliveries(status, next_attempt_at, scheduled_for)
  where status in ('scheduled', 'failed', 'sending');

create index if not exists renewal_alert_deliveries_workspace_idx
  on renewal_alert_deliveries(workspace_id, created_at desc);
