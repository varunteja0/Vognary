-- Commitment Control V0: proposed obligation -> deterministic policy context ->
-- authorized human decision -> frozen cap -> cited Recovery reconciliation.
-- Additive only. No table here purchases, provisions, cancels, or moves money.

alter table recovery_workspace_versions
  drop constraint if exists recovery_workspace_versions_mutation_kind_check;
alter table recovery_workspace_versions
  add constraint recovery_workspace_versions_mutation_kind_check check (mutation_kind in (
    'EVIDENCE',
    'CORRECTION',
    'CORRECTION_REVERSAL',
    'DECISION',
    'MANDATE',
    'CANDIDATE',
    'CONTROL_POLICY',
    'CONTROL_PROPOSAL',
    'CONTROL_DECISION',
    'CONTROL_RECONCILIATION'
  ));

create table if not exists commitment_control_policies (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  version integer not null check (version > 0),
  category_rules jsonb not null check (jsonb_typeof(category_rules) = 'array'),
  currency_limits jsonb not null check (jsonb_typeof(currency_limits) = 'array'),
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, version)
);

create table if not exists commitment_control_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  submitted_by_user_id uuid references users(id) on delete set null,
  merchant text not null check (length(btrim(merchant)) between 1 and 240),
  purpose text not null check (length(btrim(purpose)) between 1 and 500),
  category text not null check (category in (
    'AI_MODEL', 'CLOUD_INFRASTRUCTURE', 'SOFTWARE', 'CONTRACTOR', 'CAMPAIGN', 'OTHER'
  )),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  first_charge_date date not null,
  cadence text not null check (cadence in (
    'ONE_TIME', 'WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'YEARLY'
  )),
  as_of_date date not null,
  projected_13_week_minor bigint not null check (projected_13_week_minor > 0),
  projected_annual_minor bigint not null check (projected_annual_minor > 0),
  assumption_basis text not null default 'USER_ENTERED_ASSUMPTION'
    check (assumption_basis = 'USER_ENTERED_ASSUMPTION'),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  check (first_charge_date >= as_of_date)
);

create index if not exists commitment_control_proposals_workspace_created_idx
  on commitment_control_proposals(workspace_id, created_at desc, id);

create table if not exists commitment_control_evaluations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  proposal_id uuid not null,
  policy_version integer not null,
  status text not null check (status in ('WITHIN_POLICY', 'REVIEW_REQUIRED', 'OUTSIDE_POLICY')),
  human_decision_required boolean not null default true check (human_decision_required),
  assumption_fields text[] not null check (assumption_fields = array[
    'amountMinor', 'currency', 'category', 'thirteenWeekMinor', 'annualMinor'
  ]::text[]),
  reason_codes text[] not null default '{}',
  currency_results jsonb not null check (jsonb_typeof(currency_results) = 'array'),
  evaluated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, proposal_id),
  foreign key (workspace_id, proposal_id)
    references commitment_control_proposals(workspace_id, id) on delete cascade,
  foreign key (workspace_id, policy_version)
    references commitment_control_policies(workspace_id, version) on delete restrict,
  check (reason_codes <@ array[
    'CATEGORY_POLICY_MISSING',
    'CATEGORY_REQUIRES_REVIEW',
    'CATEGORY_OUTSIDE_POLICY',
    'CURRENCY_POLICY_MISSING',
    'PER_CHARGE_LIMIT_EXCEEDED',
    'THIRTEEN_WEEK_LIMIT_EXCEEDED',
    'ANNUAL_LIMIT_EXCEEDED'
  ]::text[])
);

create table if not exists commitment_control_evaluation_evidence (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  evaluation_id uuid not null,
  evidence_id uuid not null,
  linked_at timestamptz not null default now(),
  primary key (workspace_id, evaluation_id, evidence_id),
  foreign key (workspace_id, evaluation_id)
    references commitment_control_evaluations(workspace_id, id) on delete cascade,
  foreign key (workspace_id, evidence_id)
    references recovery_evidence(workspace_id, id) on delete restrict
);

create table if not exists commitment_control_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  proposal_id uuid not null,
  evaluation_id uuid not null,
  action text not null check (action in ('APPROVE', 'APPROVE_WITH_CAP', 'DECLINE')),
  expected_amount_minor bigint not null check (expected_amount_minor > 0),
  approved_cap_minor bigint,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  decided_by_user_id uuid references users(id) on delete set null,
  decided_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, proposal_id),
  foreign key (workspace_id, proposal_id)
    references commitment_control_proposals(workspace_id, id) on delete cascade,
  foreign key (workspace_id, evaluation_id)
    references commitment_control_evaluations(workspace_id, id) on delete restrict,
  check (
    (action = 'DECLINE' and approved_cap_minor is null)
    or (action = 'APPROVE' and approved_cap_minor = expected_amount_minor)
    or (action = 'APPROVE_WITH_CAP' and approved_cap_minor > 0 and approved_cap_minor <= expected_amount_minor)
  )
);

