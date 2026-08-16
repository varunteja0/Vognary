-- Require an explicit semantic-version marker on workspace.activated rows.
-- Additive only. Do not rewrite 0041 or 0042.
--
-- Safe production rollout:
-- 1. Apply 0041, 0042, then this 0043 while older application instances may
--    still be running. Do not drop 0041-0043.
-- 2. After 0043, an old writer that inserts workspace.activated without
--    activation_semantic_version = 1 is rejected. That is fail-closed: a
--    semantically invalid activation cannot be reintroduced during overlap.
-- 3. Deploy the application that writes activation_semantic_version = 1.
-- 4. Never deploy that writer before this migration (the column and check
--    do not exist yet, so the insert fails).
-- 5. Rolling overlap is safe: old instances fail closed; new instances
--    record a consented, cited Home activation exactly once.

alter table product_events
  add column if not exists activation_semantic_version smallint;

delete from product_events
where event_name = 'workspace.activated'
  and activation_semantic_version is distinct from 1;

alter table product_events
  drop constraint if exists product_events_workspace_activated_semantic_version_check;

alter table product_events
  add constraint product_events_workspace_activated_semantic_version_check
  check (
    (event_name = 'workspace.activated' and activation_semantic_version is not distinct from 1)
    or (event_name <> 'workspace.activated' and activation_semantic_version is null)
  );
