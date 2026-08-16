-- One non-null workspace.activated product event per workspace.
-- Additive only. Canonicalize any historical duplicates before the unique index.

delete from product_events
where id in (
  select id
  from (
    select id,
           row_number() over (
             partition by workspace_id
             order by occurred_at asc, id asc
           ) as rn
    from product_events
    where event_name = 'workspace.activated'
      and workspace_id is not null
  ) ranked
  where rn > 1
);

create unique index if not exists product_events_workspace_activated_once_idx
  on product_events (workspace_id)
  where event_name = 'workspace.activated' and workspace_id is not null;
