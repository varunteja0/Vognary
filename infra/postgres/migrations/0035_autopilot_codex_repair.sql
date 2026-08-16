-- Freeze veto notice payload before provider send. Additive only.
-- Do not rewrite 0034.

alter table recovery_veto_notices
  add column if not exists veto_expires_at timestamptz;

alter table recovery_veto_notices
  add column if not exists notice_body_hash char(64);

alter table recovery_veto_notices
  drop constraint if exists recovery_veto_notices_notice_body_hash_check;
alter table recovery_veto_notices
  add constraint recovery_veto_notices_notice_body_hash_check
  check (notice_body_hash is null or notice_body_hash ~ '^[0-9a-f]{64}$');
