-- Correction learning dataset.
--
-- Every time a customer corrects the system, that is a labelled example. This
-- table is the schema and the seam, nothing more. Features are structural only:
-- the guard function below rejects any row carrying free text, an address, or a
-- nested object, so a merchant name or an email can never reach the dataset.
--
-- Nothing reads this to change behaviour yet. Priors are refused until there are
-- enough real corrections to justify them.
create or replace function recovery_features_are_structural(features jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(features) = 'object'
    and not exists (
      select 1
      from jsonb_each(features) as entry(feature_key, feature_value)
      where jsonb_typeof(entry.feature_value) not in ('string', 'number', 'boolean')
        or (
          jsonb_typeof(entry.feature_value) = 'string'
          and (
            length(entry.feature_value #>> '{}') > 60
            or entry.feature_value #>> '{}' like '%@%'
            or entry.feature_value #>> '{}' like '% %'
          )
        )
    );
$$;

create table if not exists recovery_correction_outcomes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null check (
    kind in (
      'MERCHANT_CORRECTED', 'MERCHANT_ALIAS_ADDED', 'CADENCE_CORRECTED', 'AMOUNT_CORRECTED',
      'DUPLICATE_MERGE_ACCEPTED', 'DUPLICATE_MERGE_REJECTED', 'LIFECYCLE_CORRECTED',
      'CANCELLATION_OUTCOME_RECORDED'
    )
  ),
  label text not null check (label in ('ACCEPTED', 'REJECTED', 'CHANGED')),
  feature_version text not null check (length(btrim(feature_version)) between 1 and 60),
  features jsonb not null check (recovery_features_are_structural(features)),
  cited_evidence_ids uuid[] not null default '{}',
  commitment_id uuid,
  correction_id uuid,
  idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 200),
  observed_at timestamptz not null default now(),
  foreign key (workspace_id, commitment_id)
    references recovery_commitments(workspace_id, id) on delete cascade,
  foreign key (workspace_id, correction_id)
    references recovery_corrections(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  unique (workspace_id, kind, idempotency_key)
);

create index if not exists recovery_correction_outcomes_kind_idx
  on recovery_correction_outcomes(workspace_id, kind, observed_at desc);

-- A correction outcome is a historical fact. It is append-only so the dataset
-- cannot be quietly reshaped, and whole-workspace erasure still cascades.
create or replace function reject_recovery_correction_outcome_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE'
    and not exists (select 1 from workspaces where id = old.workspace_id)
  then
    return old;
  end if;
  raise exception 'Recovery correction outcomes are append-only.' using errcode = '55000';
end;
$$;

drop trigger if exists recovery_correction_outcomes_append_only_trigger on recovery_correction_outcomes;
create trigger recovery_correction_outcomes_append_only_trigger
  before update or delete on recovery_correction_outcomes
  for each row execute function reject_recovery_correction_outcome_mutation();
