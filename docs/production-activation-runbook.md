# Vognary Production Activation Runbook

Use this runbook to turn the current deployed product into a fully activated production system. The code is ready for these gates, but each gate needs external accounts, credentials, or partner approval.

## Stage Gates

Run this after every setup change:

```bash
npm run production:check -- https://www.vognary.com
```

Run strict mode only when you expect every external service to be configured:

```bash
npm run production:check -- https://www.vognary.com --strict
```

Stop if endpoint health fails. Continue if only external activation is incomplete.

## 1. Persist Private Audit Leads

Goal: `/private-audit` and `/api/audit-intake` should store leads instead of returning preview-only responses.

Recommended fastest path: Tally or Make/Zapier webhook into Google Sheets.

Click-by-click using Make:

1. Open `https://www.make.com/`.
2. Click `Create a new scenario`.
3. Click the large plus button.
4. Search for `Webhooks`.
5. Select `Custom webhook`.
6. Click `Add`.
7. Name it `Vognary private audit intake`.
8. Copy the generated webhook URL.
9. Open Vercel Dashboard.
10. Select the `Vognary` project.
11. Click `Settings`.
12. Click `Environment Variables`.
13. Add key `AUDIT_INTAKE_WEBHOOK_URL`.
14. Paste the Make webhook URL as the value.
15. Select `Production`.
16. Click `Save`.
17. Redeploy production.
18. Visit `https://www.vognary.com/private-audit`.
19. Submit a test request with your own email.
20. Verify the Make scenario receives a webhook event.
21. Add a Google Sheets module in Make and map fields: name, email, persona, paymentTypes, sourceTypes, score, createdAt.

Success check:

```bash
npm run production:check -- https://www.vognary.com
```

Expected: `Lead persistence` becomes `READY`.

Rollback:

- Remove `AUDIT_INTAKE_WEBHOOK_URL` from Vercel if the webhook is leaking or failing.
- The site will fall back to preview mode and still produce a backup brief.

## 2. Tracked Razorpay Billing

Goal: a signed-in workspace can create a tracked Razorpay checkout, and access changes only after a signed settlement webhook.

Static `PAYMENT_LINK_*` URLs are an explicitly untracked fallback. They return `status: "link-only"`, do not grant an entitlement, and cannot satisfy production readiness.

1. Complete Razorpay business/KYC activation and create keys for the intended mode. Follow Razorpay's current official key instructions: `https://razorpay.com/docs/payments/dashboard/settings/api-keys/`.
2. Apply migration `0013_billing_entitlements` to the production database.
3. In Vercel production environment variables, configure `DATABASE_URL`, `NEXT_PUBLIC_APP_URL`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and all four `PAYMENT_AMOUNT_*_INR` values listed in `docs/billing-activation-runbook.md`.
4. In Razorpay, configure `https://www.vognary.com/api/billing/webhooks/razorpay` as the webhook URL using the same independently generated webhook secret. Follow the current official webhook instructions: `https://razorpay.com/docs/webhooks/setup-edit-payments/`.
5. Subscribe the webhook to `payment_link.paid`, `payment_link.cancelled`, `payment_link.expired`, and `refund.processed`.
6. Redeploy production.
7. Sign in to a disposable test workspace and start checkout from the workspace UI. The tracked `personal`, `founder`, and `team` plans intentionally require an authenticated workspace.
8. Confirm checkout creation returns `status: "ready"` and a Razorpay URL. The request must include the signed session cookie and a unique 16–128 character `Idempotency-Key` header.
9. Complete the test payment, verify the signed webhook changed the checkout to `paid`, and verify an active `workspace_entitlements` row exists.
10. Replay the event id, test a full refund, and run `npm run billing:reconcile -- --report-only`; require zero mismatches.
11. Follow the complete proof and rollback conditions in `docs/billing-activation-runbook.md`.

Success check:

```bash
npm run production:check -- https://www.vognary.com --strict
```

Expected: `Tracked Razorpay billing` becomes `READY` only after the readiness API reports `settlement-observed` and every tracked plan probe reports `ready`.

Stop conditions:

