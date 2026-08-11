-- Add canonical Recovery subscriptions as renewal reminder targets without
-- rewriting or deleting historical deliveries tied to the legacy ledger.
alter table renewal_alert_deliveries
  alter column recurring_item_id drop not null;

alter table renewal_alert_deliveries
  add column if not exists recovery_commitment_id uuid;

alter table renewal_alert_deliveries
  drop constraint if exists renewal_alert_deliveries_recovery_commitment_fkey;
alter table renewal_alert_deliveries
  add constraint renewal_alert_deliveries_recovery_commitment_fkey
  foreign key (workspace_id, recovery_commitment_id)
  references recovery_commitments(workspace_id, id) on delete cascade;

alter table renewal_alert_deliveries
  drop constraint if exists renewal_alert_deliveries_exactly_one_target_check;
alter table renewal_alert_deliveries
  add constraint renewal_alert_deliveries_exactly_one_target_check
  check (num_nonnulls(recurring_item_id, recovery_commitment_id) = 1);

create unique index if not exists renewal_alert_deliveries_recovery_unique_idx
  on renewal_alert_deliveries(preference_id, recovery_commitment_id, alert_window, renewal_date)
  where recovery_commitment_id is not null;

create index if not exists renewal_alert_deliveries_recovery_target_idx
  on renewal_alert_deliveries(workspace_id, recovery_commitment_id)
  where recovery_commitment_id is not null;

-- The candidate retention worker reports terminal inbound-event deletion while
-- 0026 is deliberately held back for the post-deploy worker-drain cutover.
alter table retention_runs drop constraint if exists retention_runs_counts_check;
alter table retention_runs drop constraint if exists retention_runs_counts_check1;
alter table retention_runs drop constraint if exists retention_runs_counts_check2;
alter table retention_runs drop constraint if exists retention_runs_counts_object_check;
alter table retention_runs drop constraint if exists retention_runs_counts_keys_check;
alter table retention_runs drop constraint if exists retention_runs_counts_types_check;

alter table retention_runs
  add constraint retention_runs_counts_object_check
    check (jsonb_typeof(counts) = 'object'),
  add constraint retention_runs_counts_keys_check
    check ((counts - array[
      'connectorEvidencePayloadsMinimized',
      'recoveryRawEvidenceMinimized',
      'recoveryInboundEventsDeleted',
      'webhookPayloadsMinimized',
      'webhookErrorsMinimized',
      'connectorTransactionRowsMinimized',
      'productEventsDeleted',
      'syncRunErrorsMinimized',
      'syncJobErrorsMinimized',
      'connectedAccountErrorsMinimized',
      'dataSubjectRequestsDeleted',
      'retentionRunsDeleted'
    ]::text[]) = '{}'::jsonb),
  add constraint retention_runs_counts_types_check
    check (
      coalesce(jsonb_typeof(counts -> 'connectorEvidencePayloadsMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'recoveryRawEvidenceMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'recoveryInboundEventsDeleted') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'webhookPayloadsMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'webhookErrorsMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'connectorTransactionRowsMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'productEventsDeleted') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'syncRunErrorsMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'syncJobErrorsMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'connectedAccountErrorsMinimized') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'dataSubjectRequestsDeleted') = 'number', true)
      and coalesce(jsonb_typeof(counts -> 'retentionRunsDeleted') = 'number', true)
    );
