-- Hold unmatched recognized notice events, freeze the full Resend payload, and
-- persist an immutable first-connected-mandate cohort. Additive only. Do not rewrite 0035.

alter table recovery_veto_notices
  add column if not exists notice_from_email text;
alter table recovery_veto_notices
  add column if not exists notice_to_email text;
alter table recovery_veto_notices
  add column if not exists notice_subject text;
alter table recovery_veto_notices
  add column if not exists notice_text text;
alter table recovery_veto_notices
  add column if not exists frozen_at timestamptz;

create table if not exists recovery_notice_pending_events (
  provider_event_id text primary key check (length(btrim(provider_event_id)) between 8 and 200),
  event_type text not null check (event_type in (
    'email.sent', 'email.delivered', 'email.delayed', 'email.delivery_delayed',
    'email.bounced', 'email.failed', 'email.complained'
  )),
  provider_message_id text not null check (length(btrim(provider_message_id)) >= 8),
  occurred_at timestamptz not null,
  payload_hash char(64) not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create index if not exists recovery_notice_pending_events_message_idx
  on recovery_notice_pending_events (provider_message_id);

create table if not exists recovery_connected_mandate_cohort (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  started_at timestamptz not null,
  recorded_at timestamptz not null default now()
);

-- Source deletion must be able to cascade evidence so D30 can keep the
-- insert-once cohort row after the live source is gone. Direct evidence
-- updates/deletes stay forbidden while the parent source and workspace exist.
create or replace function reject_recovery_evidence_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE'
    and (
      not exists (select 1 from workspaces where id = old.workspace_id)
      or not exists (
        select 1 from recovery_sources
        where workspace_id = old.workspace_id and id = old.source_id
      )
    )
  then
    return old;
  end if;
  raise exception 'Recovery evidence is immutable.' using errcode = '55000';
end;
$$;
