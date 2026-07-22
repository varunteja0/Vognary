# Vognary Legal Platform Integration Action Report

Updated: 2026-07-16 IST

## Executive Decision

Vognary must integrate platforms through permissioned, legal, auditable rails only. The company should not scrape private accounts, collect bank passwords, bypass provider controls, or imply data access that has not been approved by the provider, user, or regulated partner.

The product direction is correct: become the evidence-first recurring-money graph. Every recommendation should show which source proved it, what source is missing, how fresh the evidence is, and whether the connector is live, ready-with-env, planned, or partner-gated.

## Current State Boundary

The repository contains the guest audit, encrypted signed-in persistence, source lifecycle, privacy controls, and one-time assisted-audit code paths. This report does not transfer those code claims to the deployed site. Re-run the production activation checker after deploying the same artifact and attach the output before describing any capability as production-active.

Missing before full production activation:

- Assisted-audit payment: qualified legal review, Razorpay KYC/keys/webhook, migrations through 0017, test payment, fresh-event replay, duplicate/out-of-order refund proof, and reconciliation. Static payment links are not a V1 path.
- OpenAI direct sync key: a per-workspace key stored through the encrypted connector flow. `OPENAI_ADMIN_API_KEY` is local-preview-only.
- Monitoring and incident alerts: `SENTRY_DSN` or `BETTER_STACK_SOURCE_TOKEN`.
- Backup/object storage and restore drill: `BACKUP_STORAGE_BUCKET`, `S3_BUCKET`, or `R2_BUCKET`, plus `BACKUP_RESTORE_DRILL_STATUS=passed`.
- Regulated partner statuses: `ACCOUNT_AGGREGATOR_PARTNER_STATUS`, `UPI_MANDATE_PARTNER_STATUS`, `CARD_MANDATE_PARTNER_STATUS`.

Live connector registry check:

```bash
curl -s https://www.vognary.com/api/connectors
```

Current registry summary:

- 42 total connector targets.
- 9 live evidence/manual/fallback paths.
- 2 ready-with-env connectors.
- 5 partner-required rails.
- 26 planned connectors.
- 1 direct adapter registered in code: `openai-costs`.

## What Is Already Complete

### Live Evidence Paths

These can be used now without pretending direct provider sync exists:

- Receipt snippets.
- Apple subscription evidence from receipts or user-confirmed screens.
- Google Play subscription evidence from receipts or user-confirmed screens.
- Insurance renewals.
- Utilities and telecom renewals.
- Statement import fallback.
- PDF statement fallback.
- Manual mandate fallback.
- Team review workflow.

### Ready-With-Env Connectors

These have code paths or adapter foundations but require production credentials and external verification:

- Gmail Read-Only: OAuth receipt discovery with state validation. For signed-in users, the callback can persist encrypted token references when database and token vault are configured, then queue an initial sync job. Public launch still requires Google OAuth verification for the restricted `gmail.readonly` scope.
- OpenAI Usage and Costs: adapter exists for `GET /organization/costs`; production sync requires the workspace-level encrypted key capture flow and never falls back to a deployment-wide key.

### Backend Foundations

The PostgreSQL schema already supports the durable model needed for serious integrations:

- Users and workspaces.
- Data sources.
- Connected accounts.
- Encrypted connector token references.
- Sync jobs and sync runs.
- Webhook events.
- Uploaded files.
- Transactions.
- Recurring items.
- Evidence links and connector evidence.
- Usage observations.
- Recommendations, alerts, reports, and audit logs.

## Legal Data Rails

Vognary should accept data only through these rails:

| Rail | Examples | Legal basis | Storage posture |
| --- | --- | --- | --- |
| User-provided evidence | CSV, PDF, pasted receipts, manual mandates | User voluntarily provides evidence | Store only after signed-in consent and deletion controls |
| OAuth consent | Gmail, Outlook, GitHub, Slack, Notion, Zoom, PayPal | Provider consent screen and scoped tokens | Encrypted token references only |
| Scoped API key | OpenAI, Cloudflare, Render, Vercel, Stripe, domain registrars | Admin/user creates scoped credential | Encrypt, rotate, disconnect, audit |
| IAM/delegated role | AWS Cost Explorer, cloud billing scopes | User grants read-only role | Store role metadata, avoid broad keys where possible |
| Signed webhook | Stripe, Razorpay, app-store developer notifications | Provider pushes signed events | Verify signature before persistence |
| Regulated partner API | Account Aggregator, UPI, card mandates, bank/issuer rails | Consent artifact, partner contract, compliance review | Production only after legal/security signoff |

## What We Must Not Do

Do not build or claim:

- Bank password collection.
- SMS scraping.
- Screen scraping of private dashboards as a product path.
- Universal UPI/card mandate visibility before partner approval.
- Universal Apple or Google Play consumer subscription APIs.
- Claude, Kling, or X billing sync until official APIs or partner access are proven.
- One-click cancellation unless a provider-supported authorization and failure-handling path exists.

## Platform Rollout Plan

### Phase 1: Private Audit Revenue And Trust

