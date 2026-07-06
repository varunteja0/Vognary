# Vognary

Vognary is a recurring-money audit MVP for founders, builders, freelancers, and modern households. The first product finds recurring payments from a CSV statement, normalizes merchants, predicts the next debit, estimates annual burn, and shows evidence for each recommendation.

## Current MVP

- Browser-local CSV upload and paste flow.
- Deterministic recurring-payment detector.
- Merchant normalization for AI tools, cloud hosting, SaaS, app stores, utilities, SIPs, EMIs, and insurance.
- Recurring Money Graph dashboard.
- Confidence scores, next debit prediction, evidence trail, and founder action labels.
- JSON export for audit reports.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000.

The app opens with a sample founder stack. To test upload, use [public/sample-founder-stack.csv](public/sample-founder-stack.csv).

## Validation Command

```bash
npm run build
npm run lint
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

See [docs/deployment-plan.md](docs/deployment-plan.md). The current app is deployable for private beta audits. It intentionally does not store financial documents server-side yet.

## Product Direction

Vognary should not become a generic budget app. The wedge is recurring financial commitments: subscriptions, card e-mandates, UPI AutoPay, EMIs, SIPs, insurance, SaaS, cloud bills, domains, app-store subscriptions, and utilities.

See [docs/product-architecture.md](docs/product-architecture.md) and [docs/validation-playbook.md](docs/validation-playbook.md).
