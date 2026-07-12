# Vognary

Vognary is a connector-first recurring-money intelligence product for founders, builders, freelancers, teams, and modern households. The current product delivers a stateless recurring-spend audit and a production-shaped connector control plane: live/manual/fallback evidence works now, Gmail is ready behind OAuth configuration, and 30+ direct or partner connectors are modeled with explicit blockers instead of fake readiness.

## Current Product

- Live-source-first audit workflow with fallback statement import.
- PDF/statement export ingestion through stateless processing when direct sources are unavailable.
- Deterministic recurring-payment detector with regression tests (`npm test`).
- Cross-source evidence merging: statement rows, Gmail receipts, pasted snippets, and connector evidence describing the same commitment become one item with all proof rows and a `multi-source verified` tag instead of double-counted duplicates.
- Single-occurrence detection for recurring-by-nature charges (insurance, domains, EMI, SIP, utilities, app stores), so annual renewals seen once surface as `investigate` candidates instead of disappearing.
- Renewal calendar: projected debits for the next 45 days with day-of-month-anchored predictions, bucket totals, and due-in-7/30-day figures, in the workspace, the `/api/audit` response, and the export pack.
- Next-debit dates that never sit in the past: predictions roll forward and stale evidence is tagged honestly.
- Price-change detection on stable runs (≥8% and ≥₹25 shifts), escalating `keep` to `watch` on increases.
- Pasted receipt text parsed straight into ledger candidates, merging with matching statement evidence.
- Merchant normalization for AI tools, cloud hosting, SaaS, app stores, utilities, SIPs, EMIs, and insurance.
- Recurring Money Graph dashboard.
- Confidence scores, next debit prediction, evidence trail, and founder action labels.
- Fine-grained connector honesty states (`live`, `setup-ready`, `token-required`, `oauth-required`, `verification-required`, `partner-gated`, `blocked`, `evidence-only`, `planned`) surfaced in `/api/connectors` and on `/integrations`.
- Audit-pack trust levels: every JSON export has an offline SHA-256 self-checksum and local chain metadata; authenticated exports additionally receive an Ed25519 Vognary issuer signature when signing is configured. `/verify` checks both locally and states clearly that a self-checksum alone does not prove authorship.
- Verified Savings: cancel/downgrade outcomes proven by evidence-of-absence — a saving is only "verified" when expected debits pass inside covered evidence without recurring.
- Proof Graph: single-source vs multi-source spend, stale evidence, and the ranked next-best source to connect, computed from what is actually at stake.
- Guided Proof Capture wizard for UPI AutoPay, app-store, and bank e-mandate screens; RBI pre-debit notification parsing (day-first dates) through the receipt path.
- Month-over-month review diffs, explainable duplicate resolution with user merge decisions, PII redaction on exports, and Indian bank statement format detection (HDFC/ICICI/SBI/Axis/Kotak).
- The 10/10 master plan with measurable exit criteria lives in [docs/path-to-10.md](docs/path-to-10.md).
- JSON export for audit reports.
- PDF report export, CSV export, and private workspace backup/import.
- Source guide, completeness score, receipt snippet parsing, and priority actions.
- Connector registry and readiness APIs for 42 provider targets.
- Connector start/sync planning APIs with honest states for live, planned, and partner-required sources.
- Direct provider adapters for OpenAI costs, Gmail receipt evidence, GitHub Copilot metrics reports, Vercel domains, Render services, and Cloudflare accounts.
- Authenticated API-key connector storage for OpenAI, GitHub, Vercel, Render, and Cloudflare sync, with encrypted token refs and queued initial sync jobs.
- Registered Gmail read-only sync adapter that can refresh stored OAuth tokens and persist receipt evidence from queued sync jobs.
- API rate limiting on public/heavy endpoints.
- Signed connector webhook endpoint with HMAC verification and optional PostgreSQL event persistence.
- Internal-secret-gated sync job API that can queue and run registered adapters into PostgreSQL evidence tables once `DATABASE_URL` and `INTERNAL_SYNC_SECRET` are configured.
- Vercel Cron-compatible due-job runner guarded by `CRON_SECRET` for scheduled connected-account sync.
- Signed session-cookie and workspace authorization primitives, exposed through closed-by-default auth/workspace APIs.
- Resend magic-link login route with one-time PostgreSQL challenges for public session issuance once email credentials are configured.
- Gmail OAuth receipt connector with state validation, browser import fallback, and encrypted token persistence for signed-in users when the database and token vault are configured.
- PostgreSQL schema for the future persistent connected-account backend.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Copy `.env.example` to `.env.local` when enabling waitlist persistence, payment links, Gmail OAuth, or future connected-account storage.

