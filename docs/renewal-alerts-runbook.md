# Renewal Alert Activation Runbook

This rail sends individual renewal reminders and a separate weekly recurring-money digest. Both are off by default; a user must explicitly enable each choice through the authenticated preferences API before any delivery row can be scheduled. Deploying the code or configuring Resend does not opt anyone in.

## Runtime requirements

- `DATABASE_URL`: preferences, consent links, schedules, and retry state.
- `RESEND_API_KEY`: server-side email delivery credential.
- `RESEND_FROM_EMAIL`: verified Resend sender.
- `NEXT_PUBLIC_APP_URL`: HTTPS production origin used for review and preference links.
- `CRON_SECRET`: bearer token supplied by Vercel Cron to the `GET` worker.
- `INTERNAL_SYNC_SECRET`: bearer token for manual `POST` worker runs.
- A migrated `DATABASE_URL`: production workers use its shared Postgres rate limiter automatically. Upstash REST is optional and preferred when configured. Workers fail closed without either shared backend unless the documented emergency override is active.
- `RENEWAL_ALERT_DELIVERY_STATUS`: leave blank until an opted-in reminder is recorded as sent and the deployed cron invocation is verified. The only accepted activation value is `production-live`.

Never expose Resend or worker secrets to browser code. Apply the database migration before deploying application code:

```bash
DATABASE_URL='<production-postgres-url>' POSTGRES_SSL=true npm run db:apply-schema
```

Confirm both `0006_renewal_alerts.sql` and `0022_weekly_digest.sql` appear in `schema_migrations`.

## Preference API

Both operations require a current `vognary_session` whose user still belongs to the session workspace.

`GET /api/renewal-alerts/preferences` returns defaults without creating consent:

```json
{
  "status": "ok",
  "preference": {
    "enabled": false,
    "weeklyDigestEnabled": false,
    "sevenDayEnabled": true,
    "oneDayEnabled": true,
    "timeZone": "UTC",
    "sendHourLocal": 9,
    "updatedAt": null,
    "disabledReason": null,
    "consent": {
      "purpose": "renewal-alerts",
      "active": false,
      "grantId": null,
      "grantedAt": null,
      "withdrawnAt": null,
      "expiresAt": null
    }
  }
}
```

`PUT /api/renewal-alerts/preferences` requires same-origin JSON. Enabling records a purpose-specific consent grant and schedules only future reminder windows:

```json
{
  "enabled": true,
  "weeklyDigestEnabled": true,
  "sevenDayEnabled": true,
  "oneDayEnabled": true,
  "timeZone": "Asia/Kolkata",
  "sendHourLocal": 9
}
```

`enabled` controls 7-day/1-day reminders; `weeklyDigestEnabled` independently controls the Monday digest. Consent remains active while either is enabled. Set both to `false` to withdraw the linked consent and cancel unsent work. Withdrawing the linked `renewal-alerts` grant through `/api/privacy/consents` also disables the preference. At least one reminder window must remain selected while reminders are enabled.

## Scheduling behavior

- A living-ledger materialization that touches canonical recurring items reruns scheduling for that workspace.
- Updating preferences reruns scheduling immediately.
- The database uniqueness key is preference + recurring item + reminder window + renewal date, so repeated syncs do not create duplicate sends.
- Reminders target the selected local hour 7 days and 1 day before `next_expected_date`.
- A window already in the past is not sent as a catch-up notification. For example, enabling six days before a renewal schedules the 1-day reminder but not the missed 7-day reminder.
- If a canonical renewal date changes, unsent rows for the old date are cancelled and future rows use the new date.
- Delivery rows do not duplicate recipient email, merchant, amount, connector payload, evidence text, or credentials. The worker resolves the current email and merchant only while sending.
- The weekly digest row is created once per preference on local Monday for the selected send hour, even when that hour is later than Monday's worker run. Claiming remains time-gated, so the daily worker sends it on the first invocation at or after that hour. It is skipped for an empty ledger and contains INR monthly burn, foreign currencies separately, the next seven days, and one deterministic INR review suggestion.
- `weekly_digest_deliveries` stores schedule/state identifiers only. Financial totals and suggestion text are resolved from the current ledger after claim and are never persisted in the delivery queue.

## Worker activation

`vercel.json` invokes `GET /api/internal/renewal-alerts/due/run` daily at 09:00 IST (`03:30 UTC`) so the deployment remains compatible with the Vercel Hobby plan. Vercel supplies `Authorization: Bearer <CRON_SECRET>`. Due reminders for other configured time zones can wait until this daily invocation.

Manual trusted run:

```bash
curl -X POST 'https://www.vognary.com/api/internal/renewal-alerts/due/run?limit=10' \
  -H 'Authorization: Bearer <INTERNAL_SYNC_SECRET>'
```

The response contains aggregate counts only:

