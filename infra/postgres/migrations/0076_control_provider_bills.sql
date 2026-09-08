alter table commitment_control_proposals add column amount_basis text
  check (amount_basis is null or amount_basis = 'GROSS_BILLED_TOTAL_PER_CHARGE');
alter table commitment_control_evaluations add column amount_basis text
  check (amount_basis is null or amount_basis = 'GROSS_BILLED_TOTAL_PER_CHARGE');
alter table commitment_control_decisions add column amount_basis text
  check (amount_basis is null or amount_basis = 'GROSS_BILLED_TOTAL_PER_CHARGE');

create function validate_control_amount_basis() returns trigger language plpgsql as $$
declare original_basis text;
begin
  select amount_basis into original_basis from commitment_control_proposals
    where workspace_id = new.workspace_id and id = new.proposal_id;
  if new.amount_basis is distinct from original_basis then
    raise exception 'Control amount basis must match the immutable proposal.';
  end if;
  if tg_table_name = 'commitment_control_decisions' then
    if not exists (
      select 1 from commitment_control_evaluations where workspace_id = new.workspace_id
        and id = new.evaluation_id and proposal_id = new.proposal_id
        and amount_basis is not distinct from new.amount_basis
    ) then raise exception 'Control amount basis must match the immutable evaluation.'; end if;
  end if;
  return new;
end;
$$;

create trigger control_evaluation_amount_basis before insert on commitment_control_evaluations
  for each row execute function validate_control_amount_basis();
create trigger control_decision_amount_basis before insert on commitment_control_decisions
  for each row execute function validate_control_amount_basis();

create table zoho_books_grants (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connection_id uuid not null,
  consent_generation bigint not null check (consent_generation > 0),
  authorized_by_user_id uuid references users(id) on delete set null,
  authorized_at timestamptz not null,
  notice_version text not null check (notice_version = 'zoho-books-read-v1'),
  scopes text[] not null check (scopes = array['ZohoBooks.settings.READ','ZohoBooks.bills.READ']),
  authorized_organization_ids text[] not null,
  region text not null check (region = 'IN'),
  unique (id, connection_id, workspace_id),
  unique (connection_id, consent_generation),
  foreign key (connection_id, workspace_id) references zoho_books_connections(id, workspace_id) on delete cascade
);

alter table zoho_books_connections add column active_grant_id uuid;
alter table zoho_books_connections add constraint zoho_books_active_grant_fk
  foreign key (active_grant_id, id, workspace_id) references zoho_books_grants(id, connection_id, workspace_id)
  deferrable initially deferred;
alter table zoho_books_snapshots add column grant_id uuid;
alter table zoho_books_snapshots add column organization_id text;
alter table zoho_books_snapshots add constraint zoho_books_snapshot_grant_fk
  foreign key (grant_id, connection_id, workspace_id) references zoho_books_grants(id, connection_id, workspace_id)
  on delete cascade;
alter table zoho_books_snapshots add constraint zoho_books_snapshot_binding_check
  check ((grant_id is null and organization_id is null)
    or (grant_id is not null and organization_id is not null and organization_id ~ '^[0-9]{1,64}$'));

create function validate_zoho_books_grant() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from zoho_books_connections connection
    where connection.id = new.connection_id and connection.workspace_id = new.workspace_id
      and connection.status = 'AUTHORIZING' and connection.generation = new.consent_generation
      and connection.authorized_by_user_id = new.authorized_by_user_id and connection.refresh_secret is not null)
  then raise exception 'The original source grant requires the current completed authorization.'; end if;
  return new;
end;
$$;
create trigger zoho_books_grant_valid before insert on zoho_books_grants
  for each row execute function validate_zoho_books_grant();

create function reject_zoho_books_grant_mutation() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from zoho_books_connections where id = old.connection_id)
      or not exists (select 1 from workspaces where id = old.workspace_id) then return old; end if;
  elsif old.authorized_by_user_id is not null and new.authorized_by_user_id is null
    and (to_jsonb(new) - 'authorized_by_user_id') = (to_jsonb(old) - 'authorized_by_user_id')
    and not exists (select 1 from users where id = old.authorized_by_user_id) then return new;
  end if;
  raise exception 'Original Books grants are immutable.' using errcode = '55000';
end;
$$;
create trigger zoho_books_grant_immutable before update or delete on zoho_books_grants
  for each row execute function reject_zoho_books_grant_mutation();

