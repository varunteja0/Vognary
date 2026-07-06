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

## 2. Payment Links

Goal: paid CTAs can send users to a real payment page.

Recommended India-first path: Razorpay Payment Links. Stripe can be added later for international cards.

Click-by-click using Razorpay:

1. Open `https://dashboard.razorpay.com/`.
2. Log in to your Razorpay account.
3. Complete business/KYC activation if prompted.
4. In the left navigation, click `Payment Links`.
5. Click `Create Payment Link`.
6. Create `Vognary Personal Pro` for INR 999.
7. Copy the payment link URL.
8. Create `Vognary Founder Pro` for INR 4,999.
9. Copy the payment link URL.
10. Create `Vognary Team` for your team price.
11. Copy the payment link URL.
12. Create `Vognary Annual Audit` for the annual audit price.
13. Copy the payment link URL.
14. Open Vercel Dashboard.
15. Select `Vognary` project.
16. Click `Settings` > `Environment Variables`.
17. Add:
    - `PAYMENT_LINK_PERSONAL_PRO`
    - `PAYMENT_LINK_FOUNDER_PRO`
    - `PAYMENT_LINK_TEAM`
    - `PAYMENT_LINK_ANNUAL_AUDIT`
18. Paste each Razorpay link as its value.
19. Select `Production` for each.
20. Click `Save`.
21. Redeploy production.
22. Test:

```bash
curl -X POST https://www.vognary.com/api/checkout \
  -H 'Content-Type: application/json' \
  -d '{"plan":"founder"}'
```

Expected: JSON returns `status: "ready"` and a `paymentUrl`.

Stop condition:

- Do not announce paid checkout until Razorpay test payment succeeds and settlement/KYC is active.

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
17. Redeploy production.
18. Apply schema from a trusted terminal with production `DATABASE_URL` set:

```bash
DATABASE_URL='<production-neon-url>' POSTGRES_SSL=true npm run db:apply-schema
```

19. Verify:

```bash
curl https://www.vognary.com/api/readiness
```

Expected:

- `database.status` is `ready`.
- `tokenVault.status` is `ready`.
- `hardening.connectorTokenStore` is `ready` or `configured`.

Stop condition:

- If schema apply fails, do not store user credentials. Fix database/schema first.

## 5. OpenAI Cost Sync

Goal: first direct provider adapter can sync organization costs.

Click-by-click:

1. Open `https://platform.openai.com/`.
2. Log in as an organization admin.
3. Open organization/admin settings.
4. Find API keys or admin keys.
5. Create a new admin/read key for Vognary cost usage.
6. Name it `Vognary cost sync`.
7. Copy the key once.
8. Open Vercel Dashboard > Vognary > Settings > Environment Variables.
9. Add `OPENAI_ADMIN_API_KEY`.
10. Paste the key.
11. Redeploy production.
12. Test:

```bash
curl -X POST https://www.vognary.com/api/connectors/openai-costs/sync \
  -H 'Content-Type: application/json' \
  -d '{"workspaceId":"env-preview"}'
```

Expected:

- `status` is `sync-preview-complete`, or a provider-specific error if the key lacks admin cost permissions.
- `storage` is `none` until per-workspace token storage is exposed.

Stop condition:

- If OpenAI returns 401/403, rotate the key or use an organization admin key with costs access.

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

Current rate limiting falls back to in-memory when Upstash is absent. When `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are configured, API routes use shared Upstash Redis REST counters.

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
7. Verify `npm run production:check -- https://www.vognary.com` reports `Monitoring and incident alerts` as `READY`.

Better Stack alternative:

1. Open `https://betterstack.com/`.
2. Create a logs source for `Vognary web`.
3. Copy `BETTER_STACK_SOURCE_TOKEN`.
4. Add `BETTER_STACK_SOURCE_TOKEN` to Vercel.
5. Redeploy production.
6. Verify `/api/readiness` reports `hardening.monitoring` as `configured-better-stack-server-errors`.

Backups:

1. Open Neon project.
2. Go to `Branches` or `Backups`.
3. Confirm Point-in-Time Restore is enabled.
4. Set retention according to plan.
5. Create or choose encrypted backup/object storage and set one of `BACKUP_STORAGE_BUCKET`, `S3_BUCKET`, or `R2_BUCKET` in Vercel.
6. Run a restore drill before storing user financial data.
7. Add `BACKUP_RESTORE_DRILL_STATUS=passed` in Vercel only after the restore drill succeeds.
8. Redeploy production.
9. Verify `/api/readiness` reports `hardening.backups` as `configured`.

Stop condition:

- Do not store user financial source files until backup restore has been tested.

## 9. Account Aggregator / UPI / Card Mandate Partners

These cannot be completed in code alone. They need business and regulatory access.

Account Aggregator path:

1. Shortlist FIU/TSP providers in India.
2. Ask for sandbox access for account statement data.
3. Confirm permitted use case: recurring payment audit / personal finance insight.
4. Sign DPA and compliance paperwork.
5. Get sandbox credentials.
6. Build sandbox adapter.
7. Submit security review.
8. Move to production credentials.

UPI/card mandate path:

1. Shortlist PSPs/payment aggregators/issuers.
2. Ask for mandate visibility APIs, not only merchant collection APIs.
3. Confirm if they expose active mandate, next debit, amount, merchant, and cancel/modify status.
4. Sign partner agreement.
5. Get sandbox credentials.
6. Build mandate adapter.
7. Run legal review for cancellation/modify flows.

Stop condition:

- Do not claim direct UPI/card mandate sync until partner APIs are signed and tested.

## 10. More Provider Adapters

Build order after OpenAI:

1. AWS Cost Explorer.
2. GitHub billing and Copilot usage.
3. Cloudflare billing/subscriptions.
4. Render services/metrics.
5. Vercel usage/billing surfaces.
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