- Do not announce paid access from a browser redirect or a static payment URL.
- Stop on webhook signature failures, reconciliation mismatches, duplicate entitlement periods, or a refund that does not revoke access.

## 3. Gmail OAuth For User-Owned Gmail Receipt Sync

Important: users can authorize their own Gmail, but Vognary must still own a Google OAuth app. That is not hardcoding your data; it is the app identity Google requires before users can consent.

Click-by-click:

1. Open `https://console.cloud.google.com/`.
2. Click the project selector at the top.
3. Click `New Project`.
4. Name it `Vognary Production`.
5. Click `Create`.
6. Open the project.
7. Search `Gmail API` in the top search bar.
8. Open `Gmail API`.
9. Click `Enable`.
10. Go to `APIs & Services` > `OAuth consent screen`.
11. Choose `External`.
12. Click `Create`.
13. App name: `Vognary`.
14. User support email: your support email.
15. App logo: upload Vognary mark if available.
16. App domain: `vognary.com`.
17. Authorized domains: add `vognary.com`.
18. Developer contact email: your email.
19. Click `Save and Continue`.
20. Click `Add or Remove Scopes`.
21. Add `https://www.googleapis.com/auth/gmail.readonly`.
22. Save scopes.
23. Add test users: your Gmail account and early beta users.
24. Click `Save and Continue` until complete.
25. Go to `Credentials`.
26. Click `Create Credentials`.
27. Select `OAuth client ID`.
28. Application type: `Web application`.
29. Name: `Vognary Web`.
30. Authorized JavaScript origins: `https://www.vognary.com`.
31. Authorized redirect URIs: `https://www.vognary.com/api/integrations/gmail/callback`.
32. Click `Create`.
33. Copy `Client ID` and `Client secret`.
34. Open Vercel Dashboard > Vognary > Settings > Environment Variables.
35. Add:
    - `GOOGLE_CLIENT_ID`
    - `GOOGLE_CLIENT_SECRET`
    - `GOOGLE_REDIRECT_URI=https://www.vognary.com/api/integrations/gmail/callback`
36. Redeploy production.
37. Visit `https://www.vognary.com`.
38. Click `Connect Gmail`.
39. Select a test user Gmail account.
40. Grant read-only Gmail access.
41. Confirm Vognary returns receipt candidates or a connected preview response.

Verification:

```bash
curl 'https://www.vognary.com/api/integrations/gmail/start?mode=json'
```

Expected before redirect: `status: "ready"` and an `authUrl`.

Google verification for public users:

1. Go back to `OAuth consent screen`.
2. Click `Publish App` or `Submit for verification` if prompted.
3. Provide app homepage: `https://www.vognary.com`.
4. Provide privacy policy: `https://www.vognary.com/privacy`.
5. Provide terms: `https://www.vognary.com/terms`.
6. Explain scope usage: read-only Gmail is used to discover receipt and renewal snippets for recurring-payment audits; Vognary does not ask for passwords and does not store mailbox contents by default.
7. Submit verification.

Stop condition:

- Do not invite non-test Gmail users until Google verification is complete.

## 4. Persistent Backend: Database And Secrets

Goal: readiness reports database, token vault, internal sync secret, and session primitives as ready.

Fast path using Neon Postgres:

1. Open `https://console.neon.tech/`.
2. Click `New Project`.
3. Name it `vognary-production`.
4. Select a region close to users, preferably Asia if available.
5. Click `Create Project`.
6. Copy the pooled connection string.
7. Open Vercel Dashboard > Vognary > Settings > Environment Variables.
8. Add `DATABASE_URL` with the Neon connection string.
9. Add `POSTGRES_SSL=true`.
10. Generate token key locally:

```bash
npm run secrets:generate-token-key
```

11. Copy only the generated value.
12. Add `TOKEN_ENCRYPTION_KEY` in Vercel.
13. Generate session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

14. Add `SESSION_SECRET` in Vercel.
15. Generate internal sync secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

16. Add `INTERNAL_SYNC_SECRET` in Vercel.
17. Generate cron secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