create function validate_zoho_books_source_identity() returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id
    or (old.organization_id is not null and new.organization_id is distinct from old.organization_id)
  then raise exception 'Books source workspace and original organization are immutable; erase and reconnect to change them.'; end if;
  if (old.organization_id is null and new.organization_id is not null)
    or (old.status = 'AWAITING_ORGANIZATION' and new.status = 'QUEUED') then
    if old.status <> 'AWAITING_ORGANIZATION' or new.status <> 'QUEUED' or not exists (
      select 1 from jsonb_array_elements(old.organizations) organization
      where organization->>'id' = new.organization_id and organization->>'active' = 'true'
    ) or not exists (
      select 1 from zoho_books_grants where id = new.active_grant_id and connection_id = new.id
        and workspace_id = new.workspace_id and new.organization_id = any(authorized_organization_ids)
    ) then raise exception 'Choose an active organization from the original authorized account and grant.'; end if;
  end if;
  if new.active_grant_id is not null and new.active_grant_id is distinct from old.active_grant_id then
    if old.status <> 'AUTHORIZING' or new.status <> 'AWAITING_ORGANIZATION' or not exists (
      select 1 from zoho_books_grants where id = new.active_grant_id and connection_id = new.id
        and workspace_id = new.workspace_id and consent_generation = new.generation
        and authorized_by_user_id = new.authorized_by_user_id
    ) then raise exception 'An active source grant requires its original authorization.'; end if;
  end if;
  return new;
end;
$$;
create trigger zoho_books_source_identity before update on zoho_books_connections
  for each row execute function validate_zoho_books_source_identity();

create function validate_zoho_books_snapshot_grant() returns trigger language plpgsql as $$
begin
  if new.grant_id is not null then
    if not exists (select 1 from zoho_books_connections connection
      join zoho_books_grants grant_record on grant_record.id = connection.active_grant_id
        and grant_record.connection_id = connection.id and grant_record.workspace_id = connection.workspace_id
      where connection.id = new.connection_id and connection.workspace_id = new.workspace_id
        and connection.organization_id = new.organization_id and grant_record.id = new.grant_id
        and new.organization_id = any(grant_record.authorized_organization_ids)
        and connection.status in ('QUEUED','SYNCING','READY')
        and grant_record.authorized_at <= new.observed_at
        and new.bill->>'version' = '1' and new.bill->>'basis' = 'PROVIDER_BILL_TOTAL')
    then raise exception 'Snapshot organization and original source grant must match at capture.'; end if;
  end if;
  return new;
end;
$$;
create trigger zoho_books_snapshot_grant_valid before insert on zoho_books_snapshots
  for each row execute function validate_zoho_books_snapshot_grant();

alter table recovery_submissions drop constraint recovery_submissions_source_type_check;
alter table recovery_submissions add constraint recovery_submissions_source_type_check
  check (source_type in ('RECEIPT_PASTE','CSV_IMPORT','FORWARDED_EMAIL','GMAIL_OAUTH','ZOHO_BOOKS'));
alter table recovery_sources drop constraint recovery_sources_source_type_check;
alter table recovery_sources add constraint recovery_sources_source_type_check
  check (source_type in ('RECEIPT_PASTE','CSV_IMPORT','FORWARDED_EMAIL','GMAIL_OAUTH','ZOHO_BOOKS'));
alter table recovery_evidence drop constraint recovery_evidence_evidence_kind_check;
alter table recovery_evidence add constraint recovery_evidence_evidence_kind_check
  check (evidence_kind in ('TRANSACTION','RECEIPT','PROVIDER_BILL'));
alter table recovery_evidence add column evidence_basis text;
alter table recovery_evidence alter column excerpt drop not null;
alter table recovery_evidence drop constraint recovery_evidence_excerpt_check;
alter table recovery_evidence add constraint recovery_evidence_excerpt_check check (
  (evidence_kind = 'PROVIDER_BILL' and excerpt is null)
  or (evidence_kind in ('TRANSACTION','RECEIPT') and excerpt is not null and length(excerpt) between 1 and 500)
);
alter table recovery_evidence add constraint recovery_provider_bill_shape check (
  (evidence_kind in ('TRANSACTION','RECEIPT') and evidence_basis is null)
  or (evidence_kind = 'PROVIDER_BILL' and evidence_basis is not distinct from 'PROVIDER_BILL_TOTAL'
    and observed_at is null and amount_minor is not null and amount_minor > 0
    and currency is not null and evidence_date is not null and direction is not distinct from 'unknown'
    and cadence_hint is null and next_expected_date is null and category = 'UNCLASSIFIED'
    and provenance_kind = 'PROVIDER_RECEIVED' and confidence_state = 'UNKNOWN' and confidence_score is null)
);

