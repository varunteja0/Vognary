# Production Standard Report

## Current Sell-Ready Product

Vognary is now sell-ready as a self-serve, stateless recurring-payment audit product. A user can:

- Open the launch page.
- Join/request an audit through the waitlist API.
- Connect available sources or import fallback statement/PDF evidence.
- Paste CSV exports.
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
- Checkout readiness API.
- Waitlist API.
- Smoke test script.
- Dockerfile and compose config.
- PostgreSQL schema for the future persistent layer.
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
- Auth and encrypted persistence rollout.

## Scale Position

The current product can serve many users as a stateless audit tool because it does not rely on per-user database writes. For thousands of users with saved accounts, the next required layer is auth, encrypted object storage, PostgreSQL persistence, rate limiting, monitoring, and incident response.

## Validation Commands

```bash
npm run build
npm run lint
npm run smoke
curl http://localhost:3000/api/health
curl http://localhost:3000/api/connectors
```