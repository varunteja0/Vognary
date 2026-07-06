# Vognary

Vognary is a connector-first recurring-money intelligence product for founders, builders, freelancers, teams, and modern households. The current product delivers a stateless recurring-spend audit and a production-shaped connector control plane: live/manual/fallback evidence works now, Gmail is ready behind OAuth configuration, and 30+ direct or partner connectors are modeled with explicit blockers instead of fake readiness.

## Current Product

- Live-source-first audit workflow with fallback statement import.
- PDF/statement export ingestion through stateless processing when direct sources are unavailable.
- Deterministic recurring-payment detector.
- Merchant normalization for AI tools, cloud hosting, SaaS, app stores, utilities, SIPs, EMIs, and insurance.
- Recurring Money Graph dashboard.
- Confidence scores, next debit prediction, evidence trail, and founder action labels.
- JSON export for audit reports.
- PDF report export, CSV export, and private workspace backup/import.
- Source guide, completeness score, receipt snippet parsing, and priority actions.
- Connector registry and readiness APIs for 39 provider targets.
- Connector start/sync planning APIs with honest states for live, planned, and partner-required sources.
- First direct provider adapter: OpenAI organization costs, env-gated by `OPENAI_ADMIN_API_KEY` and returned as stateless evidence preview.
- API rate limiting on public/heavy endpoints.
- Signed connector webhook endpoint with HMAC verification and optional PostgreSQL event persistence.
- Internal-secret-gated sync job API that can queue and run registered adapters into PostgreSQL evidence tables once `DATABASE_URL` and `INTERNAL_SYNC_SECRET` are configured.
- Signed session-cookie and workspace authorization primitives, exposed through closed-by-default auth/workspace APIs.
- Resend magic-link login route with one-time PostgreSQL challenges for public session issuance once email credentials are configured.
- Gmail OAuth preview with state validation and no token persistence.
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
npm run smoke
npm run production:check -- https://www.vognary.com
```

## Health Check

```bash
curl http://localhost:3000/api/health
```

## Stateless Audit API

```bash
curl -X POST http://localhost:3000/api/audit \
	-H 'Content-Type: application/json' \
	-d '{"sources":[{"name":"statement.csv","text":"Date,Description,Debit,Credit\n2026-01-01,OPENAI CHATGPT,1999,"}],"manualItems":[]}'
```

## Connector Readiness APIs

```bash
curl http://localhost:3000/api/connectors
curl http://localhost:3000/api/connectors/gmail-readonly/start
curl http://localhost:3000/api/connectors/openai-costs/sync
curl -X POST http://localhost:3000/api/connectors/openai-costs/sync \
	-H 'Content-Type: application/json' \
	-d '{"workspaceId":"env-preview"}'
curl http://localhost:3000/api/readiness
```

Without `OPENAI_ADMIN_API_KEY`, OpenAI sync returns an honest blocked state. With the key configured, it performs a read-only 30-day cost sync preview and stores nothing.

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
```

Auth/workspace route shape:

```bash
curl http://localhost:3000/api/auth/session
curl -X POST http://localhost:3000/api/auth/login \
	-H 'Content-Type: application/json' \
	-d '{"email":"founder@example.com","accessCode":"<PRIVATE_BETA_ACCESS_CODE>"}'
curl -X POST http://localhost:3000/api/auth/magic-link/request \
	-H 'Content-Type: application/json' \
	-d '{"email":"founder@example.com","redirectPath":"/"}'
curl -X POST http://localhost:3000/api/auth/logout
curl http://localhost:3000/api/profile
curl http://localhost:3000/api/workspaces
curl http://localhost:3000/api/workspaces/current/audit-snapshot
curl -X POST http://localhost:3000/api/workspaces/current/audit-snapshot \
	-H 'Content-Type: application/json' \
	-d '{"title":"Vognary snapshot","summary":{"recurringCount":0},"snapshot":{"version":1,"exportedAt":"2026-07-06T00:00:00.000Z","statementSources":[],"manualItems":[],"userActions":{},"itemOwners":{},"reviewNotes":{},"teamMembers":[]}}'
```

Without a signed `vognary_session` cookie, workspace routes return `401`. The `/login` page supports Resend magic links backed by `SESSION_SECRET`, `DATABASE_URL`, `RESEND_API_KEY`, and `RESEND_FROM_EMAIL`; it also keeps the private-beta access-code flow backed by `PRIVATE_BETA_ACCESS_CODE`. Encrypted server snapshots additionally require `TOKEN_ENCRYPTION_KEY`.

Generate a future token-vault key with:

```bash
npm run secrets:generate-token-key
```

## Deployment

See [docs/deployment-plan.md](docs/deployment-plan.md). The current app is deployable for self-serve stateless audits and connector readiness planning. It intentionally does not store financial documents or connected-account tokens server-side yet.

## Product Direction

Vognary should not become a generic budget app. The wedge is recurring financial commitments: subscriptions, card e-mandates, UPI AutoPay, EMIs, SIPs, insurance, SaaS, cloud bills, domains, app-store subscriptions, and utilities.

The integration strategy is documented in [docs/universal-integration-operating-model.md](docs/universal-integration-operating-model.md). It defines how Vognary moves each source from launchpad target to real connector using OAuth, API keys, IAM roles, webhooks, or regulated partner APIs.

See:

- [docs/universal-integration-operating-model.md](docs/universal-integration-operating-model.md)
- [docs/product-architecture.md](docs/product-architecture.md)
- [docs/production-activation-runbook.md](docs/production-activation-runbook.md)
- [docs/validation-playbook.md](docs/validation-playbook.md)
- [docs/market-entry-research.md](docs/market-entry-research.md)
- [docs/current-state-and-market-gap-analysis.md](docs/current-state-and-market-gap-analysis.md)
- [docs/production-beta-setup.md](docs/production-beta-setup.md)
- [docs/private-audit-outreach-kit.md](docs/private-audit-outreach-kit.md)
- [docs/private-audit-pipeline-template.csv](docs/private-audit-pipeline-template.csv)
- [docs/deployment-plan.md](docs/deployment-plan.md)
- [docs/phase-roadmap.md](docs/phase-roadmap.md)
- [docs/integration-checklist.md](docs/integration-checklist.md)
- [docs/investor-demo-script.md](docs/investor-demo-script.md)
- [docs/day-90-completion-report.md](docs/day-90-completion-report.md)
- [docs/production-standard-report.md](docs/production-standard-report.md)
