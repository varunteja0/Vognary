# Billing activation runbook

Vognary 1.0 supports one tracked Razorpay Payment Link SKU: the one-time INR 999 assisted audit. Static payment URLs and legacy monitoring SKUs are not exposed.

## Required configuration

- `DATABASE_URL` with migrations through `0017_shared_rate_limits` applied.
- `NEXT_PUBLIC_APP_URL` using the deployed HTTPS origin.
- `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` from the intended Razorpay mode.
- `RAZORPAY_WEBHOOK_SECRET` configured independently in the Razorpay dashboard.
- The assisted-audit amount is server-owned by `src/lib/public-offer.ts` (₹999). Do not add a dashboard or environment override that can diverge from the public offer.
- Qualified legal review of the current Terms and Privacy Notice. Set `ASSISTED_AUDIT_LEGAL_TERMS_STATUS=approved` only after that review; code changes alone do not satisfy this gate.
- A live-mode key (`rzp_live_...`) and provider/KYC evidence. Set `RAZORPAY_ACCOUNT_STATUS=live-kyc-approved` only after the intended account is activated.
- Attach the signed-webhook, fresh-event replay, full-refund, and zero-finding reconciliation outputs to the launch record. Only then set `RAZORPAY_WEBHOOK_PROOF_STATUS=passed`, `RAZORPAY_REPLAY_PROOF_STATUS=passed`, `RAZORPAY_REFUND_PROOF_STATUS=passed`, and `RAZORPAY_RECONCILIATION_STATUS=passed`. These values are operator attestations, not substitutes for the outputs.

Configure the webhook URL as:

```text
https://<production-origin>/api/billing/webhooks/razorpay
```

Subscribe to `payment_link.paid`, `payment_link.cancelled`, `payment_link.expired`, and `refund.processed`. Vognary validates `X-Razorpay-Signature` against the untouched raw body, deduplicates transport events by `x-razorpay-event-id`, payments by provider payment ID, and refunds by provider refund ID. It stores only bounded settlement identifiers and a SHA-256 payload hash, never the raw webhook body.

## Paid private audits (guest checkout)

The `assisted-audit` plan is the guest-payable one-time private audit. Historical `annual` rows remain readable for reconciliation but cannot be purchased through Vognary 1.0. The flow is:

1. A visitor submits `/private-audit`; `POST /api/audit-intake` persists the lead and returns `leadId`.
2. First-use UI stays payment-free until tracked checkout and legal gates are configured. `GET /api/checkout?plan=assisted-audit` exposes the server-owned amount and offer/terms versions only when tracked checkout is ready.
3. The user accepts the current terms. `POST /api/checkout` with `{ plan: "assisted-audit", email, leadId, termsVersion }` and header `Idempotency-Key: assisted-audit:<version>:<leadId>` creates or replays one checkout bound to that lead, offer, amount, currency, and terms version. A mismatch returns `409`.
4. Razorpay redirects the payer back to the public status page `/billing/return?checkout=<checkoutId>`. That page never requires login and reads only `GET /api/checkout/<checkoutId>` (status, plan, amount, timestamps — no email, no provider identifiers).
5. Settlement remains webhook-only. A paid checkout creates exactly one `assisted_audit_orders` fulfillment row. It never grants a time-based workspace or monitoring entitlement.

Operator identification of a paid audit (no payment credentials involved):

```sql
select c.id as checkout_id, c.status, c.paid_at, c.amount_minor,
	   o.status as fulfillment_status, l.name, l.email, l.persona
from billing_checkout_sessions c
join assisted_audit_orders o on o.checkout_session_id = c.id
join private_audit_leads l on l.id = c.lead_id
where c.plan = 'assisted-audit' and c.status in ('paid', 'partially_refunded')
order by c.paid_at desc;
```

Fulfillment transitions are explicit and audited. Do not update `assisted_audit_orders` directly:

```bash
# Run only when the operator actually begins evidence review.
DATABASE_URL='<production-postgres-url>' POSTGRES_SSL=true npm run billing:audit-order -- \
	--checkout '<checkout-uuid>' --action start --confirm

# Run only after the promised audit output is delivered.
DATABASE_URL='<production-postgres-url>' POSTGRES_SSL=true npm run billing:audit-order -- \
	--checkout '<checkout-uuid>' --action deliver --confirm

# To cancel a settled order, issue the full refund through Razorpay. Vognary
# becomes terminal only after the signed refund webhook marks the order refunded.
```

`start` records the review boundary used by the refund policy. `deliver` requires `in_progress`; delivered and refunded orders cannot be reopened. The CLI refuses terminal cancellation before a signed full-refund webhook.

Funnel telemetry (privacy-safe counts only, no identifiers): `private_audit.requested`, `billing.checkout_started`, `billing.payment_settled`, and `billing.payment_refunded` in `product_events`.

## Test-mode proof

1. In a non-production deployment only, set `ASSISTED_AUDIT_CHECKOUT_MODE=test` with Razorpay test credentials. This bypasses live activation attestations only outside `NODE_ENV=production`; production rejects it.
2. Apply migrations and confirm `0013_billing_entitlements` through `0017_shared_rate_limits` in `schema_migrations`.
3. Submit a test private-audit request and start checkout from that durable lead.
4. Confirm the returned Razorpay link has a local checkout UUID as `reference_id`.
5. Complete a Razorpay test payment and wait for `payment_link.paid`.
6. Verify one `billing_checkout_sessions.status='paid'` row, one `assisted_audit_orders.status='pending'` row, and no workspace entitlement for that checkout.
7. Replay with the same and a fresh event id; verify no second order or settlement event is created.
8. Process duplicate, partial, full, and refund-before-paid test events; verify provider refund IDs are unique, totals never exceed the payment, and the order becomes `refunded` after a full refund.
9. Run `npm run billing:reconcile -- --report-only`; require zero findings and exit code 0, including no pending/rejected refunds or failed refund webhooks.
10. Remove `ASSISTED_AUDIT_CHECKOUT_MODE`; test mode must never be present in production.

## Stop conditions

- Do not claim paid access from the browser callback. Access activates only after a valid signed webhook.
- Do not expose or reconcile static `PAYMENT_LINK_*` URLs as Vognary 1.0 checkout.
- Do not enable live mode until test payment, duplicate delivery, full refund, and reconciliation all pass.
- Do not begin evidence review without recording `start`, and do not mark `deliver` before the promised output reaches the customer.
- On signature failures, return `401`. On valid-event database failures, return `500` so Razorpay retries.
- During webhook-secret rotation, set `RAZORPAY_WEBHOOK_OLD_SECRET` only for the documented retry window, then remove it.

## Uncertain Payment Link creation

If checkout returns `checkout-reconciliation-required`, or a process crash leaves creation in progress, do not retry provider creation or create a manual link. Wait at least 15 minutes, then resolve the exact checkout UUID through Razorpay's filtered Payment Links API:

```bash
DATABASE_URL='<production-postgres-url>' POSTGRES_SSL=true \
RAZORPAY_KEY_ID='<same-mode-key-id>' RAZORPAY_KEY_SECRET='<same-mode-key-secret>' \
npm run billing:recover-checkout -- --checkout '<checkout-uuid>' --confirm
```

The command is bounded to the checkout UUID as Razorpay `reference_id`. It attaches exactly one matching link only after verifying provider ID, URL, amount, currency, and reference. It releases the local creation claim only when Razorpay returns an authoritative empty filtered result. Multiple or mismatched results fail closed and require provider investigation.
