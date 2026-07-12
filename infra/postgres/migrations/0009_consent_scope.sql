with duplicate_active_grants as (
  select id,
         row_number() over (
           partition by workspace_id, user_id, purpose
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

create unique index if not exists consent_grants_active_workspace_user_purpose_idx
  on consent_grants(workspace_id, user_id, purpose)
  where withdrawn_at is null and workspace_id is not null and user_id is not null;