Goal: prove that users will share evidence and pay for a recurring-money audit.

Complete next:

1. Configure payment links.
2. Keep private audit intake live.
3. Run 5 to 30 real audits.
4. Record sources users actually provide.
5. Prioritize integrations from real audit evidence, not guesses.

Stop condition:

- Do not scale outreach if users will not share even redacted evidence or will not pay after seeing the report.

### Phase 2: Gmail As First Personal-History Connector

Goal: discover recurring spend from receipts without mailbox overreach.

Complete next:

1. Finish Google OAuth verification for `gmail.readonly`.
2. Keep scope narrow and read-only.
3. Store encrypted refresh tokens only for signed-in users.
4. Add scheduled receipt sync.
5. Deduplicate receipt candidates.
6. Require user confirmation before turning a receipt candidate into a recurring item.
7. Add disconnect and delete controls to profile/data controls.

Stop condition:

- Do not invite public Gmail users until Google verification and data-policy requirements are complete.

### Phase 3: OpenAI As First Direct Cost Connector

Goal: prove a direct provider cost connector end to end.

Complete next:

1. Validate workspace-level OpenAI admin-key capture and rotation with a design partner; keep any environment-key preview local-only.
2. Run the adapter against a real authorized organization.
3. Persist evidence through sync jobs instead of stateless preview only.
4. Normalize cost windows into recurring ledger evidence.
5. Add project/workspace labels where the API response exposes them.
6. Show cost trend, source, confidence, and action recommendations.

Stop condition:

- Do not store or expose API keys client-side.

### Phase 4: Developer And Cloud Platforms

Priority order:

1. AWS Cost Explorer through read-only billing permissions.
2. GitHub Billing and GitHub Copilot usage through org/enterprise permissions.
3. Cloudflare billing and usage through scoped API token.
4. Vercel and Render through scoped team/workspace tokens.
5. Azure Cost Management and Google Cloud Billing through authorized billing scopes.
6. Domain registrars for renewal dates and auto-renew evidence.

Definition of done for each connector:

- Official consent, API key, or IAM setup works from Vognary.
- Token or role reference is encrypted and attached to a workspace.
- Initial sync writes normalized connector evidence.
- Resync works without repeated setup.
- User can disconnect/delete the account.
- Errors are honest and actionable.
- The connector is moved from planned to live only after a real authorized sync succeeds.

### Phase 5: Consumer Subscriptions And Wallets

Targets:

- PayPal automatic payments where user-level APIs expose the needed data.
- Apple and Google Play via receipts/user-confirmed evidence for consumers.
- Apple App Store Server API and Google Play Developer API only for developers inspecting apps they own.
- Claude, Kling, X Premium, and other consumer AI subscriptions only after official account/billing APIs or partner access are proven.

Stop condition:

- Do not market consumer-wide app-store sync as direct API coverage.

### Phase 6: Regulated India Rails

Targets:

- Account Aggregator through FIU/TSP or regulated partner path.
- UPI AutoPay mandates through PSP, bank, or NPCI-connected partner path.
- Card e-mandates through issuer, network, or payment aggregator path.
- Bank/issuer white-label pilots.

Required before production:

- Partner contract or sandbox approval.
- Legal/compliance review.
- Purpose limitation and consent artifact design.
- Audit logging.
- Retention and deletion policy.
- Incident response process.
- Production monitoring and backups.

Stop condition:

- Do not claim direct UPI/card/bank mandate visibility until partner access is signed, tested, and reflected in readiness status.

## Immediate Execution Checklist

### Code/Repo Complete

- Keep `npm run production:check -- https://www.vognary.com` as the stage gate.
- Keep connector statuses honest in `src/lib/connectors.ts`.
- Use `ready-with-env` only when the code path exists but credentials or verification are missing.
- Use `partner-required` when provider, bank, issuer, PSP, network, or regulated partner access is required.
- Use `planned` until a real adapter and authorized first sync exist.

### Founder/External Setup Required

These cannot be completed by code alone:

1. Create Razorpay or Stripe payment links and set payment env vars.
2. Apply migration `0017_shared_rate_limits` and confirm production readiness reports the Postgres shared backend; Upstash is optional at higher scale.
3. Configure Sentry or Better Stack.
4. Configure backup/object storage and perform a restore drill.
5. Add OpenAI admin key or approve workspace-level key capture UX.
6. Complete Google OAuth verification for Gmail public use.
7. Start Account Aggregator/TSP and UPI/card mandate partner applications.

## $1B Company Operating Standard

Vognary should scale by becoming the most trusted recurring-money evidence layer, not by taking shortcuts. The standard is:

- Permission before access.
- Least-privilege scopes.
- Encrypted secrets.
- User-visible source controls.
- Deletion by design.
- Audit logs for every sensitive read/write.
- No universal claims unless the access is proven.
- Recommendations backed by evidence, not guesses.

The next milestone is not connecting every platform at once. The next milestone is proving two end-to-end connector loops: Gmail receipt intelligence and OpenAI cost sync. After those are proven, repeat the same legal connector pattern for cloud, developer SaaS, domains, wallets, and regulated India rails.
