-- Recovery v1 keeps user-submitted raw evidence encrypted, extracted evidence
-- immutable, and every projection reconstructible from a workspace version.
create table if not exists recovery_workspace_states (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  version bigint not null default 0 check (version >= 0),
  baseline_version bigint check (baseline_version is null or baseline_version > 0),
  latest_changed_state text not null default 'NO_PRIOR_BASELINE'
    check (latest_changed_state in ('NO_PRIOR_BASELINE', 'COMPARED')),
  latest_from_version bigint check (latest_from_version is null or latest_from_version >= 0),
  latest_changed_version bigint check (latest_changed_version is null or latest_changed_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (latest_changed_state = 'NO_PRIOR_BASELINE' and latest_from_version is null and latest_changed_version is null)
    or (latest_changed_state = 'COMPARED' and latest_from_version is not null
      and latest_changed_version is not null and latest_changed_version > latest_from_version)
  )
);

create table if not exists recovery_workspace_versions (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  version bigint not null check (version > 0),
  actor_user_id uuid references users(id) on delete set null,
  mutation_kind text not null check (mutation_kind in ('EVIDENCE', 'CORRECTION', 'CORRECTION_REVERSAL', 'DECISION')),
  changed_state text not null check (changed_state in ('NO_PRIOR_BASELINE', 'COMPARED')),
  from_version bigint check (from_version is null or from_version >= 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, version),
  check (
    (changed_state = 'NO_PRIOR_BASELINE' and from_version is null)
    or (changed_state = 'COMPARED' and from_version is not null)
  )
);

create table if not exists recovery_submissions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  submitted_by_user_id uuid references users(id) on delete set null,
  source_type text not null check (source_type in ('RECEIPT_PASTE', 'CSV_IMPORT')),
  accepted_evidence_count integer not null default 0 check (accepted_evidence_count >= 0),
  results jsonb not null default '[]'::jsonb check (jsonb_typeof(results) = 'array'),
  ingested_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create table if not exists recovery_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  submission_id uuid not null,
  source_type text not null check (source_type in ('RECEIPT_PASTE', 'CSV_IMPORT')),
  client_ref text not null check (length(btrim(client_ref)) between 1 and 240),
  label text not null check (length(btrim(label)) between 1 and 240),
  content_hash char(64) not null check (content_hash ~ '^[0-9a-f]{64}$'),
  raw_evidence jsonb not null check (jsonb_typeof(raw_evidence) = 'object'),
  raw_minimized_at timestamptz,
  coverage_start date,
  coverage_end date,
  ingested_at timestamptz not null default now(),
  foreign key (workspace_id, submission_id)
    references recovery_submissions(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  unique (workspace_id, content_hash),
  check (coverage_start is null or coverage_end is null or coverage_start <= coverage_end)
);

