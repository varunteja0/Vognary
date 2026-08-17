-- Sender provenance for forwarded receipt mail.
--
-- Mail authentication is an assertion made by some other party. This table
-- records who asserted what for each forwarded receipt, so a claim can always
-- name its authority. Nothing here re-verifies cryptography: a stored DKIM
-- signing domain proves only that a signature was attached. Financial facts
-- still materialize solely through recovery_sources, recovery_evidence, and
-- recovery_commitments.
create table if not exists recovery_inbound_sender_assessments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- Transport reference only; it is released when the operational retention
  -- window clears the inbound event, and the assessment survives.
  inbound_event_id uuid,
  client_ref text not null check (length(btrim(client_ref)) between 1 and 240),
  -- Null when the receipt was rejected before a canonical source existed.
  source_id uuid,
  trust_tier text not null check (
    trust_tier in ('VERIFIED_SENDER', 'KNOWN_SENDER', 'UNVERIFIED_SENDER', 'SUSPICIOUS_SENDER')
  ),
  from_domain text check (
    from_domain is null
    or (from_domain = lower(btrim(from_domain)) and length(from_domain) between 3 and 253)
  ),
  trusted_authority text check (
    trusted_authority is null
    or (trusted_authority = lower(btrim(trusted_authority)) and length(trusted_authority) between 1 and 253)
  ),
  assertions jsonb not null default '[]'::jsonb check (jsonb_typeof(assertions) = 'array'),
  signing_domains text[] not null default '{}',
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  assessed_at timestamptz not null default now(),
  foreign key (workspace_id, inbound_event_id)
    references recovery_inbound_events(workspace_id, id) on delete set null (inbound_event_id),
  foreign key (workspace_id, source_id)
    references recovery_sources(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  unique (workspace_id, inbound_event_id, client_ref),
  -- Verification must always name the authority that asserted it, and an
  -- unattributed sender can never be recorded as verified.
  constraint recovery_inbound_sender_assessments_verified_needs_authority_check
    check (trust_tier <> 'VERIFIED_SENDER' or (trusted_authority is not null and from_domain is not null))
);

create index if not exists recovery_inbound_sender_assessments_known_domain_idx
  on recovery_inbound_sender_assessments(workspace_id, from_domain)
  where source_id is not null and from_domain is not null;
create index if not exists recovery_inbound_sender_assessments_source_idx
  on recovery_inbound_sender_assessments(workspace_id, source_id);

create or replace function reject_recovery_sender_assessment_mutation()
returns trigger
language plpgsql
as $$
begin
  -- Releasing the retained transport reference is the one permitted update.
  if tg_op = 'UPDATE'
    and old.inbound_event_id is not null
    and new.inbound_event_id is null
    and (to_jsonb(new) - 'inbound_event_id') = (to_jsonb(old) - 'inbound_event_id')
  then
    return new;
  end if;
  -- A whole-workspace privacy deletion is the only destructive path. The parent
  -- row has already gone by the time its cascading delete arrives here.
  if tg_op = 'DELETE'
    and not exists (select 1 from workspaces where id = old.workspace_id)
  then
    return old;
  end if;
  raise exception 'Recovery sender assessments are immutable.' using errcode = '55000';
end;
$$;

drop trigger if exists recovery_inbound_sender_assessments_immutable_trigger
  on recovery_inbound_sender_assessments;
create trigger recovery_inbound_sender_assessments_immutable_trigger
  before update or delete on recovery_inbound_sender_assessments
  for each row execute function reject_recovery_sender_assessment_mutation();
