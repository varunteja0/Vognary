-- Terminal receipt-inbox transport metadata follows the workspace operational
-- retention window. Canonical Recovery submissions and evidence remain intact.
alter table recovery_inbound_events
  drop constraint if exists recovery_inbound_events_workspace_id_alias_id_fkey;
alter table recovery_inbound_events
  add constraint recovery_inbound_events_workspace_id_alias_id_fkey
  foreign key (workspace_id, alias_id)
  references recovery_inbound_aliases(workspace_id, id) on delete set null (alias_id);

alter table recovery_submissions
  drop constraint if exists recovery_submissions_inbound_event_id_fkey;
alter table recovery_submissions
  add constraint recovery_submissions_inbound_event_id_fkey
  foreign key (workspace_id, inbound_event_id)
  references recovery_inbound_events(workspace_id, id) on delete set null (inbound_event_id);

alter table recovery_inbound_events
  add column if not exists processing_started_at timestamptz,
  add column if not exists attempt_count integer not null default 0;
alter table recovery_inbound_events
  drop constraint if exists recovery_inbound_events_attempt_count_check;
alter table recovery_inbound_events
  add constraint recovery_inbound_events_attempt_count_check
  check (attempt_count >= 0);
update recovery_inbound_events
set processing_started_at = received_at
where status = 'PROCESSING' and processing_started_at is null;

create or replace function reject_retired_connector_sync_job()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('queued', 'running', 'failed', 'paused') then
    raise exception 'Legacy connector synchronization is retired at Recovery cutover.' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists connector_sync_jobs_recovery_cutover_guard on connector_sync_jobs;
create trigger connector_sync_jobs_recovery_cutover_guard
before insert or update of status on connector_sync_jobs
for each row execute function reject_retired_connector_sync_job();

create or replace function reject_retired_connector_evidence_write()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - array['payload', 'payload_minimized_at']::text[])
       = (to_jsonb(old) - array['payload', 'payload_minimized_at']::text[])
     and new.payload = '{}'::jsonb
     and new.payload_minimized_at is not null then
    return new;
  end if;
  raise exception 'Connector evidence writes are retired at Recovery cutover.' using errcode = '55000';
end;
$$;

drop trigger if exists connector_evidence_running_job_guard on connector_evidence;
create trigger connector_evidence_running_job_guard
before insert or update on connector_evidence
for each row execute function reject_retired_connector_evidence_write();

create or replace function reject_nonterminal_legacy_renewal_delivery()
returns trigger
language plpgsql
as $$
begin
  if new.recurring_item_id is not null and new.status in ('scheduled', 'sending', 'failed') then
    raise exception 'Legacy renewal deliveries are retired at Recovery cutover.' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists renewal_alert_deliveries_recovery_cutover_guard on renewal_alert_deliveries;
create trigger renewal_alert_deliveries_recovery_cutover_guard
before insert or update of recurring_item_id, status on renewal_alert_deliveries
for each row execute function reject_nonterminal_legacy_renewal_delivery();

update connector_sync_runs run
set status = 'blocked',
    finished_at = coalesce(run.finished_at, now()),
    error_code = 'recovery_cutover',
    error_message = 'Legacy connector synchronization retired at Recovery cutover.'
from connector_sync_jobs job
where run.sync_job_id = job.id
  and run.status = 'running'
  and job.status in ('queued', 'running', 'failed', 'paused');

update connector_sync_jobs
set status = 'blocked',
    next_run_at = null,
    locked_at = null,
    locked_by = null,
    last_error = 'Legacy connector synchronization retired at Recovery cutover.',
    last_error_at = now(),
    updated_at = now()
where status in ('queued', 'running', 'failed', 'paused');

update renewal_alert_deliveries
set status = 'cancelled',
    next_attempt_at = null,
    locked_at = null,
    locked_by = null,
    updated_at = now()
where recurring_item_id is not null
  and status in ('scheduled', 'sending', 'failed');

alter table recovery_inbound_events
  drop constraint if exists recovery_inbound_events_processing_lease_check;
alter table recovery_inbound_events
  add constraint recovery_inbound_events_processing_lease_check
  check ((status = 'PROCESSING') = (processing_started_at is not null));