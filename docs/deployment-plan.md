# Vognary Deployment Plan

## Current Deployable Unit

The current app is a Next.js connector-first stateless audit product. It can be deployed as a server-rendered web app and used for recurring audits and connector readiness planning without server-side financial-data storage.

## Environment Contract

Copy `.env.example` to `.env.local` for local configuration. The app stays functional without optional env vars, but these features are gated:

- `WAITLIST_WEBHOOK_URL` for persisted launch/audit requests.
- `PAYMENT_LINK_*` for paid checkout links.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` for Gmail read-only receipt discovery.
- `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `SESSION_SECRET`, and either Google auth or `PRIVATE_BETA_ACCESS_CODE` for private beta login and encrypted workspace snapshots.
- `GOOGLE_AUTH_CLIENT_ID`, `GOOGLE_AUTH_CLIENT_SECRET`, and `GOOGLE_AUTH_REDIRECT_URI` for Google sign-in. This uses basic identity scopes and is separate from Gmail receipt access.
- `INTERNAL_SYNC_SECRET` for internal sync job APIs.
- `CRON_SECRET` for Vercel Cron to securely run due connector sync jobs.

### Health Check

```bash
curl http://localhost:3000/api/health
```

The health endpoint reports which components are ready and which are intentionally not configured yet.

### Stateless Audit API

```bash
curl -X POST http://localhost:3000/api/audit \
	-H 'Content-Type: application/json' \
	-d '{"sources":[{"name":"statement.csv","text":"Date,Description,Debit,Credit\n2026-01-01,OPENAI CHATGPT,1999,"}],"manualItems":[]}'
```

The API returns an audit result and stores nothing. It is rate-limited in process; use a trusted proxy plus a shared limiter such as Redis before multi-instance public scale.

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

Registered direct adapters now include `openai-costs`, `gmail-readonly`, `github-copilot`, `vercel-platform`, `render-platform`, and `cloudflare-billing`. When `OPENAI_ADMIN_API_KEY` is configured, `POST /api/connectors/openai-costs/sync` performs a read-only 30-day cost sync preview and returns normalized evidence without storing it. Queued production jobs can also use per-workspace API keys from the encrypted connector token store once a connected account has been created.

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

The app connection hub uses these routes to show connected-account status, run sync now, revoke a connection, and import persisted connector evidence into the recurring ledger.

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

Vercel Cron is configured in `vercel.json` to call `GET /api/internal/sync-jobs/due/run` once per day at `02:30 UTC` (`08:00 IST`). Set `CRON_SECRET` in Vercel; Vercel sends it as `Authorization: Bearer <CRON_SECRET>` for the cron request.

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

## Optional PostgreSQL Schema Apply

For a fresh development database:

```bash
docker compose --profile future-backend up -d postgres
DATABASE_URL=postgres://vognary:vognary@localhost:5432/vognary npm run db:apply-schema
curl http://localhost:3000/api/readiness
```

This command now keeps a `schema_migrations` ledger. On a fresh database it applies `infra/postgres/schema.sql` as `0001_initial_schema`; on an existing database that already has the initial tables it records a baseline; then it applies forward-only SQL files from `infra/postgres/migrations` in sorted order.

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

### Private Beta Login And Encrypted Snapshots

```bash
curl -X POST http://localhost:3000/api/auth/login \
	-H 'Content-Type: application/json' \
	-d '{"email":"founder@example.com","accessCode":"<PRIVATE_BETA_ACCESS_CODE>"}'

curl http://localhost:3000/api/workspaces/current/audit-snapshot
```

The `/login` page can mint signed private-beta sessions when `SESSION_SECRET`, `DATABASE_URL`, and `PRIVATE_BETA_ACCESS_CODE` are configured. Signed-in beta users can save/load/delete encrypted workspace snapshots when `TOKEN_ENCRYPTION_KEY` is configured and the PostgreSQL schema is applied.

Google sign-in is also supported through `/api/auth/google/start` and `/api/auth/google/callback` when `GOOGLE_AUTH_CLIENT_ID`, `GOOGLE_AUTH_CLIENT_SECRET`, and `GOOGLE_AUTH_REDIRECT_URI` are configured.

Use the private beta activation check after deployment:

```bash
npm run production:check -- https://www.vognary.com --beta
```

`--strict` is intentionally broader and should fail until payments, Gmail OAuth, identity provider, Redis rate limiting, scheduled sync worker, monitoring, backups, and partner rails are actually configured.

## Hosted Deployment

Recommended first hosted options:

- Vercel for fastest web deployment.
- Render/Fly/Railway if using the Dockerfile.
- AWS/Azure/GCP only after backend storage and compliance requirements are clear.

See [production-beta-setup.md](production-beta-setup.md) for click-by-click private beta setup.

## Production Boundary

This product can be sold as a self-serve stateless audit tool. It should not be marketed as a regulated connected-account financial-data system until the following are complete:

- Authentication and account deletion.
- Encrypted database and object storage.
- Token vault and refresh-token rotation.
- Queue/scheduler for connector sync jobs.
- Webhook receiver and signature verification.
- Legal privacy policy and terms.
- Security review for financial documents.
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