# Vognary

Vognary is a recurring-money audit MVP for founders, builders, freelancers, and modern households. The first product finds recurring payments from a CSV statement, normalizes merchants, predicts the next debit, estimates annual burn, and shows evidence for each recommendation.

## Current MVP

- Live-source-first audit workflow with fallback statement import.
- PDF/statement export ingestion through stateless processing when direct sources are unavailable.
- Deterministic recurring-payment detector.
- Merchant normalization for AI tools, cloud hosting, SaaS, app stores, utilities, SIPs, EMIs, and insurance.
- Recurring Money Graph dashboard.
- Confidence scores, next debit prediction, evidence trail, and founder action labels.
- JSON export for audit reports.
- PDF report export, CSV export, and private workspace backup/import.
- Source guide, completeness score, receipt snippet parsing, and priority actions.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Launch page: http://localhost:3000/launch
Source guide: http://localhost:3000/sources
Integration hub: http://localhost:3000/integrations

## Validation Command

```bash
npm run build
npm run lint
npm run smoke
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

## Deployment

See [docs/deployment-plan.md](docs/deployment-plan.md). The current app is deployable for self-serve stateless audits. It intentionally does not store financial documents server-side yet.

## Product Direction

Vognary should not become a generic budget app. The wedge is recurring financial commitments: subscriptions, card e-mandates, UPI AutoPay, EMIs, SIPs, insurance, SaaS, cloud bills, domains, app-store subscriptions, and utilities.

See:

- [docs/product-architecture.md](docs/product-architecture.md)
- [docs/validation-playbook.md](docs/validation-playbook.md)
- [docs/deployment-plan.md](docs/deployment-plan.md)
- [docs/phase-roadmap.md](docs/phase-roadmap.md)
- [docs/integration-checklist.md](docs/integration-checklist.md)
- [docs/investor-demo-script.md](docs/investor-demo-script.md)
- [docs/day-90-completion-report.md](docs/day-90-completion-report.md)
- [docs/production-standard-report.md](docs/production-standard-report.md)
