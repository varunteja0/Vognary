-- Pre-renewal decision cycles.
--
-- One remembered keep / review-later / plan-to-cancel per expected charge date.
-- Does not rewrite evidence, amounts, cadence, or the commitment graph.
-- Absence is never stored as cancellation.

create table if not exists recovery_decision_cycles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  commitment_id uuid not null,
  due_date date not null,
  stake_minor bigint,
  currency text not null,
  reason_keys text[] not null default '{}',
  user_action text not null check (user_action in ('KEEP', 'REVIEW_LATER', 'PLAN_TO_CANCEL')),
  review_at date,
  decided_at timestamptz not null default now(),
  decided_by_user_id uuid references users(id) on delete set null,
  verification_outcome text check (
    verification_outcome is null
    or verification_outcome in ('CHARGE_ARRIVED', 'NO_CHARGE_IN_WINDOW', 'CANNOT_EVALUATE')
  ),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, commitment_id, due_date),
  foreign key (workspace_id, commitment_id)
    references recovery_commitments(workspace_id, id) on delete cascade,
  check (
    (user_action = 'REVIEW_LATER' and review_at is not null)
    or (user_action <> 'REVIEW_LATER' and review_at is null)
  ),
  check (
    reason_keys <@ array[
      'RENEWS_SOON',
      'PRICE_INCREASE',
      'OVERLAP_NO_PURPOSE',
      'NEW_COMMITMENT',
      'IDENTITY_UNCERTAIN',
      'AMOUNT_CONFLICT',
      'NO_PRIOR_DECISION'
    ]::text[]
  )
);

create index if not exists recovery_decision_cycles_workspace_due_idx
  on recovery_decision_cycles (workspace_id, due_date);

-- Current stamp applies to the current expected charge date only. No invented history.
insert into recovery_decision_cycles (
  workspace_id,
  commitment_id,
  due_date,
  stake_minor,
  currency,
  reason_keys,
  user_action,
  review_at,
  decided_at,
  decided_by_user_id,
  created_at,
  updated_at
)
select
  decision.workspace_id,
  decision.commitment_id,
  (commitment.effective_next_expected_date)::date,
  case
    when commitment.effective_cadence = 'IRREGULAR' then null
    when commitment.effective_monthly_minor > 9223372036854775807 / 12 then null
    else commitment.effective_monthly_minor * 12
  end,
  commitment.base_currency,
  '{}'::text[],
  case decision.decision
    when 'KEEP' then 'KEEP'
    when 'MONITOR' then 'REVIEW_LATER'
    else 'PLAN_TO_CANCEL'
  end,
  case when decision.decision = 'MONITOR' then current_date else null end,
  decision.decided_at,
  decision.decided_by_user_id,
  now(),
  now()
from recovery_decisions decision
join recovery_commitments commitment
  on commitment.workspace_id = decision.workspace_id
 and commitment.id = decision.commitment_id
where decision.decision in ('KEEP', 'MONITOR', 'CANCEL')
  and commitment.effective_next_expected_date is not null
on conflict (workspace_id, commitment_id, due_date) do nothing;
