alter table consent_grants
  add column if not exists resource_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'consent_grants_resource_key_check'
  ) then
    alter table consent_grants
      add constraint consent_grants_resource_key_check
      check (resource_key is null or length(btrim(resource_key)) between 1 and 240);
  end if;
end $$;

drop index if exists consent_grants_active_workspace_user_purpose_idx;

with duplicate_active_grants as (
  select id,
         row_number() over (
           partition by workspace_id, user_id, purpose, coalesce(resource_key, '')
           order by granted_at desc, id desc
         ) as active_rank
  from consent_grants
  where withdrawn_at is null
    and workspace_id is not null
    and user_id is not null
)
update consent_grants consent
set withdrawn_at = greatest(consent.granted_at, now())
from duplicate_active_grants duplicate
where consent.id = duplicate.id
  and duplicate.active_rank > 1;

create unique index if not exists consent_grants_active_workspace_user_purpose_resource_idx
  on consent_grants(workspace_id, user_id, purpose, coalesce(resource_key, ''))
  where withdrawn_at is null and workspace_id is not null and user_id is not null;

alter table connected_accounts
  add column if not exists consent_grant_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'connected_accounts_consent_grant_fk'
  ) then
    alter table connected_accounts
      add constraint connected_accounts_consent_grant_fk
      foreign key (consent_grant_id) references consent_grants(id) on delete restrict;
  end if;
end $$;

create index if not exists connected_accounts_consent_grant_idx
  on connected_accounts(consent_grant_id);

update connected_accounts
set status = 'needs_reauth',
    last_error = 'Reconnect to record purpose-specific connector consent.',
    last_error_at = now(),
    updated_at = now()
where status = 'active'
  and consent_grant_id is null;

update connector_sync_jobs job
set status = 'blocked',
    next_run_at = null,
    locked_at = null,
    locked_by = null,
    last_error = 'Connector consent must be renewed before synchronization.',
    last_error_at = now(),
    updated_at = now()
where status in ('queued', 'running', 'failed', 'paused')
  and exists (
    select 1
    from connected_accounts account
    where account.id = job.connected_account_id
      and account.consent_grant_id is null
  );