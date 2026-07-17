# Direct Linking Activation Dossier

Date: 2026-07-17
Purpose: the decision-ready map from uploads to permissioned linked sources — what is code-ready, what a company contract can provide, and what remains unavailable without user consent or regulated authority. Pair with [partner-rails-access-playbook.md](partner-rails-access-playbook.md) and [legal-platform-integration-action-report.md](legal-platform-integration-action-report.md).

## The one-paragraph truth

No publicly documented Netflix or PhonePe product gives an unrelated consumer app a person's complete subscription list. The established open-finance pattern is to contract company-side financial-data infrastructure, obtain the customer's scoped consent, and detect recurring charges from the permitted transaction feed. In India, the comparable rail is the RBI Account Aggregator framework. Only regulated entities (RBI/SEBI/IRDAI/PFRDA-registered) may be FIUs and receive AA financial information. Vognary can coordinate the vendor integration and keep company credentials away from users, but it cannot buy blanket access to a person's data or remove consent, expiry, renewal, or reauthorization requirements.

## What shipped in code today

- `src/lib/connectors/setu-aa-adapter.ts` — a Setu FIU adapter (consent create → pending approval → provider confirmation → data session → transaction evidence), registered under `account-aggregator`. Sandbox use also requires `ACCOUNT_AGGREGATOR_PARTNER_STATUS=sandbox-approved`; production fails closed unless the status is `production-live` and an approved non-sandbox endpoint is configured.
- Registry honesty is untouched: the connector stays `partner-required` / `partner-gated` until production access is real, exactly as `npm run smoke` enforces.

## Rail 1 — Account Aggregator (bank/card/deposit data): the real "link your bank"

**What it gives users:** consent-based, RBI-regulated read access to supported bank transaction rows — enough to detect many recurring debits, SIPs, EMIs, UPI payments, and premiums from amount, date, mode, and narration. Periodic refresh is possible only for the approved purpose, frequency, duration, and active FIP coverage. Consent remains revocable and may expire or require reauthorization. This is not a universal mandate registry and may not expose item-level card purchases when a bank supplies only a consolidated card-bill payment.

**The constraint that shapes everything:** only regulated entities can be FIUs. Vognary is not one. Three routes, in order of speed:

| Route | What it is | Cost & time | Founder action |
| --- | --- | --- | --- |
| A. Provider sandbox | Setu Bridge or another AA sandbox can prove the technical consent and test-FIP data flow. Sandbox access does not prove that Vognary may receive production data. | Provider confirmation required | Configure only company-owned sandbox credentials and run consent → approval → periodic fetch → revocation tests. Keep the public rail unavailable. |
| B. Contract as a technology provider to a regulated FIU | A regulated FIU remains the accountable data recipient and may procure technology services subject to its applicable outsourcing, data-use, and consent obligations. Current operative RBI directions and Sahamati guidance do not independently authorize Vognary to receive, reuse, or display AA data. | Finvu publishes ₹0.20–₹2.50 per fetch or ₹3–₹6 per active user-account before volume/FIP adjustments; Setu requires a sales quote | Obtain written confirmation from the FIU, gateway, and qualified counsel that the FIU's licence and consent purpose cover recurring-spend insights, and that each proposed Vognary processing, branding, display, retention, and subprocessor activity is permitted. |
| C. Become a regulated FIU | Vognary or an affiliated entity obtains an eligible RBI/SEBI/IRDAI/PFRDA registration, completes FIU certification, and enters the Live Central Registry. Setu can operate the FIU module and absorb certification work, but cannot replace the licence. | Regulatory capital, legal/compliance work, certification, and months of lead time; no validated budget yet | Do not start until counsel maps the exact licence charter and AA purpose code to Vognary's service. |

**Decision:** use A only as technical proof. Pursue B only if a named regulated FIU accepts accountability and grants the required processor/display rights in writing. Otherwise keep the rail unavailable and evaluate C after paid demand justifies regulatory cost. A TSP contract alone is not production authorization.

## Rail 2 — Gmail receipts (the rail already owned)

This is an optional coverage supplement for receipts and renewal notices that bank narration cannot identify. Vognary owns the Google project, client credentials, callback, token vault, verification, and security assessment. Customers never provide developer credentials, but Google still requires each customer to grant revocable access on Google's secure authorization surface.

