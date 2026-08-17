-- Change signals and their notifications.
--
-- Exactly eight things are worth interrupting someone for. Each stored signal
-- must cite persisted evidence, an absence made meaningful by named current
-- sources, or the health of a named source. The unique dedupe key makes
-- re-detection a no-op rather than a duplicate, and the lifecycle columns mean a
-- change that stopped holding is resolved rather than deleted.
create table if not exists recovery_change_signals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  dedupe_key text not null check (length(btrim(dedupe_key)) between 1 and 400),
  kind text not null check (
    kind in (
      'TRIAL_CONVERTING', 'ANNUAL_RENEWAL_APPROACHING', 'PRICE_INCREASE', 'NEW_RECURRING_COMMITMENT',
      'DUPLICATE_SUSPECTED', 'EXPECTED_CHARGE_MISSING', 'CANCELLATION_NOT_EFFECTIVE', 'COVERAGE_BROKEN'
    )
  ),
  state text not null default 'OPEN' check (
    state in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPERSEDED', 'EXPIRED')
  ),
  commitment_id uuid,
  materiality text not null check (materiality in ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  confidence smallint not null check (confidence between 0 and 100),
  title text not null check (length(btrim(title)) between 1 and 200),
  detail text not null check (length(btrim(detail)) between 1 and 600),
  currency char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  delta_minor bigint,
  due_date date,
  citation_kind text not null check (citation_kind in ('EVIDENCE', 'COVERED_ABSENCE', 'SOURCE_HEALTH')),
  cited_evidence_ids uuid[] not null default '{}',
  cited_source_ids uuid[] not null default '{}',
  absence_window_start date,
  absence_window_end date,
  detected_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  superseded_at timestamptz,
  expired_at timestamptz,
  foreign key (workspace_id, commitment_id)
    references recovery_commitments(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  unique (workspace_id, dedupe_key),
  -- Cite or stay quiet. A signal with nothing behind it cannot be stored.
  constraint recovery_change_signals_citation_check check (
    (citation_kind = 'EVIDENCE' and cardinality(cited_evidence_ids) >= 1)
    or (
      citation_kind = 'COVERED_ABSENCE'
      and cardinality(cited_source_ids) >= 1
      and absence_window_start is not null
      and absence_window_end is not null
      and absence_window_start <= absence_window_end
    )
    or (citation_kind = 'SOURCE_HEALTH' and cardinality(cited_source_ids) >= 1)
  ),
  constraint recovery_change_signals_money_check
    check ((amount_minor is null and delta_minor is null) or currency is not null),
  -- Only a workspace-wide problem may exist without a subscription.
  constraint recovery_change_signals_scope_check
    check (commitment_id is not null or kind = 'COVERAGE_BROKEN'),
  constraint recovery_change_signals_state_stamp_check check (
    (state <> 'ACKNOWLEDGED' or acknowledged_at is not null)
    and (state = 'RESOLVED') = (resolved_at is not null)
    and (state = 'SUPERSEDED') = (superseded_at is not null)
    and (state = 'EXPIRED') = (expired_at is not null)
  )
);

create index if not exists recovery_change_signals_open_idx
  on recovery_change_signals(workspace_id, materiality, detected_at desc)
  where state in ('OPEN', 'ACKNOWLEDGED');
create index if not exists recovery_change_signals_commitment_idx
  on recovery_change_signals(workspace_id, commitment_id)
  where commitment_id is not null;

-- One delivery attempt record per signal and channel.
--
-- The check at the bottom is the honesty rule: nothing may be stored as
-- DELIVERED without a provider message id and a delivery timestamp, so the
-- product can never tell a customer an email arrived because it was queued.
create table if not exists recovery_change_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  change_signal_id uuid not null,
  channel text not null check (channel in ('IN_APP', 'EMAIL')),
  delivery_state text not null check (
    delivery_state in (
      'QUEUED', 'SENDING', 'PROVIDER_ACCEPTED', 'DELIVERED', 'FAILED',
      'RETRY_SCHEDULED', 'DEAD_LETTER', 'SUPPRESSED', 'UNSUBSCRIBED'
    )
  ),
  suppression_reason text check (
    suppression_reason in ('ALREADY_NOTIFIED', 'BELOW_MATERIALITY', 'NO_CONSENT', 'UNSUBSCRIBED', 'CHANNEL_NOT_READY')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  provider_message_id text,
  provider_accepted_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  error_code text check (error_code is null or length(btrim(error_code)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, change_signal_id)
    references recovery_change_signals(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  unique (workspace_id, change_signal_id, channel),
  constraint recovery_change_notifications_delivery_proof_check
    check (delivery_state <> 'DELIVERED' or (provider_message_id is not null and delivered_at is not null)),
  constraint recovery_change_notifications_suppression_check
    check ((delivery_state = 'SUPPRESSED') = (suppression_reason is not null)),
  constraint recovery_change_notifications_retry_check
    check ((delivery_state = 'RETRY_SCHEDULED') = (next_attempt_at is not null)),
  constraint recovery_change_notifications_accepted_check
    check (delivery_state not in ('PROVIDER_ACCEPTED', 'DELIVERED') or provider_accepted_at is not null)
);

create index if not exists recovery_change_notifications_due_idx
  on recovery_change_notifications(workspace_id, next_attempt_at)
  where delivery_state = 'RETRY_SCHEDULED';

-- Per-workspace notification consent. Absent row means no product email, so an
-- unconfigured workspace is silent rather than opted in.
create table if not exists recovery_notification_preferences (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  product_emails boolean not null default false,
  minimum_materiality text not null default 'HIGH' check (
    minimum_materiality in ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')
  ),
  digest_interval_hours smallint not null default 24 check (digest_interval_hours between 1 and 168),
  digest_last_sent_at timestamptz,
  unsubscribed_at timestamptz,
  unsubscribe_token_hash char(64),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  constraint recovery_notification_preferences_unsubscribe_check
    check (unsubscribed_at is null or product_emails = false)
);