18. Add `CRON_SECRET` in Vercel. Vercel Cron sends this as the `Authorization` header to the connector-sync and renewal-alert `GET` workers.
19. Redeploy production.
20. Apply schema from a trusted terminal with production `DATABASE_URL` set:

```bash
DATABASE_URL='<production-neon-url>' POSTGRES_SSL=true npm run db:apply-schema
```

This creates or updates the `schema_migrations` ledger. On a database where the initial schema already exists, the script records `0001_initial_schema` as a baseline before applying later files from `infra/postgres/migrations`.

21. Verify:

```bash
curl https://www.vognary.com/api/readiness \
  -H "Authorization: Bearer $INTERNAL_SYNC_SECRET"
```

Expected:

- `database.status` is `ready`.
- `tokenVault.status` is `ready`.
- `hardening.connectorTokenStore` is `ready` or `configured`.
- `capabilities.schema.status` is `ready`, with every migration from `0002_revocable_sessions` through
  `0014_sync_run_invocation` in `capabilities.schema.applied`.
- Each capability status is queryable rather than `migration-pending`, `migration-ledger-unavailable`, or `schema-query-failed`.
- `hardening.syncWorkers` is `cron-secret-configured-deployment-schedule-unverified` until a cron-invoked successful sync writes evidence. It becomes `operator-attested-production-live` only after that evidence exists and `SYNC_SCHEDULER_STATUS=production-live` is set.

Stop condition:

- If schema apply fails or readiness reports a pending/failed capability query, do not store user credentials or enable the affected
  automation. Fix the database and rerun the migration command first.

## 4A. Optional Audit-Pack Issuer Signing

Goal: authenticated workspace exports carry a Vognary Ed25519 signature in addition to their offline self-checksum. The signing endpoint receives only checksum and issuance metadata, never the report's merchant, amount, evidence, or notes.

1. Generate an Ed25519 PKCS#8 key in a trusted local environment:

```bash
openssl genpkey -algorithm ED25519 -out audit-pack-signing-private.pem
```

2. Add the complete private PEM as `AUDIT_PACK_SIGNING_PRIVATE_KEY` in the production secret store.
3. Set a stable identifier such as `AUDIT_PACK_SIGNING_KEY_ID=vognary-2026-01`.
4. Redeploy, then check public-key discovery:

```bash
curl https://www.vognary.com/api/audit-packs/sign
```

Expected: `signingAvailable: true` and one current Ed25519 public key. No private material is returned.

5. Sign in, export an audit pack, and verify it at `/verify`. The page must show both `Self-checksum intact` and `Vognary signature valid`.
6. Before rotating the private key, export the old public key as base64 SPKI and preserve it in `AUDIT_PACK_TRUSTED_PUBLIC_KEYS` as a JSON map from old key id to public key. Historical signatures become `unknown-key` if their public key is removed.

Stop conditions:

- Never place the private key in a `NEXT_PUBLIC_` variable, browser bundle, pack, or public-key response.
- Do not describe an unsigned pack as Vognary-issued. Its checksum detects edits but can be recreated by anyone.
- A valid signature proves the signing service issued that hash for an authenticated workspace; it does not certify the accuracy or completeness of the financial claims.

## 5. OpenAI Cost Sync

Goal: first direct provider adapter can sync organization costs.

Click-by-click:

1. Open `https://platform.openai.com/` as the workspace's organization admin.
2. Create the least-privileged admin/read key that can read organization costs.
3. Sign in to Vognary as that workspace's owner or admin.
4. Connect OpenAI through the authenticated connector flow; Vognary stores the key encrypted and scoped to that workspace account.
5. Test the persisted account:

```bash
curl -X POST https://www.vognary.com/api/connectors/openai-costs/start \
  -H 'Content-Type: application/json' \
  -H 'Cookie: vognary_session=<current-session-cookie>' \
  -d '{"workspaceId":"<workspace-uuid>","apiKey":"<workspace-openai-admin-key>","displayName":"OpenAI org costs"}'
```

Expected:

- `status` is `connected`, an encrypted token reference is created, and an initial sync job is queued.
- Unauthenticated `POST /api/connectors/openai-costs/sync` returns `401`; the environment-preview execution path is unavailable in production.