- Google OAuth verification for the restricted `gmail.readonly` scope requires app review and, because server-side systems transmit or store restricted data, an annual security assessment by a Google-empanelled assessor. Pricing must be obtained from approved assessors; no budget is treated as validated until quoted.
- Google prohibits OAuth inside an embedded user-agent controlled by the developer. A top-level supported browser may navigate to Google and return to Vognary; if Vognary is opened inside an in-app browser that cannot expose the Google URI and connection security, the customer must reopen the flow in a supported browser. A company cannot purchase blanket Gmail access for consumer accounts.
- Until verified, use is limited to explicitly managed test users and refresh-token constraints. Do not expose it as a public rail.

## Rail 3 — Provider billing APIs (live today)

OpenAI, Anthropic, AWS, GitHub, Cloudflare, Render, and Vercel adapters exist for organization-owned accounts. Vognary manages the integration surface, but an authorized account administrator must still grant scoped access, and the provider may require a paid plan or commercial approval. Each adapter covers only that provider account; none reveals unrelated consumer subscriptions.

## Rail 4 — UPI AutoPay & card e-mandates

No consumer-wide UPI or card-mandate registry was found in the official public documentation reviewed. Razorpay, Cashfree, PayU, PhonePe, and similar merchant payment APIs expose mandates and subscriptions created through the integrating merchant's own payment account; buying those products does not reveal a consumer's mandates held by unrelated merchants. Broader mandate visibility therefore stays unavailable unless a bank, issuer, PSP, network, or other authorized party confirms a user-consented route in writing. Vognary retains receipt, pre-debit-notice, and user-provided evidence as fallbacks.

## The "Netflix API" question, answered professionally

No purchasable public third-party subscription-status API was found for Netflix, Spotify, JioHotstar, or Prime. Merchant-specific private partnerships may exist, but none is validated or available to Vognary today. The feasible evidence pattern is:

1. Bank/card descriptors via the regulated rail (Rail 1: `NETFLIX.COM` debit rows).
2. Email receipts (Rail 2: renewal and price-change emails).
3. Merchant knowledge base for cancel paths — Vognary already ships ~103 cancel-action entries.

Bank descriptors plus optional verified email can provide broad evidence, but not guaranteed completeness. Merchant-direct access should remain unavailable unless a merchant publishes or contracts an eligible integration.

## Sequenced founder checklist (only items Claude cannot do)

1. **Procurement qualification:** ask Setu and Finvu for a production quote and a named regulated-FIU route. Require a written answer on end-recipient, processor, derived-insight display, retention, branding, consent purpose, and active-FIP coverage before discussing implementation dates.
2. **Legal gate:** have qualified Indian financial-regulatory/privacy counsel confirm the proposed FIU licence charter and consent purpose cover recurring-spend analysis. Stop if Vognary would become the independent recipient or reuse insights for its own purpose without explicit authority.
3. **Sandbox proof:** after the provider confirms eligibility, use company-owned credentials to validate the FIU's consent request, the provider-approved history window, permitted data fields, periodic refresh, webhook/poll recovery, expiry, reauthorization, revocation, deletion, and inactive-FIP fallback.
4. **Google supplement:** separately complete Google brand/restricted-scope verification and the required annual CASA assessment. Keep Gmail optional and unavailable publicly until approval is evidenced.
5. **Production gate:** activate a rail only after signed contracts, DPA/security approval, approved consent copy, production credentials, a successful real consent/fetch/revocation test, and operator evidence. Users see availability and the provider-required approval or reauthorization flow; they never see company configuration.

Sources checked 2026-07-17: RBI NBFC-AA Master Directions, including FIU eligibility, explicit consent, intended-recipient, purpose, expiry, and data-use limits (rbi.org.in); current Sahamati member Code of Conduct and FIU eligibility material (sahamati.org.in); Setu consent, embedded-screen, FI-type, active-FIP, and go-live documentation (docs.setu.co); Finvu AA API and pricing pages (finvu.in); Google Gmail scope, restricted-scope verification, and secure-browser policy documentation (developers.google.com, developers.googleblog.com); Plaid institution coverage and Recurring Transactions documentation (plaid.com).
