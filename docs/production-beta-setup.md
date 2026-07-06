# Vognary Private Beta Production Setup

Use this guide to make `https://www.vognary.com` usable for private beta users with login, encrypted workspace snapshots, and lead capture.

## What You Are Setting Up Now

Private beta readiness means these work in production:

- `/private-audit` captures audit requests.
- `/login` lets invited users sign in with a beta access code.
- Signed-in users can save/load/delete encrypted workspace snapshots.
- `/api/workspaces` stays locked without a valid signed session.

This does not mean Vognary has live UPI/card mandate, Account Aggregator, Apple, Google Play, PayPal, Razorpay, or Cashfree sync yet.

## Do Not Share Secrets In Chat

Generate secrets locally and paste them directly into your hosting dashboard. Do not paste production secrets into GitHub issues, chat, screenshots, or docs.

## Required Production Environment Variables

Set these first:

```text
DATABASE_URL
SESSION_SECRET
TOKEN_ENCRYPTION_KEY
GOOGLE_AUTH_CLIENT_ID
GOOGLE_AUTH_CLIENT_SECRET
GOOGLE_AUTH_REDIRECT_URI
```

Keep `PRIVATE_BETA_ACCESS_CODE` as a fallback if you still want code-based beta access.

Lead capture is free with the same Postgres database. `AUDIT_INTAKE_WEBHOOK_URL` or `WAITLIST_WEBHOOK_URL` is optional if you also want to mirror leads into a spreadsheet or automation tool.

## Free-Tier Pieces To Use Now

These can be activated without monthly software spend, though some still require account setup or KYC:

| Need | Free path | Can be completed in code? | What still blocks it |
| --- | --- | --- | --- |
| Database and lead persistence | Neon Postgres free tier | Yes, code now stores leads in Postgres | You must create the Neon DB, set `DATABASE_URL`, and apply schema. |
| Private beta login | Google OAuth basic identity, or beta access code | Yes | You must create Google OAuth credentials or set `PRIVATE_BETA_ACCESS_CODE`. |
| Magic-link login | Resend free tier | Yes | You must verify a sender/domain and set `RESEND_API_KEY`, `RESEND_FROM_EMAIL`. |
| Gmail receipt sync | Google OAuth + Gmail API | Yes for preview sync | You must create OAuth credentials and complete Google verification before public users. |
| Shared rate limiting | Upstash Redis free tier | Yes | You must create Upstash Redis and set REST URL/token. |
| Monitoring | Sentry or Better Stack free tier | Yes | You must create the project/source and set DSN/token. |
| Backups | Neon PITR/free backup controls where available | Partly | You must run a restore drill and set `BACKUP_RESTORE_DRILL_STATUS=passed`. |
| Payment links | Razorpay/Stripe has no monthly fee | No | You must complete account/KYC and create real links. |
| OpenAI cost sync | No free substitute for org admin cost data | No | Needs a real OpenAI admin key. |
| AA/UPI/card mandate rails | No free self-serve substitute | No | Needs partner/sandbox approval. |

## Generate Secret Values Locally

Run these in your local terminal:

```bash
cd /Users/varunteja/Desktop/Vognary
npm run secrets:generate-token-key
openssl rand -base64 32
openssl rand -base64 32
```

Use the outputs like this:

- `TOKEN_ENCRYPTION_KEY`: use the value printed by `npm run secrets:generate-token-key` after `TOKEN_ENCRYPTION_KEY=`.
- `SESSION_SECRET`: use the first `openssl rand -base64 32` output.
- `INTERNAL_SYNC_SECRET`: use the second `openssl rand -base64 32` output when you enable internal sync jobs.

For `PRIVATE_BETA_ACCESS_CODE`, choose a memorable invite code and rotate it if it leaks. Example format:

```text
vognary-beta-2026-<private-word>
```

## Create Google Login Credentials

Use Google login for a more trustworthy beta sign-in. This uses only basic identity scopes: `openid email profile`. It does not read Gmail.

