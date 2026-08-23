-- Freeze the amount the founder saw when the cycle was decided.
-- Additive. Does not backfill. Legacy rows stay null.
-- AMOUNT_DIFFERED is reserved for P1 verdict honesty and is not written here.

alter table recovery_decision_cycles
  add column if not exists expected_amount_minor bigint;

alter table recovery_decision_cycles
  drop constraint if exists recovery_decision_cycles_verification_outcome_check;

alter table recovery_decision_cycles
  add constraint recovery_decision_cycles_verification_outcome_check
  check (
    verification_outcome is null
    or verification_outcome in (
      'CHARGE_ARRIVED',
      'NO_CHARGE_IN_WINDOW',
      'CANNOT_EVALUATE',
      'AMOUNT_DIFFERED'
    )
  );
