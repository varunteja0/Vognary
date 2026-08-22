# Historical billing settlement runbook — public checkout retired

The one-time INR 999 assisted-audit offer is retired as of 2026-08-21.

- `/private-audit` permanently redirects to `/login?next=/app`.
- `GET` and `POST` on `/api/audit-intake` return `410 Gone` and cannot collect a new lead.
- `GET` and `POST` on `/api/checkout` return `410 Gone` regardless of Razorpay environment variables.
- The retired page and redaction-planner client code have been removed.
- The offer is absent from the sitemap and current Terms.

Do not set Razorpay or assisted-audit environment variables to try to reactivate these routes. A future paid offer needs a new founder-approved scope after first-10 customer proof, current legal/tax review, and a fresh end-to-end payment launch record.

## Why historical billing code remains

The database migrations, settlement webhook, reconciliation logic, and historical status route remain so an already-created checkout row can be reconciled, refunded, or audited without corrupting financial history. Their presence is not a purchasable offer or operational-readiness claim.

The webhook URL for historical provider events is:

```text
https://<production-origin>/api/billing/webhooks/razorpay
```

Vognary validates `X-Razorpay-Signature` against the untouched raw body, deduplicates transport events by `x-razorpay-event-id`, payments by provider payment ID, and refunds by provider refund ID. It stores only bounded settlement identifiers and a SHA-256 payload hash, never the raw webhook body.

## Inspect historical settlement state

```sql
select c.id as checkout_id, c.status, c.paid_at, c.amount_minor,
       o.status as fulfillment_status, l.name, l.email, l.persona
from billing_checkout_sessions c
left join assisted_audit_orders o on o.checkout_session_id = c.id
left join private_audit_leads l on l.id = c.lead_id
where c.plan = 'assisted-audit'
order by c.created_at desc;
```

If a settled historical order exists, fulfillment transitions remain explicit and audited:

```bash
DATABASE_URL='<production-postgres-url>' POSTGRES_SSL=true npm run billing:audit-order -- \
  --checkout '<checkout-uuid>' --action start --confirm

DATABASE_URL='<production-postgres-url>' POSTGRES_SSL=true npm run billing:audit-order -- \
  --checkout '<checkout-uuid>' --action deliver --confirm
```

To cancel a settled historical order, issue the full refund through Razorpay. Vognary becomes terminal only after the signed refund webhook marks the order refunded. Do not update `assisted_audit_orders` directly.

For an uncertain historical Payment Link creation, wait at least 15 minutes and resolve only the exact checkout UUID through the filtered provider lookup:

```bash
DATABASE_URL='<production-postgres-url>' POSTGRES_SSL=true \
RAZORPAY_KEY_ID='<same-mode-key-id>' RAZORPAY_KEY_SECRET='<same-mode-key-secret>' \
npm run billing:recover-checkout -- --checkout '<checkout-uuid>' --confirm
```

The recovery command is bounded to the checkout UUID as Razorpay `reference_id`. Multiple or mismatched results fail closed and require provider investigation.

## Stop conditions

- Never create a new checkout or lead through the retired public routes.
- Never advertise the historical assisted-audit amount or readiness state.
- Never infer payment from a browser return; settlement is signed-webhook only.
- Never delete historical billing rows to simplify readiness reporting.
- Never label environment configuration as proof of a live paid product.