1. Open `https://console.cloud.google.com`.
2. Select or create a project named `Vognary`.
3. In the top search bar, search `APIs & Services`.
4. Open `OAuth consent screen`.
5. Choose `External` unless you only want your own Google Workspace users.
6. App name: `Vognary`.
7. User support email: your email.
8. Developer contact email: your email.
9. Save and continue.
10. Scopes: keep basic scopes only. Do not add Gmail scopes here for login.
11. Add yourself as a test user if Google asks.
12. Go to `Credentials`.
13. Click `Create Credentials`.
14. Click `OAuth client ID`.
15. Application type: `Web application`.
16. Name: `Vognary Web Login`.
17. Under `Authorized redirect URIs`, add:

```text
https://www.vognary.com/api/auth/google/callback
```

18. Also add this for local testing:

```text
http://localhost:3000/api/auth/google/callback
```

19. Click `Create`.
20. Copy the `Client ID` and `Client secret`.

Use them as:

```text
GOOGLE_AUTH_CLIENT_ID=<Google OAuth Client ID>
GOOGLE_AUTH_CLIENT_SECRET=<Google OAuth Client Secret>
GOOGLE_AUTH_REDIRECT_URI=https://www.vognary.com/api/auth/google/callback
```

Optional beta restriction:

```text
GOOGLE_AUTH_ALLOWED_EMAILS=your@email.com,second@email.com
```

or restrict a whole Google Workspace domain:

```text
GOOGLE_AUTH_ALLOWED_DOMAIN=yourcompany.com
```

## Create A Production Database

Recommended easiest path: Neon Postgres.

1. Open `https://console.neon.tech`.
2. Sign in.
3. Click `New Project`.
4. Project name: `vognary-production`.
5. Region: choose the closest stable region for your users.
6. Click `Create Project`.
7. Open `Connection Details`.
8. Copy the pooled connection string.
9. Use that value as `DATABASE_URL`.

For most managed Postgres providers, set:

```text
POSTGRES_SSL=true
POSTGRES_SSL_REJECT_UNAUTHORIZED=true
```

If your provider requires a CA certificate, also set `POSTGRES_CA_CERT`.

## Apply The Database Schema

After `DATABASE_URL` is set locally or available in your shell, run:

```bash
cd /Users/varunteja/Desktop/Vognary
DATABASE_URL="<paste-production-database-url-here>" POSTGRES_SSL=true npm run db:apply-schema
```

Expected success output contains:

```json
{
  "status": "ok"
}
```

Stop if this fails. Do not continue to public beta until schema apply succeeds.

## Where To Set Env Vars In Vercel

Use this if `vognary.com` is deployed on Vercel.

1. Open `https://vercel.com/dashboard`.
2. Click the `Vognary` project.
3. Click `Settings`.
4. Click `Environment Variables`.
5. Add each variable below.
6. Select environments: `Production`, `Preview`, and `Development` unless you intentionally want production only.
7. Click `Save` after each variable.

Add:

```text
NEXT_PUBLIC_APP_URL=https://www.vognary.com
DATABASE_URL=<your Neon/Postgres connection string>
POSTGRES_SSL=true
POSTGRES_SSL_REJECT_UNAUTHORIZED=true
SESSION_SECRET=<generated locally>
TOKEN_ENCRYPTION_KEY=<generated locally>
GOOGLE_AUTH_CLIENT_ID=<Google OAuth Client ID>
GOOGLE_AUTH_CLIENT_SECRET=<Google OAuth Client Secret>
GOOGLE_AUTH_REDIRECT_URI=https://www.vognary.com/api/auth/google/callback
```

Optional beta code fallback:

```text
PRIVATE_BETA_ACCESS_CODE=<your invite code>
```

Optional but useful now:

```text
AUDIT_INTAKE_WEBHOOK_URL=<optional lead webhook mirror>
WAITLIST_WEBHOOK_URL=<same lead webhook if you want launch page leads persisted>
PAYMENT_LINK_PERSONAL_PRO=<Razorpay/Stripe payment link>
PAYMENT_LINK_FOUNDER_PRO=<Razorpay/Stripe payment link>
PAYMENT_LINK_TEAM=<Razorpay/Stripe payment link>
PAYMENT_LINK_ANNUAL_AUDIT=<Razorpay/Stripe payment link>
```

