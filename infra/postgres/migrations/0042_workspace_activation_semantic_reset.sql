-- Reset historically untrustworthy workspace.activated rows.
-- Before this slice, evidence POST could write the event without first-value
-- rendering or product-analytics-opt-in. 0041 kept the earliest duplicate.
-- Additive only. Do not rewrite 0041. Fresh installs have no rows to delete.

delete from product_events
where event_name = 'workspace.activated';
