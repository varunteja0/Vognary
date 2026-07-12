-- Paid private-audit flow: bind checkouts to audit leads and extend the
-- product-event allowlist with the revenue funnel stages.

alter table billing_checkout_sessions
  add column if not exists lead_id uuid references private_audit_leads(id) on delete set null;

create index if not exists billing_checkout_lead_idx
  on billing_checkout_sessions(lead_id) where lead_id is not null;

alter table product_events
  drop constraint if exists product_events_event_name_check;

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
    'export.created',
    'private_audit.requested',
    'billing.checkout_started',
    'billing.payment_settled',
    'billing.payment_refunded'
  ));
