-- Preserve exact legacy notice retries, lock frozen-row identity, and keep the
-- 0039 migration immutable. Additive only. Do not rewrite 0039.

alter table recovery_veto_notices
  add column if not exists notice_hash_version smallint;

-- Rows already present may carry the pre-tags hash. New freezes use version 2.
update recovery_veto_notices
set notice_hash_version = 1
where notice_hash_version is null;

alter table recovery_veto_notices
  alter column notice_hash_version set default 2;
alter table recovery_veto_notices
  alter column notice_hash_version set not null;
alter table recovery_veto_notices
  drop constraint if exists recovery_veto_notices_notice_hash_version_check;
alter table recovery_veto_notices
  add constraint recovery_veto_notices_notice_hash_version_check
  check (notice_hash_version in (1, 2));

create or replace function reject_recovery_frozen_notice_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.frozen_at is not null
      and exists (select 1 from workspaces where id = old.workspace_id)
    then
      raise exception 'Frozen notice cannot be deleted directly.';
    end if;
    return old;
  end if;

  if old.frozen_at is not null and (
    new.id is distinct from old.id
    or new.workspace_id is distinct from old.workspace_id
    or new.candidate_id is distinct from old.candidate_id
    or new.channel is distinct from old.channel
    or new.created_at is distinct from old.created_at
    or new.notice_from_email is distinct from old.notice_from_email
    or new.notice_to_email is distinct from old.notice_to_email
    or new.notice_subject is distinct from old.notice_subject
    or new.notice_text is distinct from old.notice_text
    or new.notice_tags is distinct from old.notice_tags
    or new.notice_payload_version is distinct from old.notice_payload_version
    or new.notice_hash_version is distinct from old.notice_hash_version
    or new.notice_body_hash is distinct from old.notice_body_hash
    or new.veto_token_hash is distinct from old.veto_token_hash
    or new.veto_expires_at is distinct from old.veto_expires_at
    or new.frozen_at is distinct from old.frozen_at
  ) then
    raise exception 'Frozen notice payload cannot be mutated.';
  end if;
  return new;
end;
$$;

drop trigger if exists recovery_veto_notices_frozen_immutable on recovery_veto_notices;
create trigger recovery_veto_notices_frozen_immutable
  before update or delete on recovery_veto_notices
  for each row execute function reject_recovery_frozen_notice_mutation();
