-- Phase A receipt activation and first-10 experiment milestones.
--
-- These timestamps describe facts the receipt rail itself proved. Alias
-- creation is the setup start. Setup completes only after accepted evidence;
-- Gmail forwarding is verified only when a receipt succeeds after its
-- confirmation challenge; backfill completes only when accepted evidence came
-- from a nested message/rfc822 attachment.
alter table recovery_inbound_aliases
  add column if not exists setup_completed_at timestamptz,
  add column if not exists forwarding_verified_at timestamptz,
  add column if not exists backfill_completed_at timestamptz;

with first_processed as (
  select alias.id,
         min(event.processed_at) filter (where event.status = 'PROCESSED') as processed_at
  from recovery_inbound_aliases alias
  left join recovery_inbound_events event
    on event.workspace_id = alias.workspace_id and event.alias_id = alias.id
  group by alias.id
)
update recovery_inbound_aliases alias
set setup_completed_at = first_processed.processed_at,
    forwarding_verified_at = case
      when alias.gmail_verification_received_at is not null
        and first_processed.processed_at >= alias.gmail_verification_received_at
      then first_processed.processed_at
      else alias.forwarding_verified_at
    end
from first_processed
where first_processed.id = alias.id
  and first_processed.processed_at is not null
  and alias.setup_completed_at is null;

alter table recovery_inbound_aliases
  drop constraint if exists recovery_inbound_aliases_phase_a_milestones_check;
alter table recovery_inbound_aliases
  add constraint recovery_inbound_aliases_phase_a_milestones_check
  check (
    (setup_completed_at is null or setup_completed_at >= created_at)
    and (forwarding_verified_at is null or (
      setup_completed_at is not null
      and forwarding_verified_at >= created_at
    ))
    and (backfill_completed_at is null or (
      setup_completed_at is not null
      and backfill_completed_at >= created_at
    ))
  );

create or replace function reject_recovery_inbound_alias_milestone_rewrite()
returns trigger
language plpgsql
as $$
begin
  if old.setup_completed_at is not null
    and new.setup_completed_at is distinct from old.setup_completed_at
  then
    raise exception 'Receipt setup completion is immutable.' using errcode = '55000';
  end if;
  if old.forwarding_verified_at is not null
    and new.forwarding_verified_at is distinct from old.forwarding_verified_at
  then
    raise exception 'Receipt forwarding verification is immutable.' using errcode = '55000';
  end if;
  if old.backfill_completed_at is not null
    and new.backfill_completed_at is distinct from old.backfill_completed_at
  then
    raise exception 'Receipt backfill completion is immutable.' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists recovery_inbound_alias_milestones_immutable
  on recovery_inbound_aliases;
create trigger recovery_inbound_alias_milestones_immutable
  before update on recovery_inbound_aliases
  for each row execute function reject_recovery_inbound_alias_milestone_rewrite();

alter table product_events drop constraint if exists product_events_event_name_check;
alter table product_events add constraint product_events_event_name_check check (event_name in (
  'connector.sync.started',
  'connector.sync.succeeded',
  'connector.sync.failed',
  'ledger.materialized',
  'workspace.activated',
  'ledger.viewed',
  'review.action_recorded',
  'review.completed',
  'export.created',
  'private_audit.requested',
  'billing.checkout_started',
  'billing.payment_settled',
  'billing.payment_refunded',
  'mandate.signed',
  'mandate.revoked',
  'candidate.evaluated',
  'candidate.vetoed',
  'candidate.authorized',
  'notice.queued',
  'notice.delivered',
  'notice.failed',
  'execution.started',
  'execution.completed',
  'execution.failed',
  'exception.opened',
  'window.verified',
  'verification.pending',
  'invoice.created',
  'source.connected',
  'receipt_setup.started',
  'receipt_setup.completed',
  'receipt_forwarding.verified',
  'receipt_backfill.completed',
  'commitments.detected',
  'correction.recorded',
  'source.health_observed',
  'workspace.returned'
));

alter table product_events drop constraint if exists product_events_metrics_check1;
alter table product_events drop constraint if exists product_events_metrics_check2;
alter table product_events
  add constraint product_events_metrics_check1 check ((metrics - array[
    'recordsSeen',
    'evidenceWritten',
    'transactionsWritten',
    'commitmentsTouched',
    'usageObservationsWritten',
    'commitmentsDetected',
    'correctionsRecorded',
    'healthySources',
    'secondsToTrustworthyPicture'
  ]::text[]) = '{}'::jsonb),
  add constraint product_events_metrics_check2 check (
    coalesce(jsonb_typeof(metrics -> 'recordsSeen') = 'number', true)
    and coalesce(jsonb_typeof(metrics -> 'evidenceWritten') = 'number', true)
    and coalesce(jsonb_typeof(metrics -> 'transactionsWritten') = 'number', true)
    and coalesce(jsonb_typeof(metrics -> 'commitmentsTouched') = 'number', true)
    and coalesce(jsonb_typeof(metrics -> 'usageObservationsWritten') = 'number', true)
    and coalesce(jsonb_typeof(metrics -> 'commitmentsDetected') = 'number', true)
    and coalesce(jsonb_typeof(metrics -> 'correctionsRecorded') = 'number', true)
    and coalesce(jsonb_typeof(metrics -> 'healthySources') = 'number', true)
    and coalesce(jsonb_typeof(metrics -> 'secondsToTrustworthyPicture') = 'number', true)
  );

create unique index if not exists product_events_phase_a_workspace_once_idx
  on product_events(workspace_id, event_name)
  where workspace_id is not null and event_name in (
    'receipt_setup.started',
    'receipt_setup.completed',
    'receipt_forwarding.verified',
    'receipt_backfill.completed',
    'commitments.detected',
    'workspace.returned'
  );