Launch page: http://localhost:3000/launch
Private beta login: http://localhost:3000/login
Profile and data controls: http://localhost:3000/profile
Private audit intake: http://localhost:3000/private-audit
Source guide: http://localhost:3000/sources
Integration hub: http://localhost:3000/integrations

## Validation Command

```bash
npm run build
npm run lint
npm test
npm run smoke
npm run production:check -- https://www.vognary.com
npm run ops:preflight -- --report-only https://www.vognary.com
npm run monitoring:test -- https://www.vognary.com
npm run partner-rails:check
```

## Health Check

```bash
curl http://localhost:3000/api/health
```

## Stateless Audit API

```bash
curl -X POST http://localhost:3000/api/audit \
	-H 'Content-Type: application/json' \
	-d '{"sources":[{"name":"statement.csv","text":"Date,Description,Debit,Credit\n2026-01-01,OPENAI CHATGPT,1999,"}],"manualItems":[],"receiptTexts":["OpenAI invoice paid INR 1,999 on 2026-07-06. ChatGPT Plus renews monthly."]}'
```

The response includes the audit (with cross-source-merged recurring items) and a 45-day `timeline` of projected renewals.

## Connector Readiness APIs

```bash
curl http://localhost:3000/api/connectors
curl http://localhost:3000/api/connectors/gmail-readonly/start
curl http://localhost:3000/api/connectors/openai-costs/sync
curl http://localhost:3000/api/readiness
```

`GET` returns the public readiness plan. Provider execution uses an authenticated workspace account and that account's encrypted credential. Environment-backed previews are hard-disabled in production and are opt-in outside production.

Webhook route shape:

```bash
curl -X POST http://localhost:3000/api/connectors/openai-costs/webhook \
	-H 'Content-Type: application/json' \
	-H 'X-Vognary-Signature: sha256=<hmac-sha256-hex>' \
	-d '{"id":"provider-event-id","type":"connector.event"}'
```

Internal sync job route shape:

```bash
curl -X POST http://localhost:3000/api/internal/sync-jobs \
	-H 'Content-Type: application/json' \
	-H 'Authorization: Bearer <INTERNAL_SYNC_SECRET>' \
	-d '{"connectorId":"openai-costs","workspaceId":"<workspace-uuid>"}'
curl -X POST http://localhost:3000/api/internal/sync-jobs/due/run \
	-H 'Authorization: Bearer <INTERNAL_SYNC_SECRET>'
curl -X POST http://localhost:3000/api/connectors/openai-costs/start \
	-H 'Content-Type: application/json' \
	-H 'Cookie: vognary_session=<signed-session-cookie>' \
	-d '{"workspaceId":"<workspace-uuid>","apiKey":"<WORKSPACE_OPENAI_ADMIN_KEY>","displayName":"OpenAI org costs"}'
curl http://localhost:3000/api/workspaces/current/connectors \
	-H 'Cookie: vognary_session=<signed-session-cookie>'
curl -X POST http://localhost:3000/api/workspaces/current/connectors/<connected-account-id>/sync \
	-H 'Cookie: vognary_session=<signed-session-cookie>'
curl -X DELETE http://localhost:3000/api/workspaces/current/connectors/<connected-account-id> \
	-H 'Cookie: vognary_session=<signed-session-cookie>'
```

Auth/workspace route shape:

```bash
curl http://localhost:3000/api/auth/session
curl -X POST http://localhost:3000/api/auth/magic-link/request \
	-H 'Content-Type: application/json' \
	-d '{"email":"founder@example.com","redirectPath":"/"}'
curl -X POST http://localhost:3000/api/auth/logout
curl http://localhost:3000/api/profile
curl http://localhost:3000/api/workspaces
curl http://localhost:3000/api/workspaces/current/audit-snapshot
curl -X POST http://localhost:3000/api/workspaces/current/audit-snapshot \
	-H 'Content-Type: application/json' \
	-d '{"title":"Vognary workspace state","expectedRevision":null,"summary":{"recurringCount":0},"snapshot":{"version":1,"exportedAt":"2026-07-11T00:00:00.000Z","statementSources":[],"manualItems":[],"userActions":{},"itemOwners":{},"reviewNotes":{},"teamMembers":[]}}'
```

Without a current, unrevoked `vognary_session`, workspace routes return `401`; protected requests also recheck the user's database record and workspace membership. The `/login` page supports Resend magic links backed by `SESSION_SECRET`, `DATABASE_URL`, `RESEND_API_KEY`, and `RESEND_FROM_EMAIL`, plus Google identity. Code login is unavailable in production; an explicitly enabled, email-bound development identity is available only outside production. Automatic encrypted workspace state additionally requires `TOKEN_ENCRYPTION_KEY`. Signed-in state uses optimistic revisions and transactionally materializes upload/manual evidence into normalized ledger rows.

