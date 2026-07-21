# Vognary Phase Roadmap

## Phase 0: Self-Serve Stateless Audit

Status: Implemented

- Multi-source CSV audit UI.
- Stateless CSV/PDF ingestion endpoint.
- Stateless audit endpoint.
- Manual recurring commitments.
- Evidence trail and action labels.
- Health endpoint.
- Docker/deployment files.
- Privacy, terms, security, beta readiness pages.
- Launch/waitlist page with webhook-ready capture.

Validation:

- `npm run build`
- `npm run lint`
- `curl http://localhost:3000/api/health`
- `POST /api/audit` with CSV plus manual item.

## Phase 1: Private Founder Audits

Goal: prove willingness to upload financial data and pay for monitoring.

Ship next:

- User interview tracker. Status: implemented in app.
- Audit outcome tracker. Status: implemented in app.
- Report PDF export. Status: implemented.
- Source-specific manual templates: Apple, Google Play, UPI AutoPay, card mandates, domains, insurance. Status: implemented.
- Improve PDF parsing for top 5 banks/cards from beta users.

Go/no-go:

- 30 uploaded audits.
- 60% find at least one avoidable recurring cost.
- 10 paid/prepaid users.

## Phase 2: Accounts And Encrypted Persistence

Goal: let users return monthly without re-uploading everything.

Ship next:

- Auth.
- PostgreSQL migrations from `infra/postgres/schema.sql`.
- Encrypted object storage.
- Data deletion flow.
- Audit log.
- Report history.

Go/no-go:

- Security review complete.
- Privacy policy reviewed.
- Backup and deletion tests pass.

## Phase 3: Gmail Receipt Intelligence

Goal: discover subscriptions not visible in statements.

Ship next:

- Google OAuth app verification.
- Gmail read-only connector UI.
- Receipt candidates surfaced in dashboard.
- User confirmation before turning receipt candidates into recurring items.

Go/no-go:

- OAuth verification approved.
- 80% of receipt candidates include usable merchant + amount evidence.

## Phase 4: Founder/Team Product

Goal: move from personal audit to small-team recurring spend control.

Ship next:

- Workspaces.
- Team invites.
- Owner/action assignment.
- Monthly review workflow.
- CSV/PDF report export for accountants.

Go/no-go:

- 5 teams use it for a monthly review.
- At least 3 teams pay Founder/Team pricing.

## Phase 5: Regulated And Partner Integrations

Goal: become a durable recurring-finance control layer.

Ship next:

- Account Aggregator partner/TSP path.
- UPI/card mandate data partnerships.
- Cloud/SaaS connectors for OpenAI, Anthropic, GitHub, Vercel, Render, AWS, and domain providers.
- Bank/issuer white-label exploration.

Go/no-go:

- Legal/compliance review.
- Partner approval.
- Signed pilot or LOI.