alter table product_events
  drop constraint if exists product_events_event_name_check,
  drop constraint if exists product_events_source_check;

alter table product_events
  add constraint product_events_event_name_check check (event_name in (
    'connector.sync.started',
    'connector.sync.succeeded',
    'connector.sync.failed',
    'ledger.materialized',
    'workspace.activated',
    'ledger.viewed',
    'review.action_recorded',
    'review.completed',
    'export.created'
  )),
  add constraint product_events_source_check check (source in (
    'sync-runner',
    'living-ledger',
    'workspace-api',
    'product-ui'
  ));