create table recovery_provider_bill_links (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  evidence_id uuid not null,
  connection_id uuid not null,
  organization_id text not null check (organization_id ~ '^[0-9]{1,64}$'),
  bill_id text not null check (bill_id ~ '^[0-9]{1,64}$'),
  source_sequence bigint not null check (source_sequence > 0),
  source_version integer not null check (source_version = 1),
  source_fingerprint char(64) not null check (source_fingerprint ~ '^[a-f0-9]{64}$'),
  source_observed_at timestamptz not null,
  provider_modified_at timestamptz not null,
  bill_date date not null,
  bill_status text not null check (bill_status in ('open','approved','overdue','partially_paid','paid')),
  change_kind text not null check (change_kind in ('BASELINE','NEW','AMENDED')),
  total_minor bigint not null check (total_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  source_total text not null,
  vendor_name text not null,
  bill_number text not null,
  consent_reference uuid not null,
  consent_generation bigint not null check (consent_generation > 0),
  consent_notice_version text not null check (consent_notice_version = 'zoho-books-read-v1'),
  consent_scopes text[] not null check (consent_scopes = array['ZohoBooks.settings.READ','ZohoBooks.bills.READ']),
  consent_authorized_by_user_id uuid references users(id) on delete set null,
  consent_authorized_at timestamptz not null,
  region text not null check (region = 'IN'),
  connection_revision bigint not null check (connection_revision > 0),
  last_successful_sync_at timestamptz not null,
  selected_by_user_id uuid references users(id) on delete set null,
  selected_at timestamptz not null,
  relation_basis text not null check (relation_basis = 'USER_CONFIRMED_SAME_CHARGE'),
  retention_notice text not null check (retention_notice = 'control-provider-bill-retention-v1'),
  primary key (workspace_id, evidence_id),
  unique (workspace_id, connection_id, source_sequence),
  foreign key (workspace_id, evidence_id) references recovery_evidence(workspace_id, id) on delete cascade,
  check (consent_authorized_at <= source_observed_at and source_observed_at <= selected_at
    and source_observed_at <= last_successful_sync_at and last_successful_sync_at <= selected_at
    and provider_modified_at <= selected_at)
);

create function validate_recovery_provider_bill_link() returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from zoho_books_snapshots snapshot
    join zoho_books_grants grant_record on grant_record.id = snapshot.grant_id
      and grant_record.connection_id = snapshot.connection_id and grant_record.workspace_id = snapshot.workspace_id
    join zoho_books_connections connection on connection.id = snapshot.connection_id and connection.workspace_id = snapshot.workspace_id
    join zoho_books_records record on record.connection_id = snapshot.connection_id
      and record.workspace_id = snapshot.workspace_id and record.bill_id = snapshot.bill_id and record.latest_sequence = snapshot.sequence
    join recovery_evidence evidence on evidence.workspace_id = new.workspace_id and evidence.id = new.evidence_id
    join recovery_sources source on source.workspace_id = evidence.workspace_id and source.id = evidence.source_id
    where snapshot.workspace_id = new.workspace_id and snapshot.connection_id = new.connection_id
      and snapshot.sequence = new.source_sequence and snapshot.bill_id = new.bill_id
      and snapshot.organization_id = new.organization_id and connection.organization_id = new.organization_id
      and connection.active_grant_id = grant_record.id and connection.status = 'READY'
      and connection.revision = new.connection_revision and connection.refresh_secret is not null
      and connection.last_error_code is null and not record.deleted
      and connection.last_success_at = new.last_successful_sync_at
      and connection.last_success_at <= new.selected_at and connection.last_success_at >= new.selected_at - interval '24 hours'
      and connection.next_run_at >= new.selected_at and connection.next_run_at <= connection.last_success_at + interval '24 hours'
      and snapshot.fingerprint = new.source_fingerprint and snapshot.observed_at = new.source_observed_at
      and snapshot.change_kind = new.change_kind and (snapshot.bill->>'version')::integer = new.source_version
      and (snapshot.bill->>'modifiedAt')::timestamptz = new.provider_modified_at
      and (snapshot.bill->>'date')::date = new.bill_date and snapshot.bill->>'status' = new.bill_status
      and (snapshot.bill->>'totalMinor')::bigint = new.total_minor and snapshot.bill->>'currency' = new.currency
      and snapshot.bill->>'sourceTotal' = new.source_total and snapshot.bill->>'vendorName' = new.vendor_name
      and snapshot.bill->>'billNumber' = new.bill_number and snapshot.bill->>'basis' = 'PROVIDER_BILL_TOTAL'
      and grant_record.id = new.consent_reference and grant_record.consent_generation = new.consent_generation
      and grant_record.notice_version = new.consent_notice_version and grant_record.scopes = new.consent_scopes
      and grant_record.authorized_by_user_id = new.consent_authorized_by_user_id
      and grant_record.authorized_at = new.consent_authorized_at and grant_record.region = new.region
      and evidence.evidence_kind = 'PROVIDER_BILL' and evidence.evidence_basis = 'PROVIDER_BILL_TOTAL'
      and evidence.amount_minor = new.total_minor and evidence.currency = new.currency
      and evidence.evidence_date = new.bill_date and evidence.observed_at is null
      and evidence.merchant = new.vendor_name and source.source_type = 'ZOHO_BOOKS'
      and exists (select 1 from workspace_members where workspace_id = new.workspace_id
        and user_id = new.selected_by_user_id and role in ('owner','admin'))
      and exists (select 1 from workspace_members where workspace_id = new.workspace_id
        and user_id = grant_record.authorized_by_user_id and role in ('owner','admin'))
  ) then raise exception 'Admitted bill provenance must match its live original grant, organization, snapshot and canonical evidence.' using errcode = '23514'; end if;
  return new;