Token-backed workspace connection test after login:

```bash
curl -X POST https://www.vognary.com/api/connectors/openai-costs/start \
  -H 'Content-Type: application/json' \
  -H 'Cookie: vognary_session=<signed-session-cookie>' \
  -d '{"workspaceId":"<workspace-uuid>","apiKey":"<WORKSPACE_OPENAI_ADMIN_KEY>","displayName":"OpenAI org costs"}'
```

Expected: `status: "connected"`, a `connectedAccount.id`, a token `keyFingerprint`, and an `initial_sync` job id. The API key must not appear in the response.

After a connected account exists, verify the user-facing account and evidence surface:

```bash
curl https://www.vognary.com/api/workspaces/current/connectors \
  -H 'Cookie: vognary_session=<signed-session-cookie>'

curl -X POST https://www.vognary.com/api/workspaces/current/connectors/<connected-account-id>/sync \
  -H 'Cookie: vognary_session=<signed-session-cookie>'
```

Expected: the first response lists the connected account, latest run status, and evidence count. The second response creates a `manual_refresh` job and returns a sync result. The app connection hub should then show `Run now`, `Import evidence`, `Refresh`, and `Disconnect` controls.

Stop condition:

- If OpenAI returns 401/403, rotate the key or use an organization admin key with costs access.

## 5A. Scheduled Connector Sync Worker

Goal: queued connector sync jobs should not sit idle after Gmail or API-key connections are stored.

The repo includes `vercel.json` with a Vercel Cron job every 15 minutes for `/api/internal/sync-jobs/due/run`.

Activation steps:

1. Confirm `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `INTERNAL_SYNC_SECRET`, and `CRON_SECRET` are set in Vercel.
2. Redeploy production after adding `CRON_SECRET`.
3. Run:

```bash
curl https://www.vognary.com/api/internal/sync-jobs/due/run
```

Expected without the Vercel cron header: `401` if `CRON_SECRET` is configured, or `501` if it is missing.

4. Manually run due jobs from a trusted terminal when needed:

```bash
curl -X POST https://www.vognary.com/api/internal/sync-jobs/due/run \
  -H 'Authorization: Bearer <INTERNAL_SYNC_SECRET>'
```

Expected with no due jobs: `status: "completed"` and `selectedJobs: 0`.

5. Observe at least two scheduled invocations in the deployed Vercel Cron logs and confirm a due job advances to a terminal sync run
   without a manual request.
6. Only after that evidence exists, set `SYNC_SCHEDULER_STATUS=production-live`, redeploy, and confirm
   `hardening.syncWorkers` becomes `operator-attested-production-live`.

`CRON_SECRET` by itself proves only that the route can authenticate a scheduler. It does not prove the schedule is deployed or firing.

Stop condition:

- Do not claim automatic connected monitoring until at least one stored Gmail or provider account queues a job, the due-job endpoint runs it, and `connector_evidence` receives rows.

## 5B. Consent-Gated Renewal Alert Worker

Goal: users who explicitly opt in receive deduplicated email reminders before canonical renewal dates.

1. Apply PostgreSQL migration `0006_renewal_alerts.sql` with `npm run db:apply-schema`.
2. Confirm `DATABASE_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, and `INTERNAL_SYNC_SECRET` are configured.
3. Keep the `/api/internal/sync-jobs/due/run` cron. The additional `/api/internal/renewal-alerts/due/run` cron runs every 15 minutes; the two workers serve different queues.
4. Explicitly opt a test user in through `PUT /api/renewal-alerts/preferences`. Deployment alone must leave every user disabled.
5. Sync a source whose canonical `next_expected_date` is more than seven days ahead.
6. Confirm exactly one `7_day` and one `1_day` delivery row exists for each selected window, then rerun sync and confirm the count does not increase.
7. Run the worker manually from a trusted terminal:

```bash
curl -X POST 'https://www.vognary.com/api/internal/renewal-alerts/due/run?limit=10' \
  -H 'Authorization: Bearer <INTERNAL_SYNC_SECRET>'
```

