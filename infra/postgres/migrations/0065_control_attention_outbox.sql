-- Commitment Control attention outbox: one durable delivery record per
-- workspace, proposal, recipient, and semantic attention occurrence.
--
-- Additive only. Nothing here sends, decides, or moves money; a row is a record
-- that a human still owes a Control decision or a piece of evidence. The table
-- deliberately stores no message body, only the deterministic attention kind and
-- its due date, so the durable queue holds no drafted prose about a customer.
--
-- Recovery's recovery_change_notifications is not reused: its foreign key is to
-- recovery_change_signals, which has Recovery-specific lifecycle semantics that
-- do not describe an authorization decision.
--
-- Reverting this migration is a single `drop table
-- commitment_control_attention_notifications;`. It has no dependants and no
-- backfill, so the drop restores the exact 0064 shape.

create table if not exists commitment_control_attention_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  proposal_id uuid not null,
  recipient_user_id uuid not null references users(id) on delete cascade,
  channel text not null default 'EMAIL' check (channel = 'EMAIL'),
  attention_kind text not null check (attention_kind in (
    'DECISION_REQUIRED', 'EVIDENCE_DUE', 'AUTHORIZATION_EXPIRING', 'AUTHORIZATION_EXPIRED',
    'OUTCOME_REVIEW_APPROACHING', 'OUTCOME_REVIEW_DUE', 'RECONCILIATION_EXCEPTION', 'OUTCOME_MISSED'
  )),
  due_on date not null,
  delivery_state text not null check (delivery_state in (
    'QUEUED', 'SENDING', 'PROVIDER_ACCEPTED', 'DELIVERED', 'RETRY_SCHEDULED',
    'FAILED', 'DEAD_LETTER', 'CANCELLED', 'UNSUBSCRIBED', 'SUPPRESSED'
  )),
  state_reason text check (state_reason in (
    'ATTENTION_RESOLVED', 'RECIPIENT_INELIGIBLE', 'NO_CONSENT', 'CHANNEL_NOT_READY'
  )),
  attempt_count integer not null default 0 check (attempt_count between 0 and 4),
  next_attempt_at timestamptz,
  locked_by text check (locked_by is null or length(btrim(locked_by)) between 1 and 120),
  locked_at timestamptz,
  provider_message_id text check (provider_message_id is null or length(btrim(provider_message_id)) between 1 and 200),
  provider_accepted_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  error_code text check (error_code is null or length(btrim(error_code)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, proposal_id)
    references commitment_control_proposals(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  constraint cc_attention_notifications_occurrence_key
    unique (workspace_id, proposal_id, recipient_user_id, attention_kind, due_on),
  constraint cc_attention_notifications_schedule_check
    check ((delivery_state in ('QUEUED', 'RETRY_SCHEDULED')) = (next_attempt_at is not null)),
  constraint cc_attention_notifications_lock_check
    check ((delivery_state = 'SENDING') = (locked_by is not null and locked_at is not null)),
  constraint cc_attention_notifications_reason_check
    check ((delivery_state in ('CANCELLED', 'SUPPRESSED')) = (state_reason is not null)),
  constraint cc_attention_notifications_accepted_check
    check (delivery_state not in ('PROVIDER_ACCEPTED', 'DELIVERED') or provider_accepted_at is not null),
  -- Acceptance by a provider is not delivery. Only DELIVERED may carry a
  -- delivered_at, and DELIVERED must cite the provider's own message id.
  constraint cc_attention_notifications_delivery_proof_check
    check (delivery_state = 'DELIVERED' or delivered_at is null),
  constraint cc_attention_notifications_delivered_check
    check (delivery_state <> 'DELIVERED' or (provider_message_id is not null and delivered_at is not null)),
  constraint cc_attention_notifications_failure_check
    check ((delivery_state in ('FAILED', 'DEAD_LETTER')) = (failed_at is not null))
);

create index if not exists cc_attention_notifications_due_idx
  on commitment_control_attention_notifications(workspace_id, next_attempt_at, id)
  where delivery_state in ('QUEUED', 'RETRY_SCHEDULED');

create index if not exists cc_attention_notifications_locked_idx
  on commitment_control_attention_notifications(workspace_id, locked_at, id)
  where delivery_state = 'SENDING';