create table if not exists recovery_commitments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  identity_key text not null check (length(btrim(identity_key)) between 3 and 500),
  version bigint not null default 1 check (version > 0),
  base_status text not null check (base_status in ('ACTIVE', 'NOT_RECURRING')),
  base_merchant text not null check (length(btrim(base_merchant)) between 1 and 240),
  base_category text not null check (length(btrim(base_category)) between 1 and 120),
  base_cadence text not null check (base_cadence in ('WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'YEARLY', 'IRREGULAR')),
  base_currency char(3) not null check (base_currency ~ '^[A-Z]{3}$'),
  base_amount_minor bigint not null check (base_amount_minor >= 0),
  base_monthly_minor bigint not null check (base_monthly_minor >= 0),
  base_next_expected_date date,
  effective_status text not null check (effective_status in ('ACTIVE', 'NOT_RECURRING')),
  effective_merchant text not null check (length(btrim(effective_merchant)) between 1 and 240),
  effective_cadence text not null check (effective_cadence in ('WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'YEARLY', 'IRREGULAR')),
  effective_amount_minor bigint not null check (effective_amount_minor >= 0),
  effective_monthly_minor bigint not null check (effective_monthly_minor >= 0),
  effective_next_expected_date date,
  confidence_score integer not null check (confidence_score between 0 and 100),
  confidence_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(confidence_reasons) = 'array'),
  recommended_decision text not null check (recommended_decision in ('KEEP', 'MONITOR', 'DOWNGRADE', 'CANCEL', 'INVESTIGATE')),
  recommendation_reason text not null,
  risk_tags text[] not null default '{}',
  first_detected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, identity_key),
  unique (workspace_id, id)
);

create table if not exists recovery_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_id uuid not null,
  fingerprint char(64) not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  immutable boolean not null default true check (immutable),
  evidence_kind text not null check (evidence_kind in ('TRANSACTION', 'RECEIPT')),
  row_number integer not null check (row_number > 0),
  observed_at timestamptz,
  excerpt text not null check (length(excerpt) between 1 and 500),
  excerpt_truncated boolean not null default false,
  merchant text not null check (length(btrim(merchant)) between 1 and 240),
  normalized_merchant text not null check (length(btrim(normalized_merchant)) between 1 and 240),
  category text not null check (length(btrim(category)) between 1 and 120),
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  currency char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  evidence_date date,
  direction text check (direction is null or direction in ('debit', 'credit', 'unknown')),
  cadence_hint text check (cadence_hint is null or cadence_hint in ('WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'YEARLY', 'IRREGULAR')),
  next_expected_date date,
  provenance_kind text not null default 'USER_SUBMITTED' check (provenance_kind = 'USER_SUBMITTED'),
  provenance_reference text not null check (length(btrim(provenance_reference)) between 1 and 500),
  confidence_state text not null check (confidence_state in ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN')),
  confidence_score integer check (confidence_score is null or confidence_score between 0 and 100),
  confidence_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(confidence_reasons) = 'array'),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, source_id)
    references recovery_sources(workspace_id, id) on delete cascade,
  unique (workspace_id, fingerprint),
  unique (workspace_id, id)
);

create or replace function reject_recovery_evidence_mutation()
returns trigger
language plpgsql
as $$
begin
  -- A whole-workspace privacy deletion is the only destructive path. The
  -- parent row has already gone by the time its cascading delete reaches the
  -- evidence table; every direct update/delete remains forbidden.
  if tg_op = 'DELETE'
    and not exists (select 1 from workspaces where id = old.workspace_id)
  then
    return old;
  end if;
  raise exception 'Recovery evidence is immutable.' using errcode = '55000';
end;
$$;

drop trigger if exists recovery_evidence_immutable_trigger on recovery_evidence;
create trigger recovery_evidence_immutable_trigger
  before update or delete on recovery_evidence
  for each row execute function reject_recovery_evidence_mutation();

create table if not exists recovery_commitment_evidence (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  commitment_id uuid not null,
  evidence_id uuid not null,
  linked_at timestamptz not null default now(),
  primary key (workspace_id, commitment_id, evidence_id),
  foreign key (workspace_id, commitment_id)
    references recovery_commitments(workspace_id, id) on delete cascade,
  foreign key (workspace_id, evidence_id)
    references recovery_evidence(workspace_id, id) on delete cascade
);

create table if not exists recovery_corrections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  commitment_id uuid not null,
  created_by_user_id uuid references users(id) on delete set null,
  field text not null check (field in ('MERCHANT', 'AMOUNT', 'NEXT_EXPECTED_DATE', 'CADENCE', 'IS_RECURRING')),
  patch jsonb not null check (jsonb_typeof(patch) = 'object'),
  reason text check (reason is null or length(reason) <= 1000),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVERSED', 'SUPERSEDED')),
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  superseded_at timestamptz,
  foreign key (workspace_id, commitment_id)
    references recovery_commitments(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  check (
    (status = 'ACTIVE' and reversed_at is null and superseded_at is null)
    or (status = 'REVERSED' and reversed_at is not null and superseded_at is null)
    or (status = 'SUPERSEDED' and reversed_at is null and superseded_at is not null)
  )
);

create unique index if not exists recovery_corrections_active_field_idx
  on recovery_corrections(workspace_id, commitment_id, field)
  where status = 'ACTIVE';

create table if not exists recovery_decisions (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  commitment_id uuid not null,
  decided_by_user_id uuid references users(id) on delete set null,
  decision text not null check (decision in ('KEEP', 'MONITOR', 'DOWNGRADE', 'CANCEL', 'INVESTIGATE')),
  decided_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, commitment_id),
  foreign key (workspace_id, commitment_id)
    references recovery_commitments(workspace_id, id) on delete cascade
);