end;
$$;
create trigger recovery_provider_bill_link_valid before insert on recovery_provider_bill_links
  for each row execute function validate_recovery_provider_bill_link();

create function reject_recovery_provider_bill_link_mutation() returns trigger language plpgsql as $$
declare actor_column text;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from workspaces where id = old.workspace_id) then return old; end if;
  else
    foreach actor_column in array array['selected_by_user_id','consent_authorized_by_user_id'] loop
      if to_jsonb(old)->>actor_column is not null and to_jsonb(new)->>actor_column is null
        and (to_jsonb(new)-actor_column) = (to_jsonb(old)-actor_column)
        and not exists (select 1 from users where id = (to_jsonb(old)->>actor_column)::uuid) then return new; end if;
    end loop;
  end if;
  raise exception 'Admitted provider bill history is immutable; only whole-workspace erasure removes it.' using errcode = '55000';
end;
$$;
create trigger recovery_provider_bill_link_immutable before update or delete on recovery_provider_bill_links
  for each row execute function reject_recovery_provider_bill_link_mutation();

create function require_recovery_provider_bill_lineage() returns trigger language plpgsql as $$
begin
  if new.evidence_kind = 'PROVIDER_BILL' and not exists (
    select 1 from recovery_provider_bill_links where workspace_id = new.workspace_id and evidence_id = new.id
  ) then raise exception 'Provider bill evidence requires validated detached provenance.' using errcode = '23514'; end if;
  return new;
end;
$$;
create constraint trigger recovery_provider_bill_lineage_required after insert on recovery_evidence
  deferrable initially deferred for each row execute function require_recovery_provider_bill_lineage();

create function reject_provider_bill_exposure_link() returns trigger language plpgsql as $$
begin
  if exists (select 1 from recovery_evidence where workspace_id = new.workspace_id and id = new.evidence_id
    and evidence_kind not in ('TRANSACTION','RECEIPT')) then
    raise exception 'Provider bills are not recurring or exposure evidence.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger recovery_provider_bill_no_commitment before insert or update on recovery_commitment_evidence
  for each row execute function reject_provider_bill_exposure_link();
create trigger recovery_provider_bill_no_evaluation before insert or update on commitment_control_evaluation_evidence
  for each row execute function reject_provider_bill_exposure_link();

alter table commitment_control_reconciliations add column comparison_kind text;
alter table commitment_control_reconciliations add column decision_amount_basis text;
alter table commitment_control_reconciliations add column observed_evidence_basis text;
alter table commitment_control_reconciliations add column relation_basis text;
alter table commitment_control_reconciliations add column retention_notice text;
alter table commitment_control_reconciliations add constraint control_provider_comparison_shape check (
  (comparison_kind is null and decision_amount_basis is null and observed_evidence_basis is null and relation_basis is null and retention_notice is null)
  or (comparison_kind is not distinct from 'BILLED_AMOUNT_COMPARISON' and decision_amount_basis is not distinct from 'GROSS_BILLED_TOTAL_PER_CHARGE'
    and observed_evidence_basis is not distinct from 'PROVIDER_BILL_TOTAL' and relation_basis is not distinct from 'USER_CONFIRMED_SAME_CHARGE'
    and retention_notice is not distinct from 'control-provider-bill-retention-v1' and observed_outcome_value is null
    and observed_outcome_on is null and (outcome_verdict is null or outcome_verdict = 'NOT_OBSERVED'))
);