Do not set fake values just to make a check green. Leave future integrations blank until they are real.

## Redeploy On Vercel

1. In Vercel, open the `Vognary` project.
2. Click `Deployments`.
3. Open the latest deployment menu.
4. Click `Redeploy`.
5. Keep `Use existing Build Cache` checked unless you suspect dependency issues.
6. Click `Redeploy`.
7. Wait until status is `Ready`.

## Verify Private Beta Activation

Run:

```bash
cd /Users/varunteja/Desktop/Vognary
npm run production:check -- https://www.vognary.com --beta
```

Expected result:

```text
Endpoint health: PASS
Private beta activation: READY
```

Do not use `--strict` for today's private beta. `--strict` expects payments, Gmail OAuth, real identity provider, Redis rate limiting, monitoring, backup storage, and partner rails. It should fail until those are actually configured.

Use strict only later:

```bash
npm run production:check -- https://www.vognary.com --strict
```

## Manual Browser Test

After `--beta` passes:

1. Open `https://www.vognary.com/login`.
2. Click `Continue with Google`.
3. Choose your Google account.
4. Complete Google sign-in.
5. Open `https://www.vognary.com/`.
6. Add 2 manual commitments, for example `Claude` and `Render`.
7. Click `Save encrypted snapshot`.
8. Refresh the page.
9. Click `Load latest`.

Expected success message:

```text
Encrypted server snapshot loaded into this browser.
```

Then verify profile and data controls:

1. Open `https://www.vognary.com/profile`.
2. Confirm your email is shown.
3. Confirm your workspace is shown.
4. Confirm stored data counts are visible.
5. Confirm pending integrations are listed.
6. Do not click delete unless you intentionally want to remove the beta account.

If login, save/load snapshot, and profile all work, Vognary is private-beta usable.

## What To Share With Users

Share this first:

```text
https://www.vognary.com/private-audit
```

Message:

```text
I am running 10 private Vognary recurring-money audits this week.

It finds recurring payments across SaaS, AI tools, cloud, domains, app stores, UPI AutoPay, card mandates, insurance, EMIs, SIPs, utilities, and receipt emails.

You do not need to upload anything immediately. First fill this intake:
https://www.vognary.com/private-audit

After that I will tell you the safest minimum source to share. You can redact sensitive details.
```

## If Something Fails

| Failure | Meaning | Fix |
| --- | --- | --- |
| Google sign-in says not configured | Missing Google OAuth envs | Set `GOOGLE_AUTH_CLIENT_ID`, `GOOGLE_AUTH_CLIENT_SECRET`, `GOOGLE_AUTH_REDIRECT_URI`. |
| Google says redirect URI mismatch | Google Console URI does not match | Add `https://www.vognary.com/api/auth/google/callback` exactly in Google OAuth client. |
| `/login` shows not configured | Missing envs | Set `DATABASE_URL`, `SESSION_SECRET`, `PRIVATE_BETA_ACCESS_CODE`. |
| `/` opens login instead of app | You are signed out | Sign in with Google first; anonymous users cannot access the audit workspace. |
| `/profile` opens login instead of profile | You are signed out | Sign in with Google first. |
| Save encrypted snapshot fails | Missing token key or DB | Set `TOKEN_ENCRYPTION_KEY`, verify `DATABASE_URL`, apply schema. |
| Intake says preview/local only | Missing webhook | Set `AUDIT_INTAKE_WEBHOOK_URL` or `WAITLIST_WEBHOOK_URL`. |
| `--strict` fails | Expected today | Use `--beta`; strict is for full production maturity. |
| Schema apply fails | DB connection/SSL issue | Check `DATABASE_URL`, `POSTGRES_SSL`, and provider SSL docs. |

## Stop Conditions

Stop and fix before inviting users if:

- `npm run production:check -- https://www.vognary.com --beta` fails.
- You cannot log in with the beta access code.
- You cannot save and load an encrypted snapshot.
- You cannot open `/profile` after login.
- Lead intake does not persist anywhere you can read.
