-- An expired-authorization verdict still describes an observed financial fact.
-- Require the complete comparable amount, currency, and frozen evidence date.

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
      and observed_amount_minor is not null
      and observed_currency is not null
      and observed_evidence_date is not null
    )
  );
