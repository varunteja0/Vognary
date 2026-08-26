-- Commitment Control authority hardening. Additive columns and a reason-code
-- expansion only. Does not rewrite 0057, auto-deny, or auto-approve.

alter table commitment_control_proposals
  add column if not exists submitted_by_display_name text
    check (submitted_by_display_name is null or length(btrim(submitted_by_display_name)) between 1 and 120);

alter table commitment_control_decisions
  add column if not exists decided_by_display_name text
    check (decided_by_display_name is null or length(btrim(decided_by_display_name)) between 1 and 120);

alter table commitment_control_decisions
  add column if not exists override_reason text
    check (override_reason is null or length(btrim(override_reason)) between 1 and 500);

alter table commitment_control_evaluations
  add column if not exists cited_exposure_basis text not null default 'NONE'
    check (cited_exposure_basis in ('NONE', 'PROJECTED', 'OBSERVATION_ONLY'));

alter table commitment_control_evaluations
  drop constraint if exists commitment_control_evaluations_reason_codes_check;
alter table commitment_control_evaluations
  add constraint commitment_control_evaluations_reason_codes_check check (reason_codes <@ array[
    'CATEGORY_POLICY_MISSING',
    'CATEGORY_REQUIRES_REVIEW',
    'CATEGORY_OUTSIDE_POLICY',
    'CURRENCY_POLICY_MISSING',
    'PER_CHARGE_LIMIT_EXCEEDED',
    'THIRTEEN_WEEK_LIMIT_EXCEEDED',
    'ANNUAL_LIMIT_EXCEEDED',
    'EXPOSURE_NOT_CITED'
  ]::text[]);

alter table commitment_control_decisions
  drop constraint if exists commitment_control_decisions_override_reason_action_check;
alter table commitment_control_decisions
  add constraint commitment_control_decisions_override_reason_action_check check (
    override_reason is null or action in ('APPROVE', 'APPROVE_WITH_CAP')
  );
