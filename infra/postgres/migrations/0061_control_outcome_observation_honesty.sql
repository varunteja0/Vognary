-- Outcome values are user-entered observations. The linked Recovery evidence
-- proves observed spend, not an arbitrary business metric. Keep the original
-- basis value readable for forward compatibility; all new writes use the
-- explicit user-entered label.

alter table commitment_control_reconciliations
  drop constraint if exists commitment_control_reconciliations_outcome_observation_basis_check;
alter table commitment_control_reconciliations
  add constraint commitment_control_reconciliations_outcome_observation_basis_check check (
    outcome_observation_basis is null
    or outcome_observation_basis in (
      'USER_ENTERED_OBSERVATION',
      'USER_ENTERED_WITH_EVIDENCE_CITATION',
      'NOT_OBSERVED'
    )
  );

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
      and outcome_observation_basis in (
        'USER_ENTERED_OBSERVATION',
        'USER_ENTERED_WITH_EVIDENCE_CITATION'
      )
    )
  );