create table if not exists commitment_control_reconciliations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  proposal_id uuid not null,
  decision_id uuid not null,
  evidence_id uuid not null,
  verdict text not null check (verdict in (
    'MATCHED', 'WITHIN_CAP', 'OVER_CAP', 'CURRENCY_MISMATCH', 'CANNOT_EVALUATE'
  )),
  expected_amount_minor bigint not null check (expected_amount_minor > 0),
  approved_cap_minor bigint,
  authorization_currency char(3) not null check (authorization_currency ~ '^[A-Z]{3}$'),
  observed_amount_minor bigint check (observed_amount_minor is null or observed_amount_minor >= 0),
  observed_currency char(3) check (observed_currency is null or observed_currency ~ '^[A-Z]{3}$'),
  reconciled_by_user_id uuid references users(id) on delete set null,
  reconciled_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, decision_id, evidence_id),
  foreign key (workspace_id, proposal_id)
    references commitment_control_proposals(workspace_id, id) on delete cascade,
  foreign key (workspace_id, decision_id)
    references commitment_control_decisions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, evidence_id)
    references recovery_evidence(workspace_id, id) on delete restrict,
  check (
    (verdict = 'CANNOT_EVALUATE' and (observed_amount_minor is null or observed_currency is null))
    or (verdict = 'CURRENCY_MISMATCH' and observed_currency is not null and observed_currency <> authorization_currency)
    or (verdict in ('MATCHED', 'WITHIN_CAP', 'OVER_CAP') and observed_amount_minor is not null and observed_currency = authorization_currency)
  )
);

create index if not exists commitment_control_reconciliations_proposal_idx
  on commitment_control_reconciliations(workspace_id, proposal_id, reconciled_at desc);

create or replace function commitment_control_reject_mutation()
returns trigger
language plpgsql
as $$
declare
  actor_column text;
  old_actor text;
  new_actor text;
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from workspaces where id = old.workspace_id) then
      raise exception '% cannot be deleted while the workspace exists.', tg_table_name using errcode = '55000';
    end if;
    return old;
  end if;

  actor_column := case tg_table_name
    when 'commitment_control_policies' then 'created_by_user_id'
    when 'commitment_control_proposals' then 'submitted_by_user_id'
    when 'commitment_control_decisions' then 'decided_by_user_id'
    when 'commitment_control_reconciliations' then 'reconciled_by_user_id'
    else null
  end;
  old_actor := case when actor_column is null then null else to_jsonb(old) ->> actor_column end;
  new_actor := case when actor_column is null then null else to_jsonb(new) ->> actor_column end;

  if actor_column is not null
    and old_actor is not null
    and new_actor is null
    and (to_jsonb(new) - actor_column) = (to_jsonb(old) - actor_column)
    and not exists (select 1 from users where id = old_actor::uuid)
  then
    return new;
  end if;
  raise exception '% cannot be updated.', tg_table_name using errcode = '55000';
end;
$$;

drop trigger if exists commitment_control_policies_immutable on commitment_control_policies;
create trigger commitment_control_policies_immutable before update or delete on commitment_control_policies
  for each row execute function commitment_control_reject_mutation();
drop trigger if exists commitment_control_proposals_immutable on commitment_control_proposals;
create trigger commitment_control_proposals_immutable before update or delete on commitment_control_proposals
  for each row execute function commitment_control_reject_mutation();
drop trigger if exists commitment_control_evaluations_immutable on commitment_control_evaluations;
create trigger commitment_control_evaluations_immutable before update or delete on commitment_control_evaluations
  for each row execute function commitment_control_reject_mutation();
drop trigger if exists commitment_control_evaluation_evidence_immutable on commitment_control_evaluation_evidence;
create trigger commitment_control_evaluation_evidence_immutable before update or delete on commitment_control_evaluation_evidence
  for each row execute function commitment_control_reject_mutation();
drop trigger if exists commitment_control_decisions_immutable on commitment_control_decisions;
create trigger commitment_control_decisions_immutable before update or delete on commitment_control_decisions
  for each row execute function commitment_control_reject_mutation();
drop trigger if exists commitment_control_reconciliations_immutable on commitment_control_reconciliations;
create trigger commitment_control_reconciliations_immutable before update or delete on commitment_control_reconciliations
  for each row execute function commitment_control_reject_mutation();

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
  'workspace.returned',
  'control.policy_recorded',
  'control.proposal_submitted',
  'control.decision_recorded',
  'control.reconciliation_recorded'
));