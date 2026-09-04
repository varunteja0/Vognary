-- Which adverse record a Commitment Control attention row is actually about.
--
-- Additive only. Nothing here sends, decides, or moves money. Before this
-- migration an attention occurrence was (workspace, proposal, recipient, kind,
-- due date), so two different adverse records on the same proposal that shared
-- a kind and a due date collapsed into a single row: reviewing the first record
-- silently consumed the interruption owed for the second. The occurrence now
-- also carries the identity of the record it is about, and nothing else about
-- it — no merchant, amount, recipient address, or prose.
--
-- target_id is deliberately not a foreign key: it names a row in either
-- commitment_control_reconciliations or commitment_control_outcome_observations,
-- and PostgreSQL cannot reference two tables from one column. A dangling target
-- is unreachable anyway, because the workspace and proposal cascades that erase
-- either record already erase this attention row with it.
--
-- No backfill is possible. A pre-0068 row of a targeted kind names no record,
-- and the record it meant cannot be recovered without guessing, so this
-- migration never invents one. Those rows are kept exactly as they are under a
-- single explicit legacy allowance: the target-identity rule is a trigger that
-- fires only when a row is created, or when an existing row's attention kind or
-- target changes. A historical row may therefore still finish its own delivery
-- story — a signed provider event about an email that really was sent must stay
-- recordable — but it can never acquire a target it never had. Live legacy rows
-- resolve themselves: their occurrence key no longer matches any current
-- attention, so the next scheduler pass cancels them as ATTENTION_RESOLVED and
-- re-queues the same attention with a target.
--
-- Reverting this migration:
--   drop trigger commitment_control_attention_target_identity
--     on commitment_control_attention_notifications;
--   drop function commitment_control_assert_attention_target_identity();
--   drop index cc_attention_notifications_targeted_occurrence_key;
--   drop index cc_attention_notifications_untargeted_occurrence_key;
--   alter table commitment_control_attention_notifications
--     drop constraint cc_attention_notifications_untargeted_kind_check,
--     drop constraint cc_attention_notifications_target_pair_check,
--     drop constraint cc_attention_notifications_target_kind_check,
--     drop column target_id,
--     drop column target_kind;
--   alter table commitment_control_attention_notifications
--     add constraint cc_attention_notifications_occurrence_key
--       unique (workspace_id, proposal_id, recipient_user_id, attention_kind, due_on);
-- The final statement is the only one that can fail, and only when 0068 already
-- recorded two rows that differ solely by target. Cancel the surplus rows first;
-- nothing else in the schema depends on these columns.

alter table commitment_control_attention_notifications
  add column if not exists target_kind text;
alter table commitment_control_attention_notifications
  add column if not exists target_id uuid;

alter table commitment_control_attention_notifications
  drop constraint if exists cc_attention_notifications_target_kind_check;
alter table commitment_control_attention_notifications
  add constraint cc_attention_notifications_target_kind_check
  check (target_kind is null or target_kind in ('RECONCILIATION', 'OUTCOME_OBSERVATION'));

-- Half an identity identifies nothing.
alter table commitment_control_attention_notifications
  drop constraint if exists cc_attention_notifications_target_pair_check;
alter table commitment_control_attention_notifications
  add constraint cc_attention_notifications_target_pair_check
  check ((target_kind is null) = (target_id is null));

-- Only the two attention kinds that are about a specific adverse record may
-- name one. Every other kind is about the proposal itself.
alter table commitment_control_attention_notifications
  drop constraint if exists cc_attention_notifications_untargeted_kind_check;
alter table commitment_control_attention_notifications
  add constraint cc_attention_notifications_untargeted_kind_check
  check (target_kind is null or attention_kind in ('RECONCILIATION_EXCEPTION', 'OUTCOME_MISSED'));

-- The occurrence key is split in two because a null target must still dedupe.
-- A plain unique constraint treats every null as distinct, which would let the
-- untargeted kinds queue the same interruption twice.
create unique index if not exists cc_attention_notifications_targeted_occurrence_key
  on commitment_control_attention_notifications
    (workspace_id, proposal_id, recipient_user_id, attention_kind, due_on, target_kind, target_id)
  where target_kind is not null;

create unique index if not exists cc_attention_notifications_untargeted_occurrence_key
  on commitment_control_attention_notifications
    (workspace_id, proposal_id, recipient_user_id, attention_kind, due_on)
  where target_kind is null;

alter table commitment_control_attention_notifications
  drop constraint if exists cc_attention_notifications_occurrence_key;

-- The legacy allowance in one function: a row must name its target the moment
-- it is written or re-aimed, and a pre-0068 row that changes neither is left
-- alone so its delivery record can still be completed honestly.
create or replace function commitment_control_assert_attention_target_identity()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.attention_kind is not distinct from old.attention_kind
      and new.target_kind is not distinct from old.target_kind
      and new.target_id is not distinct from old.target_id then
      return new;
    end if;
  end if;

  if new.attention_kind in ('RECONCILIATION_EXCEPTION', 'OUTCOME_MISSED')
    and new.target_kind is null then
    raise exception 'Attention about a specific adverse Commitment Control record requires its target identity.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists commitment_control_attention_target_identity
  on commitment_control_attention_notifications;
create trigger commitment_control_attention_target_identity
  before insert or update on commitment_control_attention_notifications
  for each row execute function commitment_control_assert_attention_target_identity();
