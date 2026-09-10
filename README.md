# Vognary

> **Operating motto: Take smart risks. Do not play safe.** Vognary pursues
> category-defining, falsifiable outcomes with bounded downside; it does not
> confuse incremental polish with progress. See [THE-LAW](docs/THE-LAW.md).

Vognary is Commitment Control for India-first 20–100 person AI-native companies: propose an obligation, see cited exposure and policy, then a named human freezes a cap. Recovery remains the evidence foundation that later proves the outcome.

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
- The live commercial path is `/pay`: the one-time ₹14,999 Commitment Control private pilot for one month. It opens a founder-configured hosted payment page when that deployment has one. Payment reserves a pilot but does not grant customer-data access before the assurance and activation gates. `/api/checkout` remains `410`.
- Vognary does not cancel or downgrade anything autonomously and does not claim universal financial coverage.

The product freeze and live evidence state are authoritative in [THE-LAW](docs/THE-LAW.md) and [CONTINUE-HERE](docs/CONTINUE-HERE.md).

## Local development

### Source-to-resolution Books candidate

The September 6 local candidate adds a Zoho Books India bill-review workflow in
`/app?view=BILL_REVIEW`, also reachable from Evidence. It is not provider-verified
or production configured. It imports existing supplier bills and amendments,
then records an explicit human explanation, dated follow-up or review closure.
New revisions need their own disposition; older follow-ups remain open until
explicitly closed. Acknowledgement records reading only. The workflow does not infer
pre-spend proposals, prove cash payments, match merchants, or reconcile Control
automatically. Receipt collection remains manual for uncovered sources.

After the separate source and customer-data approvals, an owner configures
`ZOHO_BOOKS_CLIENT_ID`, `ZOHO_BOOKS_CLIENT_SECRET`, `NEXT_PUBLIC_APP_URL`, and the
explicit `ZOHO_BOOKS_PILOT_WORKSPACE_IDS` allowlist, with current schema through
`0075_zoho_books_dispositions`. Wildcard enrollment is forbidden in production.
Production source access also requires the canonical paid-pilot enrollment and
release-bound independent-assessment clearance; a source allowlist alone is
insufficient, including for background workers.
No credentials belong in Git or chat. The existing runtime also requires
`TOKEN_ENCRYPTION_KEY`, `SESSION_SECRET`, and `CRON_SECRET`.

The worker route is `/api/internal/zoho-books/due/run`: GET requires the cron
secret; POST requires the internal secret. The UI's reload button reads saved
observations, not the provider. See the [source operating contract](docs/production-activation-runbook.md#zoho-books-local-candidate---2026-09-06).

Terminal recovery requires `ZOHO_BOOKS_OPERATOR_USER_ID` naming an accountable
workspace owner/admin and the existing monitored error sink. Incidents record
delivery state; assigned operators may explicitly resume only delivered transient
failures. Schema, revoked access and unconfirmed absence cannot be retried blindly.
Real alert receipt, provider lifecycle and on-call response remain external gates.

Public `/start` uses fixed synthetic data only. Arbitrary guest audit text,
uploads and image proposals are blocked; authenticated financial intake requires
the canonical eligible workspace. Tests may explicitly enable local synthetic
workspaces with `COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS='*'` under `NODE_ENV=test`.
This wildcard does not enable production financial intake.

Node `22.23.2` is pinned in `.nvmrc`.

```bash
nvm use 22.23.2
npm install
npm run dev
```

Open `http://localhost:3000`. The fixed synthetic demonstration and production build need no external services. Signed-in persistence needs PostgreSQL and the development secrets documented in [AGENTS.md](AGENTS.md).

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

Use `npm run security:inbox` for a privacy-minimized report of the security
mailbox without a browser login. It requires `RESEND_API_KEY`; default runs are
read-only and emit only timestamps, sender domains, safe categories, opaque
review refs, and review state. After a verified action or no-action review, run
`npm run security:inbox -- --mark-handled <review-ref>`. The ignored local
ledger stores only versioned SHA-256 refs.

For the temporary founder workflow, `npm run company-mail:forward` previews new
approved role-address messages and `npm run company-mail:forward -- --execute`
forwards them to the ignored `COMPANY_MAIL_FORWARD_TO` destination while
retaining originals in Resend. The command excludes synthetic tests and uses
provider tags to prevent duplicate forwarding.

## Market and customer operations

The existing private CRM drives a read-only operating view from buyer replies
through invoice, payment, activation review, first decision, reconciliation,
workflow rescue and separately purchased repeat use:

```bash
npm run market:desk -- --report-only
npm run market:desk -- --customer-actions-only
```

The first command writes nothing. The second writes only the private
[customer-actions guide](.fallow/outreach-2026-09-03/customer-actions.txt), leaving
existing outreach drafts, send logs and CRM evidence unchanged. Owner roles are
required human handoffs, not accepted duties or authorization. Generated counts
describe work to review, not independently verified customers or revenue.
Neither command sends messages, schedules follow-ups, charges money, activates
data or clears a release gate. A recorded contact channel is not permission.

The default `market:desk` command still regenerates draft material, so review
existing edits before using it. Paid, progressed and closed records do not enter
new prospecting drafts. Existing saved drafts were not retroactively authorized
or updated by the customer-actions-only command; current lane permissions and
native receipts control any actual contact. Current research and execution are
linked from [CONTINUE-HERE](docs/CONTINUE-HERE.md).

## Canonical documentation

1. [THE-LAW](docs/THE-LAW.md) — company, product, and agent directive
2. [CONTINUE-HERE](docs/CONTINUE-HERE.md) — current branch, evidence, blockers, and handoff
3. [Phase A market contact](docs/execution/phase-a-market-contact.md) — real-customer proof
4. [Phase B loop shipping](docs/execution/phase-b-loop-shipping.md) — current product loop
5. [Scoreboard](docs/execution/scoreboard.md) — evidence-backed company status

Historical plans live under [`docs/archive/`](docs/archive/) and are not current product claims.