The response must contain aggregate selected/sent/failed/cancelled counts only. It must not contain an email, merchant, amount, evidence text, or credential. See `docs/renewal-alerts-runbook.md` for the preference contract, retry behavior, safe operational queries, and rollback.

8. After the opted-in test email arrives and deployed cron logs show scheduled invocation, set
   `RENEWAL_ALERT_DELIVERY_STATUS=production-live`, redeploy, and confirm `hardening.renewalAlerts` becomes
   `operator-attested-production-live`. Readiness rejects that attestation when no sent delivery is recorded.

Stop condition:

- Do not advertise renewal email alerts until one explicitly opted-in test user receives a reminder, repeat scheduling remains idempotent, opt-out cancels unsent rows, and cron failures are monitored.

## 6. Identity Provider Or Magic Link

The app can now mint real sessions through Resend magic links. Magic links create a short-lived one-time challenge in PostgreSQL, send the user an email, verify the token, create the user/workspace envelope, and set the existing signed session cookie.

Recommended fastest path: Resend magic links.

Resend click-by-click:

1. Open `https://resend.com/`.
2. Click `Add domain`.
3. Add `vognary.com` or a sending subdomain such as `mail.vognary.com`.
4. Copy the DNS records Resend shows.
5. Open your DNS host.
6. Add the SPF/DKIM/verification records exactly as shown.
7. Return to Resend and wait until the domain shows verified.
8. Click `API Keys`.
9. Click `Create API Key`.
10. Name it `Vognary production magic links`.
11. Copy the key once.
12. Open Vercel Dashboard > Vognary > Settings > Environment Variables.
13. Add `RESEND_API_KEY` with the copied key.
14. Add `RESEND_FROM_EMAIL` with a verified sender, for example `Vognary <login@vognary.com>`.
15. Confirm `DATABASE_URL` and `SESSION_SECRET` are already configured.
16. Redeploy production.
17. Visit `https://www.vognary.com/login`.
18. Enter your email in `Email sign-in link`.
19. Click `Send sign-in link`.
20. Open the email and click the link.
21. Confirm `/api/auth/session` returns `authenticated: true`.

Stop condition:

- Do not market saved workspaces until `npm run production:check -- https://www.vognary.com --strict` reports `Identity provider / magic link` as `READY` and `/api/workspaces` returns workspaces for a signed-in user.

## 7. Redis / Trusted Proxy Rate Limiting

Production rate limiting fails closed when Upstash is absent. When `NODE_ENV=production`, rate-limited endpoints require `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`; otherwise they return `503` with the missing envs. `ALLOW_IN_MEMORY_RATE_LIMITS=true` is an emergency bypass only, not a launch state.

Fast path using Upstash:

1. Open `https://console.upstash.com/`.
2. Click `Create Database`.
3. Product: Redis.
4. Name: `vognary-rate-limit`.
5. Region: close to Vercel deployment.
6. Copy `UPSTASH_REDIS_REST_URL`.
7. Copy `UPSTASH_REDIS_REST_TOKEN`.
8. Add both to Vercel.
9. Redeploy production.
10. Verify `npm run production:check -- https://www.vognary.com` reports `Redis / trusted proxy rate limiting` as `READY`.

Stop condition:

- Do not run high-traffic campaigns until `/api/readiness` reports `hardening.redisRateLimiting` as `configured`.

## 8. Monitoring, Alerts, Backups

Recommended minimal production stack:

- Sentry for app errors.
- Better Stack or UptimeRobot for uptime checks.
- Neon automated backups for Postgres.
- Vercel deployment notifications.

Sentry click-by-click:

1. Open `https://sentry.io/`.
2. Create organization or project.
3. Platform: Next.js.
4. Copy `SENTRY_DSN`.
5. Add `SENTRY_DSN` to Vercel.
6. Redeploy production.
7. Run `INTERNAL_SYNC_SECRET='<production-secret>' npm run monitoring:test -- https://www.vognary.com`.
8. Verify the script returns `status: "delivered"` and the synthetic event is visible in Sentry.
9. Verify `npm run production:check -- https://www.vognary.com` reports `Monitoring and incident alerts` as `READY`.

