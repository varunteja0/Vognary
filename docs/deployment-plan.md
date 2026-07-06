# Vognary Deployment Plan

## Current Deployable Unit

The current app is a Next.js connector-first stateless audit product. It can be deployed as a server-rendered web app and used for recurring audits and connector readiness planning without server-side financial-data storage.

## Environment Contract

Copy `.env.example` to `.env.local` for local configuration. The app stays functional without optional env vars, but these features are gated:

- `WAITLIST_WEBHOOK_URL` for persisted launch/audit requests.
- `PAYMENT_LINK_*` for paid checkout links.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` for Gmail read-only receipt discovery.
- `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, and `SESSION_SECRET` for the future persistent connected-account backend.

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

These endpoints return readiness, blockers, and implementation steps. Most connectors do not execute provider sync jobs until token storage and workers are implemented.

The first direct adapter is `openai-costs`: when `OPENAI_ADMIN_API_KEY` is configured, `POST /api/connectors/openai-costs/sync` performs a read-only 30-day cost sync preview and returns normalized evidence without storing it. In production this must move from env credentials to per-workspace encrypted token storage.

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
```

These routes are not user-facing. They require `INTERNAL_SYNC_SECRET` and `DATABASE_URL`. They create `connector_sync_jobs`, create `connector_sync_runs`, execute registered adapters, and persist normalized evidence into `connector_evidence`.

### Gmail Read-Only OAuth

```bash
curl http://localhost:3000/api/integrations/gmail/start
```

Without Google OAuth env vars, this returns a `not-configured` response. With `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`, it starts the Gmail read-only consent flow, validates OAuth state on callback, and returns receipt candidates from recent invoice/subscription emails without storing tokens.

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

This applies the schema once. Production deployments should replace this with migrations before multiple schema revisions exist.

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

## Hosted Deployment

Recommended first hosted options:

- Vercel for fastest web deployment.
- Render/Fly/Railway if using the Dockerfile.
- AWS/Azure/GCP only after backend storage and compliance requirements are clear.

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
2. Expose authenticated connected-account flows that store provider tokens in the encrypted token store.
3. Promote OpenAI sync from env preview to per-workspace token-backed sync jobs.
4. Add a worker daemon or managed scheduler that calls the internal sync-job routes.
5. Convert Gmail preview into persistent receipt sync.
6. Add AWS, GitHub/Copilot, Cloudflare, Render, Vercel, and domain adapters.
7. Add object storage for encrypted uploaded files.
8. Add Account Aggregator integration through a compliant partner/TSP route.