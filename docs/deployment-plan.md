# Vognary Deployment Plan

## Current Deployable Unit

The current app is a Next.js modular product with a stateless guest audit path and a PostgreSQL living ledger for signed-in workspaces. When migrations and
runtime dependencies are active, it supports revisioned encrypted workspace sync, normalized upload/manual materialization, revocable sessions, consent-bound connected sources, privacy lifecycle execution,
consent-gated renewal email alerts, durable commitment decisions, and cursor-paginated read-only platform APIs. Those persistent capabilities must
not be described as active merely because their routes exist.

## Environment Contract

Copy `.env.example` to `.env.local` for local configuration. The app stays functional without optional env vars, but these features are gated:

- `DATABASE_URL` or `AUDIT_INTAKE_WEBHOOK_URL` for durable private-audit requests.
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`, and legally approved `ASSISTED_AUDIT_LEGAL_TERMS_STATUS=approved` for the tracked one-time assisted-audit checkout.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` for Gmail read-only receipt discovery.
- `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, and `SESSION_SECRET`, plus verified Google identity or Resend magic links, for revocable sessions and automatic encrypted workspace state.
- `GOOGLE_AUTH_CLIENT_ID`, `GOOGLE_AUTH_CLIENT_SECRET`, and `GOOGLE_AUTH_REDIRECT_URI` for Google sign-in. This uses basic identity scopes and is separate from Gmail receipt access.
- `INTERNAL_SYNC_SECRET` for internal sync job APIs.
- `CRON_SECRET` for Vercel Cron to authenticate connector-sync, renewal-alert, and retention workers.
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `NEXT_PUBLIC_APP_URL` for opted-in renewal email delivery.
- A migrated `DATABASE_URL` provides production multi-instance and platform-API rate limiting automatically; `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` optionally take priority at higher scale.
- `SYNC_SCHEDULER_STATUS`, `RENEWAL_ALERT_DELIVERY_STATUS`, and `RETENTION_SCHEDULER_STATUS` only after the production runbook evidence
  gates are complete. Leave them blank during setup.

### Health Check

```bash
curl http://localhost:3000/api/health
```

The public health endpoint reports liveness only and intentionally exposes no deployment configuration. Detailed capability readiness is
available from `/api/readiness`; production requests to that route require `Authorization: Bearer <INTERNAL_SYNC_SECRET>`.

### Stateless Audit API

```bash
curl -X POST http://localhost:3000/api/audit \
	-H 'Content-Type: application/json' \
	-d '{"sources":[{"name":"statement.csv","text":"Date,Description,Debit,Credit\n2026-01-01,OPENAI CHATGPT,1999,"}],"manualItems":[]}'
```

The API returns an audit result and stores nothing. Production rate limits are shared through atomic Postgres buckets, or Upstash REST when configured.

### Stateless File Ingestion API

```bash
curl -X POST http://localhost:3000/api/ingest \
	-F 'files=@/path/to/your-statement.csv'
```

The ingestion API accepts structured statement exports and PDF. Structured exports are passed through directly. PDF text is extracted and converted through a conservative transaction-line heuristic, and any warnings are returned to the UI. It is rate-limited because PDF parsing is compute-heavy.

### Connector Readiness APIs

```bash
curl http://localhost:3000/api/connectors
curl http://localhost:3000/api/connectors/gmail-readonly/start
curl http://localhost:3000/api/connectors/openai-costs/sync
```

These endpoints return readiness, blockers, and implementation steps. Registered adapters can execute provider sync jobs through the internal job runner when database, token vault, and scheduler secrets are configured.

Registered direct adapters now include `openai-costs`, `gmail-readonly`, `github-copilot`, `vercel-platform`, `render-platform`, and `cloudflare-billing`. Public `GET` routes expose only readiness plans. Production execution requires an authenticated workspace account and its encrypted provider credential; environment-backed previews are disabled in production.

Signed-in workspace admins can store API-key connector credentials through the connector start route:

```bash
curl -X POST http://localhost:3000/api/connectors/openai-costs/start \
	-H 'Content-Type: application/json' \
	-H 'Cookie: vognary_session=<signed-session-cookie>' \
	-d '{"workspaceId":"<workspace-uuid>","apiKey":"<provider-api-key>","displayName":"OpenAI org costs"}'
```

The response never returns the secret. It stores the key through the AES-256-GCM token vault and queues an `initial_sync` job for the connected account. For GitHub Copilot, include `providerAccountId` with the GitHub organization slug. For Vercel and Render, `providerAccountId` can scope the team/owner when needed.

Signed-in users can inspect connected accounts and persisted connector evidence from the workspace endpoint:

```bash
curl http://localhost:3000/api/workspaces/current/connectors \
	-H 'Cookie: vognary_session=<signed-session-cookie>'

