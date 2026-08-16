-- Freeze Resend tags with the provider payload, and record source reconnection
-- without deleting evidence. Additive only. Do not rewrite 0036 or 0037.

alter table recovery_veto_notices
  add column if not exists notice_tags jsonb not null default '[{"name":"vognary","value":"autopilot-notice"}]'::jsonb;
alter table recovery_veto_notices
  drop constraint if exists recovery_veto_notices_notice_tags_array;
alter table recovery_veto_notices
  add constraint recovery_veto_notices_notice_tags_array
  check (jsonb_typeof(notice_tags) = 'array');

alter table recovery_veto_notices
  add column if not exists notice_payload_version integer not null default 1;
alter table recovery_veto_notices
  drop constraint if exists recovery_veto_notices_notice_payload_version_check;
alter table recovery_veto_notices
  add constraint recovery_veto_notices_notice_payload_version_check
  check (notice_payload_version >= 1);

alter table recovery_source_disconnections
  add column if not exists reconnected_at timestamptz;