create table if not exists recovery_changes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  commitment_id uuid not null,
  from_version bigint not null check (from_version >= 0),
  to_version bigint not null check (to_version > from_version),
  kind text not null check (kind in ('ADDED', 'MERCHANT', 'AMOUNT', 'DATE', 'CADENCE', 'RECURRING_CLASSIFICATION')),
  merchant text not null,
  before_value jsonb,
  after_value jsonb,
  provenance_kind text not null check (provenance_kind in ('EVIDENCE', 'CORRECTION', 'CORRECTION_REVERSAL')),
  evidence_submission_id uuid,
  correction_id uuid,
  evidence_ids uuid[] not null default '{}',
  detected_at timestamptz not null default now(),
  foreign key (workspace_id, commitment_id)
    references recovery_commitments(workspace_id, id) on delete cascade,
  foreign key (workspace_id, evidence_submission_id)
    references recovery_submissions(workspace_id, id) on delete cascade,
  foreign key (workspace_id, correction_id)
    references recovery_corrections(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  check (
    (provenance_kind = 'EVIDENCE' and evidence_submission_id is not null
      and correction_id is null and cardinality(evidence_ids) > 0)
    or (provenance_kind in ('CORRECTION', 'CORRECTION_REVERSAL')
      and evidence_submission_id is null and correction_id is not null
      and cardinality(evidence_ids) = 0)
  )
);

create table if not exists recovery_idempotency_keys (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 8 and 160),
  operation text not null check (length(operation) between 3 and 120),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response_payload jsonb not null check (jsonb_typeof(response_payload) = 'object'),
  workspace_version bigint not null check (workspace_version >= 0),
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key),
  unique (workspace_id, idempotency_key)
);

create index if not exists recovery_workspace_versions_created_idx
  on recovery_workspace_versions(workspace_id, created_at desc);
create index if not exists recovery_sources_ingested_idx
  on recovery_sources(workspace_id, ingested_at desc);
create index if not exists recovery_sources_retention_idx
  on recovery_sources(workspace_id, ingested_at)
  where raw_minimized_at is null and raw_evidence <> '{}'::jsonb;
create index if not exists recovery_commitments_next_idx
  on recovery_commitments(workspace_id, effective_status, effective_next_expected_date);
create index if not exists recovery_commitments_page_idx
  on recovery_commitments(workspace_id, updated_at desc, id desc);
create index if not exists recovery_evidence_created_idx
  on recovery_evidence(workspace_id, created_at, id);
create index if not exists recovery_evidence_source_idx
  on recovery_evidence(workspace_id, source_id);
create index if not exists recovery_commitment_evidence_page_idx
  on recovery_commitment_evidence(workspace_id, commitment_id, linked_at desc, evidence_id);
create index if not exists recovery_corrections_history_idx
  on recovery_corrections(workspace_id, commitment_id, created_at desc, id desc);
create index if not exists recovery_changes_version_idx
  on recovery_changes(workspace_id, to_version, detected_at, id);

-- Recovery raw evidence follows the existing workspace raw-payload retention
-- policy. Extracted evidence, content hashes, provenance, and projections stay.
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