curl -X POST http://localhost:3000/api/workspaces/current/connectors/<connected-account-id>/sync \
	-H 'Cookie: vognary_session=<signed-session-cookie>'

curl -X DELETE http://localhost:3000/api/workspaces/current/connectors/<connected-account-id> \
	-H 'Cookie: vognary_session=<signed-session-cookie>'
```

The app connection hub uses these routes to show connected-account status, retry failed sync, revoke a connection, and consume persisted connector evidence automatically in the recurring ledger.

### Signed Connector Webhooks

```bash
curl -X POST http://localhost:3000/api/connectors/openai-costs/webhook \
	-H 'Content-Type: application/json' \
	-H 'X-Vognary-Signature: sha256=<hmac-sha256-hex>' \
	-d '{"id":"provider-event-id","type":"connector.event"}'
```

Set `CONNECTOR_WEBHOOK_SECRET_<CONNECTOR_ID>` such as `CONNECTOR_WEBHOOK_SECRET_OPENAI_COSTS`, or a fallback `CONNECTOR_WEBHOOK_SECRET`. Without a secret, the route returns `not-configured`; with a valid signature and `DATABASE_URL`, it persists the webhook event to `connector_webhook_events`.

### Internal Sync Job Execution

```bash
curl -X POST http://localhost:3000/api/internal/sync-jobs \
	-H 'Content-Type: application/json' \
	-H 'Authorization: Bearer <INTERNAL_SYNC_SECRET>' \
	-d '{"connectorId":"openai-costs","workspaceId":"<workspace-uuid>"}'

curl -X POST http://localhost:3000/api/internal/sync-jobs/<job-id>/run \
	-H 'Authorization: Bearer <INTERNAL_SYNC_SECRET>'

curl -X POST http://localhost:3000/api/internal/sync-jobs/due/run \
	-H 'Authorization: Bearer <INTERNAL_SYNC_SECRET>'
```

These routes are not user-facing. They require `INTERNAL_SYNC_SECRET` and `DATABASE_URL`. They create `connector_sync_jobs`, create `connector_sync_runs`, execute registered adapters, and persist normalized evidence into `connector_evidence`.

Vercel Cron is configured in `vercel.json` to call `GET /api/internal/sync-jobs/due/run` daily at 05:30 IST (`00:00 UTC`),
`GET /api/internal/renewal-alerts/due/run` daily at 09:00 IST (`03:30 UTC`), and the fixed-policy retention worker daily at 03:00 IST (`21:30 UTC`). These once-daily schedules are compatible with the Vercel Hobby plan; due sync work and reminders can wait until the next daily invocation. Set `CRON_SECRET` in Vercel; Vercel sends it as
`Authorization: Bearer <CRON_SECRET>`. The secret proves authentication configuration, not that the deployed schedules are firing; use
the activation-runbook evidence gates before setting either production status flag.

### Gmail Read-Only OAuth

```bash
curl http://localhost:3000/api/integrations/gmail/start
```

Without Google OAuth env vars, this returns a `not-configured` response. With `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`, it starts the Gmail read-only consent flow, validates OAuth state on callback, and returns receipt candidates from recent invoice/subscription emails. Signed-in users with `DATABASE_URL` and `TOKEN_ENCRYPTION_KEY` configured also get encrypted Gmail token persistence and an initial queued sync job. The registered Gmail adapter can refresh tokens and persist normalized receipt evidence through the internal sync runner.

## Local Production Run

```bash
npm ci
npm run build
npm run start -- --hostname 0.0.0.0 --port 3000
```

## Docker Run

```bash
docker compose up --build web
```

Then open http://localhost:3000.

## PostgreSQL Schema Apply For Persistent Features

For a fresh development database:

```bash
docker compose up --build web
curl http://localhost:3000/api/readiness
```

Compose waits for PostgreSQL 16, runs the schema migration service to completion, and then starts the web service. The migration command keeps a `schema_migrations` ledger. On a fresh database it applies `infra/postgres/schema.sql` as `0001_initial_schema`; on an existing database that already has the initial tables it records a baseline; then it applies forward-only SQL files from `infra/postgres/migrations` in sorted order.

Vercel production deployments run the same checksummed, advisory-locked migration command before `next build`. Preview and local builds skip this production mutation. A migration failure stops the deployment before the new application artifact can become live.

Readiness requires every forward migration from `0002_revocable_sessions` through `0017_shared_rate_limits`, then runs bounded aggregate queries against capability tables. `capabilities.schema.status=ready` means the migration ledger and those queries succeeded; it does not prove a deployed schedule, delivered renewal email, paid assisted-audit order, legal approval, provider approval, or platform adoption. Sync-worker production status additionally requires a successful cron-invoked run that wrote evidence. CI applies the schema to PostgreSQL 16 and runs `npm run test:postgres`.

Add future production schema changes as `infra/postgres/migrations/0002_short_description.sql`, `0003_short_description.sql`, and so on. Do not edit already-applied migration files.

## Optional Token Vault Key

Generate the AES-256-GCM token-vault key before enabling persistent connector credentials:

```bash
npm run secrets:generate-token-key
```

Put the generated `TOKEN_ENCRYPTION_KEY` in the deployment secret manager. `/api/readiness` reports `tokenVault.status` as `ready` only when the key decodes to 32 bytes and completes an encryption round trip.

When both `DATABASE_URL` and `TOKEN_ENCRYPTION_KEY` are configured, `/api/readiness` reports whether the connector token-store prerequisites are ready. Product routes still need auth/workspace authorization before storing real provider credentials.

## Auth And Workspace Authorization

```bash
curl http://localhost:3000/api/auth/session
curl http://localhost:3000/api/workspaces
```

The server has signed session-cookie primitives and workspace membership checks. `SESSION_SECRET` enables session verification, and `DATABASE_URL` enables workspace lookup. This is not a complete login product by itself; production still needs an identity provider, SSO, or magic-link email delivery to mint signed session cookies.

### Verified Login And Encrypted Workspace State

```bash
curl -X POST http://localhost:3000/api/auth/magic-link/request \
	-H 'Content-Type: application/json' \
	-d '{"email":"founder@example.com","redirectPath":"/app"}'

