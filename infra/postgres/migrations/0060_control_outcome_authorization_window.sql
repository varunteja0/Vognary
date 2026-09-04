-- Commitment Control: frozen intended outcome, authorization expiry, and the
-- observed outcome recorded at reconciliation. Additive columns only.
-- Legacy rows stay null. Nothing here auto-expires, denies, or moves money.

alter table commitment_control_proposals
  add column if not exists intended_outcome_metric text
    check (intended_outcome_metric is null
      or length(btrim(intended_outcome_metric)) between 1 and 120),
  add column if not exists intended_outcome_direction text
    check (intended_outcome_direction is null
      or intended_outcome_direction in ('AT_LEAST', 'AT_MOST')),
  add column if not exists intended_outcome_target_value text
    check (intended_outcome_target_value is null
      or intended_outcome_target_value ~ '^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$'),
  add column if not exists intended_outcome_unit text
    check (intended_outcome_unit is null
      or length(btrim(intended_outcome_unit)) between 1 and 40),
  add column if not exists intended_outcome_review_on date;

alter table commitment_control_proposals
  drop constraint if exists commitment_control_proposals_intended_outcome_check;
alter table commitment_control_proposals
  add constraint commitment_control_proposals_intended_outcome_check check (
    num_nonnulls(
      intended_outcome_metric,
      intended_outcome_direction,
      intended_outcome_target_value,
      intended_outcome_unit,
      intended_outcome_review_on
    ) in (0, 5)
    and (intended_outcome_review_on is null or intended_outcome_review_on >= first_charge_date)
  );

alter table commitment_control_decisions
  add column if not exists authorization_expires_on date;

alter table commitment_control_decisions
  drop constraint if exists commitment_control_decisions_authorization_window_check;
alter table commitment_control_decisions
  add constraint commitment_control_decisions_authorization_window_check check (
    authorization_expires_on is null
    or (
      action <> 'DECLINE'
      and authorization_expires_on >= (decided_at at time zone 'UTC')::date
    )
  );

alter table commitment_control_reconciliations
  add column if not exists observed_outcome_value text
    check (observed_outcome_value is null
      or observed_outcome_value ~ '^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$'),
  add column if not exists observed_outcome_on date,
  add column if not exists outcome_observation_basis text
    check (outcome_observation_basis is null
      or outcome_observation_basis in ('USER_ENTERED_WITH_EVIDENCE_CITATION', 'NOT_OBSERVED')),
  add column if not exists outcome_verdict text
    check (outcome_verdict is null
      or outcome_verdict in ('MET', 'MISSED', 'NOT_OBSERVED'));

alter table commitment_control_reconciliations
  drop constraint if exists commitment_control_reconciliations_outcome_check;
alter table commitment_control_reconciliations
  add constraint commitment_control_reconciliations_outcome_check check (
    (
      outcome_verdict is null
      and observed_outcome_value is null
      and observed_outcome_on is null
      and outcome_observation_basis is null
    )
    or (
      outcome_verdict = 'NOT_OBSERVED'
      and observed_outcome_value is null
      and observed_outcome_on is null
      and outcome_observation_basis = 'NOT_OBSERVED'
    )
    or (
      outcome_verdict in ('MET', 'MISSED')
      and observed_outcome_value is not null
      and observed_outcome_on is not null
      and outcome_observation_basis = 'USER_ENTERED_WITH_EVIDENCE_CITATION'
    )
  );