Better Stack alternative:

1. Open `https://betterstack.com/`.
2. Create a logs source for `Vognary web`.
3. Copy `BETTER_STACK_SOURCE_TOKEN`.
4. Add `BETTER_STACK_SOURCE_TOKEN` to Vercel.
5. Redeploy production.
6. Run `INTERNAL_SYNC_SECRET='<production-secret>' npm run monitoring:test -- https://www.vognary.com`.
7. Verify the script returns `status: "delivered"` and the synthetic event is visible in Better Stack.
8. Verify `/api/readiness` reports `hardening.monitoring` as `configured-better-stack-server-errors`.

Backups:

1. Open Neon project.
2. Go to `Branches` or `Backups`.
3. Confirm Point-in-Time Restore is enabled.
4. Set retention according to plan.

5. Generate a separate backup key: `npm run secrets:generate-backup-key`.
6. Store `BACKUP_ENCRYPTION_KEY` in the production secret manager.
7. Create or choose encrypted S3/R2-compatible backup/object storage.
8. Set the storage upload envs in the backup runner or secret manager:

```bash
BACKUP_STORAGE_BUCKET='<bucket>' # or S3_BUCKET / R2_BUCKET
BACKUP_STORAGE_REGION='<region-or-auto>'
BACKUP_STORAGE_ENDPOINT='<required-for-r2-or-s3-compatible-storage>'
BACKUP_STORAGE_ACCESS_KEY_ID='<access-key-id>'
BACKUP_STORAGE_SECRET_ACCESS_KEY='<secret-access-key>'
BACKUP_STORAGE_PREFIX='vognary-postgres/'
```

9. Run a preflight without printing secrets:

```bash
npm run ops:preflight -- --report-only https://www.vognary.com
```

10. From a trusted operator terminal, create an encrypted dump and upload it automatically when storage envs are configured:

```bash
DATABASE_URL='<production-postgres-url>' \
BACKUP_ENCRYPTION_KEY='<backup-key>' \
POSTGRES_SSL=true \
npm run backup:postgres
```

If `pg_dump` is not installed locally, the script uses Docker with the official `postgres:16` image when Docker is available.

11. Restore the backup into a disposable Postgres database:

```bash
RESTORE_DATABASE_URL='<disposable-postgres-url>' \
RESTORE_CONFIRM_DISPOSABLE=true \
BACKUP_ENCRYPTION_KEY='<backup-key>' \
POSTGRES_SSL=true \
npm run backup:restore-drill -- backups/postgres/<backup>.manifest.json
```

If `pg_restore` is not installed locally, the restore script uses the same Docker fallback.

12. Record the generated `keyFingerprint` as `BACKUP_KEY_FINGERPRINT` if the web runtime should not receive `BACKUP_ENCRYPTION_KEY`.
13. Add `BACKUP_RESTORE_DRILL_STATUS=passed` in Vercel only after the restore drill succeeds and the encrypted storage upload is confirmed.
14. Redeploy production.
15. Verify `/api/readiness` reports `hardening.backups` as `configured` and includes `hardening.backupReadiness.restoreDrill: "passed"`.

GitHub Actions automation:

- `.github/workflows/ops-backup-drill.yml` installs PostgreSQL client tools, runs `backup:postgres`, uploads encrypted artifacts to configured S3/R2 storage, optionally runs `backup:restore-drill` when `RESTORE_DATABASE_URL` is configured, and keeps a short-retention encrypted artifact copy.
- Required GitHub secrets: `DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`, storage bucket/endpoint/region/access-key secrets, and optionally `RESTORE_DATABASE_URL` for restore drills.

Stop condition:

- Do not store user financial source files until backup restore has been tested.

### Privacy lifecycle retention

Migration `0004_privacy_lifecycle.sql` adds bounded workspace policies, data-subject request history, retention-run audit records, and
minimization timestamps. Apply migrations through `npm run db:apply-schema` before enabling this executor. Do not run the executor against
a production database until a restorable backup has been verified.

