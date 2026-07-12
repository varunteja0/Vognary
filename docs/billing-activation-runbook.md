# Billing activation runbook

Vognary supports tracked Razorpay Payment Links. A configured static payment URL is only an untracked fallback and never grants an entitlement automatically.

## Required configuration

- `DATABASE_URL` with migration `0013_billing_entitlements` applied.
- `NEXT_PUBLIC_APP_URL` using the deployed HTTPS origin.
- `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` from the intended Razorpay mode.
- `RAZORPAY_WEBHOOK_SECRET` configured independently in the Razorpay dashboard.
- Positive whole-INR amounts in `PAYMENT_AMOUNT_PERSONAL_INR`, `PAYMENT_AMOUNT_FOUNDER_INR`, `PAYMENT_AMOUNT_TEAM_INR`, and `PAYMENT_AMOUNT_ANNUAL_AUDIT_INR`.

Configure the webhook URL as:

```text
https://<production-origin>/api/billing/webhooks/razorpay
```

Subscribe to `payment_link.paid`, `payment_link.cancelled`, `payment_link.expired`, and `refund.processed`. Vognary validates `X-Razorpay-Signature` against the untouched raw body and deduplicates `x-razorpay-event-id`. It stores only bounded settlement identifiers and a SHA-256 payload hash, never the raw webhook body.

## Test-mode proof

1. Apply migrations and confirm `0013_billing_entitlements` in `schema_migrations`.
2. Create a signed-in test workspace and start checkout from the workspace overview.
3. Confirm the returned Razorpay link has a local checkout UUID as `reference_id`.
4. Complete a Razorpay test payment and wait for `payment_link.paid`.
5. Verify one `billing_checkout_sessions.status='paid'` row and one active `workspace_entitlements` row.
6. Replay the same event id and verify no duplicate entitlement period is added.
7. Process a full test refund and verify the checkout becomes `refunded` and its entitlement becomes `revoked`.
8. Run `npm run billing:reconcile -- --report-only`; require zero mismatches.

## Stop conditions

- Do not claim paid access from the browser callback. Access activates only after a valid signed webhook.
- Do not treat static `PAYMENT_LINK_*` URLs as settlement proof.
- Do not enable live mode until test payment, duplicate delivery, full refund, and reconciliation all pass.
- On signature failures, return `401`. On valid-event database failures, return `500` so Razorpay retries.
- During webhook-secret rotation, set `RAZORPAY_WEBHOOK_OLD_SECRET` only for the documented retry window, then remove it.