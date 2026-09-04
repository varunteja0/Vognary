-- PostgreSQL truncates identifiers to 63 bytes. Replace both generated long
-- names with one short stable constraint name so the honest observation basis
-- is accepted and future migrations can address the constraint exactly.

alter table commitment_control_reconciliations
  drop constraint if exists commitment_control_reconciliati_outcome_observation_basis_check;
alter table commitment_control_reconciliations
  drop constraint if exists commitment_control_reconciliations_outcome_observation_basis_ch;
alter table commitment_control_reconciliations
  drop constraint if exists cc_reconciliations_outcome_basis_check;

alter table commitment_control_reconciliations
  add constraint cc_reconciliations_outcome_basis_check check (
    outcome_observation_basis is null
    or outcome_observation_basis in (
      'USER_ENTERED_OBSERVATION',
      'USER_ENTERED_WITH_EVIDENCE_CITATION',
      'NOT_OBSERVED'
    )
  );