The internal endpoint is `POST /api/internal/privacy/retention/run`. It accepts `Authorization: Bearer <INTERNAL_SYNC_SECRET>` or the
configured `CRON_SECRET`, uses bounded JSON, and defaults to a non-mutating dry run. Start with:

```bash
curl -X POST https://www.vognary.com/api/internal/privacy/retention/run \
  -H "Authorization: Bearer $INTERNAL_SYNC_SECRET" \
  -H 'Content-Type: application/json' \
  --data '{"dryRun":true}'
```

Review every numeric count and `hasMore` flag. To process one workspace during a controlled rollout, include its UUID as `workspaceId`.
For more than five workspaces, pass the returned `nextWorkspaceCursor` back as `afterWorkspaceId` on the next dry run until the cursor is
null. The cursor is accepted only for dry runs and cannot be combined with `workspaceId`. Only after the dry-run result is understood and
a current backup is verified should an operator execute:

```bash
curl -X POST https://www.vognary.com/api/internal/privacy/retention/run \
  -H "Authorization: Bearer $INTERNAL_SYNC_SECRET" \
  -H 'Content-Type: application/json' \
  --data '{"dryRun":false,"workspaceLimit":10,"batchSize":1000}'
```

Defaults are 30 days for raw connector payload JSON, 90 days for optional product events, and 30 days for operational error text.
Workspace policy bounds are 7–90, 30–365, and 7–90 days respectively. Each call is capped at 10 workspaces and 2,000 rows per category
per workspace; repeat controlled calls while `hasMore` is true. Request-history metadata uses a fixed 730-day window, and retention-run
metadata uses 365 days.

The executor minimizes raw JSON and error text or deletes optional product events. It preserves normalized recurring facts, normalized
evidence columns, transactions, payload hashes, and audit events. It does not erase uploaded-file objects, immutable or provider-managed
backups, provider-held data, or external monitoring and delivery records. Those systems need their own lifecycle controls.

Webhook events currently enter storage as `verified`. If no processor moves an event to a terminal state before its raw-payload window,
the executor marks the stale event `ignored`, records a processing timestamp, and minimizes its payload. Operational webhook error text
uses the same bounded error window as connector synchronization errors. A concurrent executor that cannot acquire a workspace lock returns
`completed-with-skips` and a `workspace_busy`/`orphaned_busy` result; retry it later rather than treating it as data-loss failure.

`vercel.json` invokes authenticated `GET /api/internal/privacy/retention/run` daily at 03:00 IST (`21:30 UTC`). That GET accepts no
caller-controlled mutation options: it enforces a fixed batch of at most 10 workspaces and 500 rows per category using `CRON_SECRET`.
Keep body-driven `POST` for operator dry runs and constrained investigations. Production monitoring should alert on non-2xx responses,
retain only the numeric response summary, and investigate any workspace result marked `failed`.

Readiness does not independently observe Vercel schedule configuration. Treat retention windows as unenforced until the cron is deployed,
one constrained destructive run is audited, and the operator has separately monitored subsequent runs.

After those conditions are satisfied, set `RETENTION_SCHEDULER_STATUS=production-live`, redeploy, and confirm
`hardening.retentionScheduler` becomes `operator-attested-production-live`. Readiness requires a recorded non-dry-run completion in
addition to the operator flag; it still labels the flag as operator attestation rather than independent scheduler telemetry.

Stop condition:

- Do not enable destructive scheduled runs until the dry run, a constrained actual run, the resulting audit record, and a restore drill
  have all been verified.

### Commitment decisions and read-only platform API

Migrations `0007_commitment_decisions.sql` and `0008_platform_api.sql` activate durable class-safe review decisions and scoped read-only
API tokens. Applying the migrations proves schema availability only.

Readiness reports:

- `capabilities.commitmentDecisions.status`: `schema-ready-no-decisions` until a user saves a decision, then `decisions-observed`.
- `capabilities.platformApi.status`: distinguishes no active token, token creation without consumer traffic, and observed token use.
- `hardening.platformApi`: remains `schema-ready-shared-rate-limit-required` until Upstash REST rate limiting is active.

