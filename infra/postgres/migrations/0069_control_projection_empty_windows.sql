alter table commitment_control_proposals
  drop constraint commitment_control_proposals_projected_13_week_minor_check,
  drop constraint commitment_control_proposals_projected_annual_minor_check,
  add constraint commitment_control_proposals_projected_13_week_minor_check
    check (projected_13_week_minor >= 0),
  add constraint commitment_control_proposals_projected_annual_minor_check
    check (projected_annual_minor >= 0);