Generate a future token-vault key with:

```bash
npm run secrets:generate-token-key
```

Generate a separate database-backup key with:

```bash
npm run secrets:generate-backup-key
```

Apply or advance the PostgreSQL schema with:

```bash
DATABASE_URL='<postgres-url>' POSTGRES_SSL=true npm run db:apply-schema
```

The command maintains `schema_migrations`, baselines the initial schema when needed, and applies forward-only SQL files from `infra/postgres/migrations`.

With a migrated disposable PostgreSQL database, run the real repository integration tests:

```bash
DATABASE_URL='<disposable-postgres-url>' POSTGRES_SSL=false npm run test:postgres
```

Create an encrypted PostgreSQL backup, upload it to S3/R2-compatible storage when storage envs are present, and prove restore against a disposable database with:

```bash
DATABASE_URL='<production-postgres-url>' BACKUP_ENCRYPTION_KEY='<backup-key>' POSTGRES_SSL=true npm run backup:postgres
RESTORE_DATABASE_URL='<disposable-postgres-url>' RESTORE_CONFIRM_DISPOSABLE=true BACKUP_ENCRYPTION_KEY='<backup-key>' POSTGRES_SSL=true npm run backup:restore-drill -- backups/postgres/<backup>.manifest.json
```

Use `npm run ops:preflight -- --report-only https://www.vognary.com` to check local PostgreSQL client tools, backup storage upload envs, restore-drill proof, Upstash, monitoring, internal cron secrets, and live production hardening without printing secret values.
If `pg_dump` or `pg_restore` are not installed locally, the backup scripts use Docker with the official `postgres:16` image as a fallback when Docker is available.

Production rate-limited endpoints fail closed when `NODE_ENV=production` and Upstash is not configured. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`; use `ALLOW_IN_MEMORY_RATE_LIMITS=true` only as a temporary emergency bypass.

## Deployment

See [docs/deployment-plan.md](docs/deployment-plan.md). The current app supports self-serve audits plus automatic encrypted signed-in workspace state and normalized upload/manual ledger rows. Production persistence, connected-account token references, scheduled sync/alerts/retention, and privacy exports require `DATABASE_URL`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `INTERNAL_SYNC_SECRET`, `CRON_SECRET`, Upstash Redis, monitoring, backup/restore proof, and relevant provider credentials. Original financial files are processed request-time and should not be retained until encrypted object storage, field-level retention, and restore/deletion operations are proven.

## Product Direction

Vognary should not become a generic budget app. The wedge is recurring financial commitments: subscriptions, card e-mandates, UPI AutoPay, EMIs, SIPs, insurance, SaaS, cloud bills, domains, app-store subscriptions, and utilities.

The integration strategy is documented in [docs/universal-integration-operating-model.md](docs/universal-integration-operating-model.md). It defines how Vognary moves each source from launchpad target to real connector using OAuth, API keys, IAM roles, webhooks, or regulated partner APIs.

The current legal integration execution report is documented in [docs/legal-platform-integration-action-report.md](docs/legal-platform-integration-action-report.md). It separates what is complete in production from what requires external credentials, payment setup, monitoring, storage, or regulated partner approval.

See:

- [docs/universal-integration-operating-model.md](docs/universal-integration-operating-model.md)
- [docs/legal-platform-integration-action-report.md](docs/legal-platform-integration-action-report.md)
- [docs/product-architecture.md](docs/product-architecture.md)
- [docs/production-activation-runbook.md](docs/production-activation-runbook.md)
- [docs/renewal-alerts-runbook.md](docs/renewal-alerts-runbook.md)
- [docs/validation-playbook.md](docs/validation-playbook.md)
- [docs/market-entry-research.md](docs/market-entry-research.md)
- [docs/current-state-and-market-gap-analysis.md](docs/current-state-and-market-gap-analysis.md)
- [docs/production-beta-setup.md](docs/production-beta-setup.md)
- [docs/private-audit-outreach-kit.md](docs/private-audit-outreach-kit.md)
- [docs/private-audit-pipeline-template.csv](docs/private-audit-pipeline-template.csv)
- [docs/deployment-plan.md](docs/deployment-plan.md)
- [docs/path-to-10.md](docs/path-to-10.md)
- [docs/product-perfection-plan.md](docs/product-perfection-plan.md)
- [docs/7-day-execution-plan.md](docs/7-day-execution-plan.md)
- [docs/phase-roadmap.md](docs/phase-roadmap.md)
- [docs/integration-checklist.md](docs/integration-checklist.md)
- [docs/investor-demo-script.md](docs/investor-demo-script.md)
- [docs/day-90-completion-report.md](docs/day-90-completion-report.md)
- [docs/production-standard-report.md](docs/production-standard-report.md)
