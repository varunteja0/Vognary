-- Signed provider delivery events for the Commitment Control attention outbox.
--
-- Additive only. Nothing here sends, decides, or moves money. A provider event
-- is matched by the provider's own message id and by nothing else: no recipient
-- address, subject, body, or raw payload is stored, and the provider's event id
-- is never persisted. What is kept is the smallest ordering fact that lets an
-- out-of-order or replayed webhook be refused: which recognized event type was
-- last applied to this row, and when the provider said it happened.
--
-- Acceptance by a provider is still not delivery. PROVIDER_ACCEPTED remains
-- unable to carry a delivered_at; only a state that genuinely holds a delivery
-- may. UNSUBSCRIBED is added to that set for one honest case: a recipient may
-- complain about an email that really was delivered, and the complaint must be
-- able to stop future email without erasing the delivery that provoked it.
--
-- Reverting this migration:
--   update commitment_control_attention_notifications
--     set delivered_at = null where delivery_state = 'UNSUBSCRIBED';
--   alter table commitment_control_attention_notifications
--     drop constraint cc_attention_notifications_provider_event_type_check,
--     drop constraint cc_attention_notifications_provider_event_pair_check,
--     drop constraint cc_attention_notifications_provider_event_binding_check,
--     drop column last_provider_event_type,
--     drop column last_provider_event_at;
--   drop index cc_attention_notifications_provider_message_key;
-- then restore the 0065 delivery-proof constraint:
--   alter table commitment_control_attention_notifications
--     drop constraint cc_attention_notifications_delivery_proof_check,
--     add constraint cc_attention_notifications_delivery_proof_check
--       check (delivery_state = 'DELIVERED' or delivered_at is null);
-- The first statement is the only lossy step, and it is required because the
-- 0065 constraint cannot describe a complained-about delivery.

alter table commitment_control_attention_notifications
  add column if not exists last_provider_event_type text;
alter table commitment_control_attention_notifications
  add column if not exists last_provider_event_at timestamptz;

-- Exactly one attention row may answer to a provider message id, so a webhook
-- can be resolved by that id alone and can never fan out to a second recipient.
create unique index if not exists cc_attention_notifications_provider_message_key
  on commitment_control_attention_notifications (provider_message_id)
  where provider_message_id is not null;

alter table commitment_control_attention_notifications
  drop constraint if exists cc_attention_notifications_provider_event_type_check;
alter table commitment_control_attention_notifications
  add constraint cc_attention_notifications_provider_event_type_check
  check (last_provider_event_type is null or last_provider_event_type in (
    'email.sent', 'email.delivered', 'email.delayed', 'email.delivery_delayed',
    'email.bounced', 'email.failed', 'email.complained'
  ));

-- An event time with no event type is not an ordering fact, and a type with no
-- time cannot order anything.
alter table commitment_control_attention_notifications
  drop constraint if exists cc_attention_notifications_provider_event_pair_check;
alter table commitment_control_attention_notifications
  add constraint cc_attention_notifications_provider_event_pair_check
  check ((last_provider_event_type is null) = (last_provider_event_at is null));

-- A provider event can only have been matched through a bound message id.
alter table commitment_control_attention_notifications
  drop constraint if exists cc_attention_notifications_provider_event_binding_check;
alter table commitment_control_attention_notifications
  add constraint cc_attention_notifications_provider_event_binding_check
  check (last_provider_event_type is null or provider_message_id is not null);

alter table commitment_control_attention_notifications
  drop constraint if exists cc_attention_notifications_delivery_proof_check;
alter table commitment_control_attention_notifications
  add constraint cc_attention_notifications_delivery_proof_check
  check (
    delivered_at is null
    or (delivery_state in ('DELIVERED', 'UNSUBSCRIBED') and provider_message_id is not null)
  );