curl http://localhost:3000/api/workspaces/current/audit-snapshot
```

The `/login` page mints opaque, database-backed sessions only after verified Google identity or a one-time email link. Code login is hard-disabled in production. Signed-in beta users automatically hydrate and debounce-save one encrypted revisioned workspace state record when `TOKEN_ENCRYPTION_KEY` is configured. Stale revisions receive `409` rather than overwriting another device, and upload/manual evidence materializes transactionally into normalized ledger rows.

Google sign-in is also supported through `/api/auth/google/start` and `/api/auth/google/callback` when `GOOGLE_AUTH_CLIENT_ID`, `GOOGLE_AUTH_CLIENT_SECRET`, and `GOOGLE_AUTH_REDIRECT_URI` are configured.

Use the private beta activation check after deployment:

```bash
npm run production:check -- https://www.vognary.com --beta
```

`--strict` is intentionally broader and should fail until payments, Gmail OAuth, identity provider, feature migrations, shared rate
limiting, the attested scheduled-sync worker, privacy enforcement, a proven renewal delivery, the platform API guard, monitoring,
backups, and partner rails are actually configured or evidenced as specified in the activation runbook.

## Hosted Deployment

Recommended first hosted options:

- Vercel for fastest web deployment.
- Render/Fly/Railway if using the Dockerfile.
- AWS/Azure/GCP only after backend storage and compliance requirements are clear.

See [production-beta-setup.md](production-beta-setup.md) for click-by-click private beta setup.

## Production Boundary

The stateless audit path remains available without PostgreSQL. Persistent, automatic, platform, or regulated claims require their
separate readiness evidence. In particular, do not market Vognary as a regulated connected-account financial-data system until the
following external and operational gates are complete:

- Production identity and account-deletion exercises.
- Encrypted database, tested backups, and any required object storage.
- Token-vault rotation exercises and provider revocation verification.
- Observed production scheduler runs for connector sync and consent-gated renewal delivery.
- A deployed authenticated Vercel retention cron plus audited enforcement runs.
- Security and legal review for financial evidence and external API access.
- Gmail OAuth verification before receipt ingestion.
- Account Aggregator or regulated partner path before pulling bank data directly.
- Operational monitoring, backups, and incident response.

## Backend Roadmap

1. Add production identity provider or magic-link delivery to mint signed sessions.
2. Expand provider-specific billing depth for the live adapters where official endpoints expose costs/invoices.
3. Expand scheduled sync coverage and stuck-job recovery.
4. Complete public Gmail verification/security assessment before non-test Gmail users.
5. Normalize synced connector evidence into recurring-item history and recommendations.
6. Add AWS, Azure, GCP, GitHub billing, Stripe, PayPal, and domain registrar adapters where official user/admin APIs permit it.
7. Add object storage for encrypted uploaded files.
8. Add Account Aggregator integration through a compliant partner/TSP route.
