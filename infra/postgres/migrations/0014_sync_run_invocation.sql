alter table connector_sync_runs
  add column if not exists invocation text not null default 'internal-api'
    check (invocation in ('cron', 'internal-api', 'manual', 'initial-setup'));

create index if not exists connector_sync_runs_cron_evidence_idx
  on connector_sync_runs(finished_at desc)
  where invocation = 'cron' and status = 'succeeded' and evidence_written > 0;