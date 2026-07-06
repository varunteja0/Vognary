# Vognary Deployment Plan

## Current Deployable Unit

The current app is a Next.js private-beta MVP. It can be deployed as a static/server-rendered web app and used for local browser-side recurring audits without server-side storage.

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

The API returns an audit result and stores nothing. This gives us a clean bridge from browser-local MVP to backend workers later.

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

## Hosted Deployment

Recommended first hosted options:

- Vercel for fastest web deployment.
- Render/Fly/Railway if using the Dockerfile.
- AWS/Azure/GCP only after backend storage and compliance requirements are clear.

## Production Boundary

This MVP can be shown to users and investors as a working private-beta audit product. It should not be marketed as a regulated financial-data production system until the following are complete:

- Authentication and account deletion.
- Encrypted database and object storage.
- Legal privacy policy and terms.
- Security review for financial documents.
- Gmail OAuth verification before receipt ingestion.
- Account Aggregator or regulated partner path before pulling bank data directly.
- Operational monitoring, backups, and incident response.

## Backend Roadmap

1. Add FastAPI ingestion service for PDF/CSV parsing.
2. Apply the PostgreSQL schema in [infra/postgres/schema.sql](../infra/postgres/schema.sql) for users, sources, transactions, recurring items, evidence, recommendations, and audit reports.
3. Add object storage for encrypted uploaded files.
4. Add queue workers for statement parsing and receipt ingestion.
5. Add Gmail read-only OAuth connector.
6. Add team workspaces and shared reports.
7. Add Account Aggregator integration through a compliant partner/TSP route.