The platform surface is:

- Admin-only `GET|POST|DELETE /api/platform/tokens` for hashed, expiring, revocable tokens.
- Cursor-paginated `GET /api/v1/ledger` with `ledger:read` (`limit` 1–200 and opaque `nextCursor`).
- `GET /api/v1/sources` with `sources:read`.

An unauthenticated platform request must return `401` after database and shared rate limiting are configured. A `503` indicates a
prerequisite is still missing and is not proof of the token guard. `npm run production:check -- --strict` checks migration readiness,
shared rate limiting, and both unauthenticated denials. It does not label the API as adopted by a partner; only
`capabilities.platformApi.lastUsedAt` provides evidence that a token has actually been used.

Stop condition:

- Do not publish a partner/API availability claim until migration `0008` is ready, the unauthenticated checks return `401`, an authorized
  test token returns only its allowed workspace data, revocation is verified, and rate limiting is active.

## 9. Account Aggregator / UPI / Card Mandate Partners

These cannot be completed in code alone. They need business and regulatory access.

Account Aggregator path:

1. Open [docs/partner-rails-access-playbook.md](partner-rails-access-playbook.md).
2. Fill [docs/partner-rails-outreach-tracker.csv](partner-rails-outreach-tracker.csv) with real contact URLs or emails.
3. Shortlist FIU/TSP providers in India.
4. Ask for sandbox access for account statement data.
5. Confirm permitted use case: recurring payment audit / personal finance insight.
6. Sign DPA and compliance paperwork.
7. Get sandbox credentials.
8. Build sandbox adapter.
9. Submit security review.
10. Move to production credentials.

UPI/card mandate path:

1. Open [docs/partner-rails-access-playbook.md](partner-rails-access-playbook.md).
2. Shortlist PSPs/payment aggregators/issuers.
3. Ask for mandate visibility APIs, not only merchant collection APIs.
4. Confirm if they expose active mandate, next debit, amount, merchant, and cancel/modify status.
5. Sign partner agreement.
6. Get sandbox credentials.
7. Build mandate adapter.
8. Run legal review for cancellation/modify flows.

Status env rule:

Run the exact-status validator before changing production envs:

```bash
npm run partner-rails:check
```

- `outreach-started` means email/contact form sent.
- `sandbox-requested` means partner acknowledged and requested onboarding material.
- `sandbox-approved` means sandbox credentials or invitation exists.
- `production-live` means signed production access, approved consent, production credentials, and at least one production consent test. Strict production only passes when Account Aggregator, UPI, and card mandate statuses are all `production-live`.

Stop condition:

- Do not claim direct UPI/card mandate sync until partner APIs are signed and tested.

## 10. More Provider Adapters

Live token-backed adapters now exist for:

- OpenAI organization costs.
- Gmail read-only receipt evidence.
- GitHub Copilot organization metrics reports.
- Vercel domain renewals.
- Render services.
- Cloudflare accounts.

Build order after these:

1. AWS Cost Explorer.
2. GitHub billing and Advanced Security billing.
3. Cloudflare subscriptions/billing where official account endpoints expose it.
4. Render metrics and cost mapping.
5. Vercel usage/billing surfaces beyond domains.
6. Domain registrar renewals.

Activation rule for each provider:

- First build env-gated stateless sync preview.
- Then move to per-workspace encrypted token storage.
- Then schedule sync jobs.
- Then add user-facing connection UI.

## Final Go/No-Go Checklist

You can sell private audits when:

- `/private-audit` works.
- `/api/audit-intake` persists leads.
- Payment link exists.
- Audit report export works.
- You can manually complete the audit for first users.

You can sell connected monitoring when:

- Login works.
- Database/token vault are ready.
- At least Gmail or OpenAI sync works per user/workspace.
- Sync jobs persist evidence.
- Monitoring and backups are active.

You can claim universal auto-debit coverage only when:

- Bank/AA partner is live.
- UPI/card mandate partner is live.
- App-store evidence path is clear.
- Cloud/SaaS adapters cover the target segment.
- The product shows source coverage gaps instead of pretending completeness.
