# Production Standard Report

## Current Sell-Ready Product Boundary

Vognary is sell-ready only as a self-serve, stateless recurring-payment audit and connector-readiness product. It is not yet the stateful enterprise sync platform. A user can:

- Open the launch page.
- Join/request an audit through the waitlist API.
- Connect available sources or import fallback statement/PDF evidence.
- Paste structured statement exports.
- Add manual recurring commitments for app stores, UPI AutoPay, card mandates, domains, insurance, SIPs, EMIs, and utilities.
- Paste receipt snippets.
- See a Recurring Money Graph with confidence, evidence, next debit, monthly cost, annual cost, and action label.
- Review source coverage and audit completeness.
- Follow a priority action plan.
- Assign owners and review notes for team usage.
- Export PDF, CSV, JSON audit pack, beta evidence CSV, and workspace backup.
- Restore a workspace backup.
- Opt into browser-local save and delete that save.

## Production Hardening Implemented

- Security headers in `next.config.ts`.
- Health API.
- Audit API.
- Ingestion API.
- Connector registry API.
- Connector start and sync planning APIs.
- OpenAI costs adapter registered for read-only env-gated sync preview.
- Checkout readiness API.
- Waitlist API.
- In-memory API rate limiting for public/heavy endpoints. This is a single-instance guard and must be replaced with trusted-proxy identity plus Redis or an equivalent shared store before multi-instance public scale.
- Gmail OAuth state validation.
- Signed connector webhook route with HMAC verification and optional PostgreSQL event persistence.
- Internal-secret-gated sync job API and runner for registered adapters. This is not exposed to users and still requires auth/workspace flows before public connected-account sync.
- Signed session-cookie primitives and workspace authorization helpers. User-facing login/session issuance still requires an identity provider or magic-link delivery.
- Token-vault encryption primitives, readiness check, and server-side connector token-store functions. Persistent connector token storage is not exposed through auth-backed product flows yet.
- Smoke test script.
- Dockerfile and compose config.
- PostgreSQL schema design and optional readiness probe for the future persistent layer. The application does not read or write user financial data there yet.
- Trust pages: Privacy, Terms, Security, Beta Readiness.
- Integration Hub and Source Guide.

## External Requirements Not Fake-Completed

These are not software-only tasks and must not be claimed as complete until approved/configured:

- Google OAuth verification for public Gmail read-only access.
- Payment links or payment gateway credentials.
- Account Aggregator FIU/TSP/partner path.
- UPI/card mandate provider or issuer APIs.
- Cloud/SaaS OAuth credentials and read-only usage scopes.
- Legal review of privacy/terms.
- Security review before storing financial documents.
- Identity provider or magic-link delivery for production login.
- Authenticated connected-account persistence rollout.
- Queue/scheduler/runtime execution for connector sync jobs.
- Webhook receiver and provider signature verification.
- Rate limiting backed by shared infrastructure such as Redis for multi-instance deployment.

## Scale Position

The current product can serve many users as a stateless audit tool because it does not rely on per-user database writes. For thousands of users with saved accounts, the next required layer is auth, encrypted object storage, PostgreSQL persistence, distributed rate limiting, monitoring, and incident response.

## Validation Commands

```bash
npm run build
npm run lint
npm run smoke
curl http://localhost:3000/api/health
curl http://localhost:3000/api/connectors
```