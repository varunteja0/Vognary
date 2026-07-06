# Vognary Universal Integration Operating Model

This is the operating model for making Vognary a single place for recurring payments, subscriptions, mandates, renewals, usage bills, and recurring financial commitments.

## Product Promise

Vognary should show one recurring-payment ledger across:

- Email receipts and renewal notices.
- AI tools and SaaS subscriptions.
- Cloud bills and developer platforms.
- App stores and wallets.
- Domains, hosting, utilities, insurance, EMIs, SIPs, and subscriptions.
- Bank account, card, UPI AutoPay, and mandate data where regulated access exists.

The product must never imply universal automatic sync where the provider, issuer, network, or regulated partner does not expose usable access.

## How Existing Companies Integrate Platforms

Most serious integrations use one of these patterns:

| Pattern | Used by | What Vognary does |
| --- | --- | --- |
| OAuth consent | Google, Microsoft, GitHub, Slack, Notion, Zoom, PayPal | Redirect user to official provider, receive code, exchange for token, store encrypted token reference, sync data. |
| API key / token | OpenAI, Cloudflare, Render, Vercel, Stripe, Razorpay, domain registrars | User/admin provides scoped key, Vognary encrypts it, runs scheduled sync jobs. |
| IAM role / delegated access | AWS, Azure, GCP | User grants read-only billing role/scope, Vognary syncs usage and cost. |
| Webhook | Stripe, Razorpay, Cashfree, Apple/Google developer APIs | Provider calls Vognary on subscription, invoice, mandate, or renewal events. |
| Regulated partner API | Account Aggregator, UPI, card mandates, banks/issuers | Requires partner contract, security review, consent artifact, compliance controls. |
| Evidence fallback | Receipts, exports, manual confirmations | Used only when official direct access is unavailable. Should not be the primary product story. |

## Current Live Status

| Area | Status | Notes |
| --- | --- | --- |
| Google identity | Ready | Production login works. |
| Gmail receipts | Ready-to-connect | OAuth start returns a Google consent URL and callback imports receipt candidates into the app. Full public use may require Google app/scope verification. |
| Database | Ready | PostgreSQL is configured. |
| Token vault | Ready | Encrypted token storage primitives exist. |
| Connector token store | Ready | Connected-account and encrypted-token tables exist. |
| Internal sync API | Configured | Internal sync routes exist; worker daemon is still not a standalone scheduler. |
| OpenAI costs | Adapter exists, blocked by env | Needs `OPENAI_ADMIN_API_KEY` or workspace token capture. |
| Claude, Kling, X Premium | Planned targets | Need official API/partner access before real personal billing sync. |
| Vercel, Render, GitHub, Cloudflare, AWS | Planned targets | Need provider adapters and user/workspace credential capture. |
| Apple/Google Play consumer subscriptions | Evidence only today | Universal consumer subscription APIs are not generally available to third-party apps. |
| UPI/card mandates/banks | Partner-gated | Requires issuer, PSP, network, Account Aggregator, bank, or regulated partner access. |

## Rollout Order

### 1. Gmail Receipt Sync

Goal: let users click Gmail, consent with Google, and import recurring subscription candidates from receipt history.

Current status: implemented as the first real no-paste connector path.

Next hardening:

- Store refresh token per workspace in encrypted token store.
- Create a scheduled Gmail receipt sync job.
- Add deduplication and merchant-confidence review.
- Add Google verification readiness documentation.

### 2. OpenAI Costs

Goal: use OpenAI admin cost data to populate recurring AI spend.

Current status: adapter exists but is env-gated.

Next hardening:

- Add user/workspace API key capture UI.
- Store key in token vault.
- Run adapter through workspace sync job.
- Normalize OpenAI cost evidence into recurring ledger rows.

### 3. Developer/Cloud Platforms

Priority targets:

- Vercel.
- Render.
- GitHub billing and Copilot.
- Cloudflare.
- AWS Cost Explorer.
- Google Cloud Billing.
- Azure Cost Management.

Pattern:

1. Add provider credential/OAuth capture.
2. Store token reference in `connected_accounts` and `connector_token_refs`.
3. Implement provider adapter.
4. Normalize subscription, invoice, usage, cost, seat, and workspace evidence.
5. Add scheduled sync and webhook support where providers allow it.

### 4. Consumer Subscriptions And Wallets

Targets:

- PayPal automatic payments.
- Apple subscriptions.
- Google Play subscriptions.
- X Premium.
- Claude/Kling/consumer AI apps.

Reality:

- Some consumer platforms do not expose universal third-party billing APIs.
- Vognary should use official OAuth/API where available and otherwise rely on Gmail receipts or provider-approved partner paths.

### 5. Regulated Rails

Targets:

- Account Aggregator.
- UPI AutoPay mandates.
- Card e-mandates.
- Bank/issuer white-label access.

Required before user-facing automatic sync:

- Partner contract or sandbox approval.
- Legal and compliance review.
- Consent management.
- Audit logging and incident process.
- Data deletion and retention controls.

## Definition Of Done For A Real Connector

A connector is not considered real until all are true:

- User can start from Vognary and complete official consent or credential setup.
- Vognary stores token references encrypted per workspace.
- Initial sync writes normalized evidence into the recurring ledger.
- Re-sync can run without the user repeating setup.
- The source appears in profile/data controls.
- User can disconnect/delete the connected account.
- Errors are honest and actionable.

## What We Must Not Claim

Do not claim:

- Universal phone-number subscription discovery.
- Universal bank/card/UPI mandate visibility without partner access.
- Direct Apple/Google Play consumer subscription sync unless the provider exposes and approves that access.
- Claude/Kling/X billing sync until official APIs or partner access are proven.

Do claim:

- One recurring ledger.
- Gmail receipt sync is the first real personal-history connector path.
- Provider connectors are being added through official consent, API, webhook, IAM, and partner rails.
- Vognary is honest about what is live, setup-ready, planned, and partner-gated.