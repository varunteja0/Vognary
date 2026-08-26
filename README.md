# Vognary

> **Operating motto: Take smart risks. Do not play safe.** Vognary pursues
> category-defining, falsifiable outcomes with bounded downside; it does not
> confuse incremental polish with progress. See [THE-LAW](docs/THE-LAW.md).

Vognary is Commitment Control for India-first 5–100 person AI-native companies: propose an obligation, see cited exposure and policy, then a named human freezes a cap. Recovery remains the evidence foundation that later proves the outcome.

The product is public but not yet operationally proven. No paid Control pilot has completed the production proposal-to-authorization-to-reconciliation loop, so this repository must not be read as customer, distribution, or automatic-receipt proof.

## Current product loop

1. Sign in.
2. Add billing receipts the company already has (paste, file, or photo).
3. Record a complete workspace policy.
4. Propose a new obligation. Cited exposure and policy annotate; they do not decide.
5. An owner or admin authorizes, caps, or declines. The cap is frozen.
6. Link a later cited receipt and reconcile the observed amount to that authorization.

AI follows **cite or shut up**: unsupported amounts, merchants, dates, and source-liveness claims must be refused or marked unknown.

## Scope and trust boundaries

- Source 0 is the private billing inbox with billing-only auto-forwarding and historical backfill.
- First-session use does not require mailbox access, bank credentials, OTPs, or card credentials.
- Direct Gmail OAuth remains fail-closed until Google restricted-scope verification and the required security assessment are complete.
- The retired `/app?demo=1` and `/app?guest=1` modes return `410 Gone`; no fictional financial records are shown.
- The retired one-time assisted audit and public checkout cannot collect leads or create payments. Historical billing code remains only for settlement integrity, reconciliation, and refunds.
- Vognary does not cancel or downgrade anything autonomously and does not claim universal financial coverage.

The product freeze and live evidence state are authoritative in [THE-LAW](docs/THE-LAW.md) and [CONTINUE-HERE](docs/CONTINUE-HERE.md).

## Local development

Node `22.23.2` is pinned in `.nvmrc`.

```bash
nvm use 22.23.2
npm install
npm run dev
```

Open `http://localhost:3000`. The deterministic audit path and production build need no external services. Signed-in persistence needs PostgreSQL and the development secrets documented in [AGENTS.md](AGENTS.md).

Useful routes:

- Workspace: `http://localhost:3000/app`
- Login: `http://localhost:3000/login`
- Profile and data controls: `http://localhost:3000/profile`
- Privacy: `http://localhost:3000/privacy`
- Security: `http://localhost:3000/security`
- Public health: `http://localhost:3000/api/health`

`/connect`, `/integrations`, and `/sources` redirect to `/app`. `/launch` and `/private-audit` hand off to `/login?next=/app`.

## Validation

Before merge, run:

```bash
npm run lint
npm run typecheck
npm run claims:check
npm run tokens:check
npm test
npm run build
npm run perf:budget
```

Changes to migrations or stores additionally require a disposable PostgreSQL run:

```bash
DATABASE_URL='<disposable-postgres-url>' POSTGRES_SSL=false npm run test:postgres
```

Detailed operational checks are internal-secret protected because they expose deployment state. Public `/api/health` is deliberately limited to liveness.

## Canonical documentation

1. [THE-LAW](docs/THE-LAW.md) — company, product, and agent directive
2. [CONTINUE-HERE](docs/CONTINUE-HERE.md) — current branch, evidence, blockers, and handoff
3. [Phase A market contact](docs/execution/phase-a-market-contact.md) — real-customer proof
4. [Phase B loop shipping](docs/execution/phase-b-loop-shipping.md) — current product loop
5. [Scoreboard](docs/execution/scoreboard.md) — evidence-backed company status

Historical plans live under [`docs/archive/`](docs/archive/) and are not current product claims.