```json
{
  "status": "completed",
  "selected": 0,
  "remindersSelected": 0,
  "weeklyDigestsSelected": 0,
  "sent": 0,
  "failed": 0,
  "cancelled": 0
}
```

## One real reminder proof (founder)

Run this only with a disposable account on the deployment being attested. Clearly labelled test evidence is acceptable for proving delivery infrastructure; it is not a Customer #0 result and must not enter the market CRM.

1. In Recovery Home, confirm one active test commitment shows **High confidence**, an expected date, and a decision other than **Keep**. Stop if those facts are not visible; do not insert or edit production rows by hand.
2. Choose a send target at least one full hour in the future. In the commitment correction UI, set the expected date to one calendar day after that target date so the 1-day window lands on the target.
3. Open **Account → Notifications**. Turn the weekly digest off, turn **7 days before** off, turn **1 day before** on, set the tested IANA time zone (for India, `Asia/Kolkata`) and target local hour, then choose **Enable reminders**.
4. Before the target, verify exactly one future row without selecting recipient or financial fields:

```sql
select alert_window, status, scheduled_for at time zone 'Asia/Kolkata' as scheduled_for_ist
from renewal_alert_deliveries
where workspace_id = '<disposable-workspace-uuid>'
order by scheduled_for desc;
```

Expected: one `1_day` row with `status = 'scheduled'` at the chosen local hour. Stop if no row exists, more than one active row exists, or the timestamp is wrong.

5. At or after `scheduled_for_ist`, run one trusted worker batch from a terminal where the secret is already set. Do not paste the secret into chat or command history:

```bash
test -n "$INTERNAL_SYNC_SECRET" || { echo 'INTERNAL_SYNC_SECRET is not set'; exit 1; }
curl --fail-with-body --silent --show-error \
  -X POST 'https://www.vognary.com/api/internal/renewal-alerts/due/run?limit=1' \
  -H "Authorization: Bearer $INTERNAL_SYNC_SECRET"
```

Expected aggregate result: `status = "completed"`, `remindersSelected = 1`, `weeklyDigestsSelected = 0`, `sent = 1`, `failed = 0`, and `cancelled = 0`. The response must contain no recipient, merchant, amount, or evidence text.

6. In the disposable mailbox, verify one message with subject **Upcoming renewal reminder from Vognary**, the expected merchant/date in the body, and a working Account link. This observation, not the worker count alone, proves delivery.
7. Return to **Account → Notifications**, choose **Turn off**, and save with the weekly digest still off. Verify the linked consent is withdrawn and any remaining unsent rows are `cancelled`:

```sql
select status, count(*)
from renewal_alert_deliveries
where workspace_id = '<disposable-workspace-uuid>'
group by status
order by status;
```

Stop and leave `RENEWAL_ALERT_DELIVERY_STATUS` blank if the worker returns `401`, `501`, `503`, or `207`; if `sent` is not `1`; if the email does not arrive; if response/log output exposes PII or money; or if disabling leaves an unsent row scheduled. Only after all seven steps pass may the founder set `RENEWAL_ALERT_DELIVERY_STATUS=production-live` and rerun strict activation.

It never returns recipients, merchants, amounts, evidence, or provider credentials. Resend calls time out after eight seconds and use the delivery UUID as the provider idempotency key, following [Resend's idempotency-key contract](https://resend.com/docs/dashboard/emails/idempotency-keys). Retryable failures use bounded backoff and stop after five total attempts; provider rejections and missing configuration are not retried automatically.

## Operational checks

Use aggregate queries only in routine diagnostics:

```sql
select enabled, count(*)
from renewal_alert_preferences
group by enabled;

select status, alert_window, count(*)
from renewal_alert_deliveries
group by status, alert_window
order by status, alert_window;
```

Do not add recipient, merchant, or amount fields to cron responses or application logs. If failures rise:

1. Check aggregate delivery status counts.
2. Confirm the Resend domain and sender are verified.
3. Confirm the cron returns `200` or `207`, not `401`, `501`, or `503`.
4. Inspect only `last_error_code`; it is intentionally categorical and contains no provider response body.
5. Pause delivery by removing the renewal cron entry or disabling user preferences. Do not delete consent history to pause the worker.

## Production claim gate

Do not claim that alerts are active merely because the cron exists. The capability is proven only after a test workspace explicitly opts in, a future canonical renewal creates one deduplicated row per selected window, a test email arrives, disabling preferences cancels remaining rows, and no recipient or financial payload appears in worker responses or logs.

Only after that gate passes, set `RENEWAL_ALERT_DELIVERY_STATUS=production-live`, redeploy, and verify the internal readiness response
reports both `capabilities.renewalAlerts.lastSentAt` and `hardening.renewalAlerts=operator-attested-production-live`. The status remains
explicitly operator-attested because the readiness route cannot independently inspect Vercel Cron deployment state.