create function validate_control_provider_comparison() returns trigger language plpgsql as $$
declare evidence_kind_value text; decision_record commitment_control_decisions%rowtype; expected_verdict text;
begin
  select evidence_kind into evidence_kind_value from recovery_evidence where workspace_id = new.workspace_id and id = new.evidence_id;
  if evidence_kind_value = 'PROVIDER_BILL' or new.comparison_kind is not null then
    if not exists (
      select 1 from recovery_provider_bill_links admitted
      join zoho_books_connections connection on connection.id = admitted.connection_id and connection.workspace_id = admitted.workspace_id
      join zoho_books_records record on record.connection_id = admitted.connection_id and record.workspace_id = admitted.workspace_id
        and record.bill_id = admitted.bill_id and record.latest_sequence = admitted.source_sequence and not record.deleted
      join workspace_members selector on selector.workspace_id = admitted.workspace_id and selector.user_id = new.reconciled_by_user_id
      join users selector_user on selector_user.id = selector.user_id and selector_user.deleted_at is null
      join workspace_members authorizer on authorizer.workspace_id = admitted.workspace_id and authorizer.user_id = admitted.consent_authorized_by_user_id
      where admitted.workspace_id = new.workspace_id and admitted.evidence_id = new.evidence_id
        and connection.active_grant_id = admitted.consent_reference and connection.organization_id = admitted.organization_id
        and connection.status = 'READY' and connection.last_error_code is null and connection.refresh_secret is not null
        and connection.last_success_at <= new.reconciled_at and connection.last_success_at >= new.reconciled_at - interval '24 hours'
        and connection.next_run_at >= new.reconciled_at and connection.next_run_at <= connection.last_success_at + interval '24 hours'
        and selector.role in ('owner','admin') and authorizer.role in ('owner','admin')
    ) then raise exception 'A new billed comparison requires current source consent, latest snapshot, fresh sync and human authority.' using errcode = '23514'; end if;
    select * into decision_record from commitment_control_decisions where workspace_id = new.workspace_id and id = new.decision_id and proposal_id = new.proposal_id;
    if evidence_kind_value is distinct from 'PROVIDER_BILL' or new.comparison_kind is distinct from 'BILLED_AMOUNT_COMPARISON'
      or decision_record.amount_basis is distinct from 'GROSS_BILLED_TOTAL_PER_CHARGE'
      or decision_record.action = 'DECLINE' or decision_record.authorization_expires_on is null
      or new.expected_amount_minor is distinct from decision_record.expected_amount_minor
      or new.approved_cap_minor is distinct from decision_record.approved_cap_minor
      or new.authorization_currency is distinct from decision_record.currency
      or new.observed_evidence_date < (decision_record.decided_at at time zone 'Asia/Kolkata')::date
      or new.observed_evidence_date > (new.reconciled_at at time zone 'Asia/Kolkata')::date
      or not exists (select 1 from recovery_provider_bill_links where workspace_id = new.workspace_id and evidence_id = new.evidence_id
        and total_minor = new.observed_amount_minor and currency = new.observed_currency and bill_date = new.observed_evidence_date)
    then raise exception 'A billed comparison must bind exact provider evidence to the explicit original authorization.' using errcode = '23514'; end if;
    expected_verdict := case when new.observed_evidence_date > decision_record.authorization_expires_on then 'AUTHORIZATION_EXPIRED'
      when new.observed_currency <> new.authorization_currency then 'CURRENCY_MISMATCH'
      when new.observed_amount_minor > new.approved_cap_minor then 'OVER_CAP'
      when new.observed_amount_minor = new.expected_amount_minor then 'MATCHED' else 'WITHIN_CAP' end;
    if new.verdict is distinct from expected_verdict then raise exception 'Billed comparison verdict does not match the frozen exact amounts and dates.' using errcode = '23514'; end if;
  end if;
  return new;
end;
$$;
create trigger control_provider_comparison_valid before insert on commitment_control_reconciliations
  for each row execute function validate_control_provider_comparison();


