-- Freeze the cited financial evidence date into each new reconciliation and
-- distinguish spend observed after the human authorization window. Replace
-- generated long CHECK names with stable short names for future migrations.

alter table commitment_control_reconciliations
  add column if not exists observed_evidence_date date;

alter table commitment_control_reconciliations
  drop constraint if exists commitment_control_reconciliations_verdict_check;
alter table commitment_control_reconciliations
  drop constraint if exists cc_reconciliations_verdict_check;
alter table commitment_control_reconciliations
  add constraint cc_reconciliations_verdict_check check (
    verdict in (
      'MATCHED',
      'WITHIN_CAP',
      'OVER_CAP',
      'CURRENCY_MISMATCH',
      'CANNOT_EVALUATE',
      'AUTHORIZATION_EXPIRED'
    )
  );

alter table commitment_control_reconciliations
  drop constraint if exists commitment_control_reconciliations_check;
alter table commitment_control_reconciliations
  drop constraint if exists cc_reconciliations_cost_check;
alter table commitment_control_reconciliations
  add constraint cc_reconciliations_cost_check check (
    (
      verdict = 'CANNOT_EVALUATE'
      and (observed_amount_minor is null or observed_currency is null)
    )
    or (
      verdict = 'CURRENCY_MISMATCH'
      and observed_currency is not null
      and observed_currency <> authorization_currency
    )
    or (
      verdict in ('MATCHED', 'WITHIN_CAP', 'OVER_CAP')
      and observed_amount_minor is not null
      and observed_currency = authorization_currency
    )
    or (
      verdict = 'AUTHORIZATION_EXPIRED'
      and observed_evidence_date is not null
    )
  );

alter table commitment_control_proposals
  drop constraint if exists commitment_control_proposals_intended_outcome_target_valu_check;
alter table commitment_control_proposals
  drop constraint if exists cc_proposals_outcome_value_check;
alter table commitment_control_proposals
  add constraint cc_proposals_outcome_value_check check (
    intended_outcome_target_value is null
    or intended_outcome_target_value ~ '^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$'
  );
