# Direct Linking Activation Dossier

Date: 2026-07-17
Purpose: the honest, decision-ready map from "no more uploads" to real linked sources — what is code-ready today, what money buys, what a partnership buys, and what does not exist at any price. Pair with [partner-rails-access-playbook.md](partner-rails-access-playbook.md) (outreach templates) and [legal-platform-integration-action-report.md](legal-platform-integration-action-report.md).

## The one-paragraph truth

There is no public "Netflix API" or "PhonePe API" that any consumer app in India can call to read a person's subscriptions. Every product that shows "linked bank data" legally does it through exactly one rail: the RBI Account Aggregator framework — and only regulated entities (RBI/SEBI/IRDAI/PFRDA-registered) may consume that data as FIUs. Everything else on the market is either e-mail receipt parsing (Gmail), provider billing APIs (OpenAI, AWS, Vercel…), statement import, or screen-scraping (illegal to do with bank credentials, and Vognary never will). Vognary already ships three of the four legal rails; this dossier activates the fourth.

## What shipped in code today

- `src/lib/connectors/setu-aa-adapter.ts` — a complete Setu FIU adapter (consent create → approval URL → data session → transaction evidence), registered in the adapter registry under `account-aggregator`. It activates the moment `SETU_AA_CLIENT_ID`, `SETU_AA_CLIENT_SECRET`, `SETU_AA_PRODUCT_INSTANCE_ID` exist. No code change needed on signing day.
- Registry honesty is untouched: the connector stays `partner-required` / `partner-gated` until production access is real, exactly as `npm run smoke` enforces.

## Rail 1 — Account Aggregator (bank/card/deposit data): the real "link your bank"

**What it gives users:** consent-based, RBI-regulated read access to bank transactions — recurring debits, SIPs, EMIs, UPI AutoPay hits, insurance premiums — refreshed on schedule, no passwords, revocable by the user.

**The constraint that shapes everything:** only regulated entities can be FIUs. Vognary is not one. Three routes, in order of speed:

| Route | What it is | Cost & time | Founder action |
| --- | --- | --- | --- |
| A. Sandbox now | Setu Bridge sandbox keys are self-serve; full consent + data flow against test banks | Free; ~30 minutes | Sign up at bridge.setu.co, create an AA product instance, paste the three keys into env. The adapter and demo work end-to-end same day. |
| B. Operate under a regulated partner | TSPs (Setu, Finvu, Decentro-class) onboard FIUs and absorb Sahamati certification (Setu uses empanelled certifier Aujas). Several consumer PFM products run under a regulated partner's FIU registration while their own registration is in flight. | Per-fetch pricing ~₹0.01–₹25 (Setu published band); commercial agreement; typical 4–10 weeks | Email Setu/Finvu sales with the use case ("recurring-payment audit, read-only, PFM class"). Templates are ready in partner-rails-founder-comms.md. Ask explicitly about the unregulated-entity path and Fair Use template fit (mandatory since 1 Jun 2025). |
| C. Become regulated | The route several PFM apps took: SEBI RIA registration (or NBFC route) to qualify as an FIU in Vognary's own name | ₹ lakhs + net-worth requirements + months; do this after revenue, not before | Park until Route B is live and paying. |

**Decision:** do A this week (it makes the product demo real), start B in parallel with the existing outreach kit, defer C.

## Rail 2 — Gmail receipts (the rail already owned)

This is the highest-coverage "no upload" rail that exists for an unregulated startup, and the code is already live. Netflix, Spotify, Prime, app stores, SaaS — they all send receipts and RBI-mandated pre-debit notices to email. What remains is distribution, not code:

- Google OAuth verification for the restricted `gmail.readonly` scope: app verification + annual CASA security assessment (Tier 2; roughly $500–$4,500/yr depending on assessor and scope — get quotes from an approved assessor list). This is a founder task (Google Cloud Console ownership, privacy policy, demo video).
- Until verified, the connector works for up to 100 test users — enough for the entire private-audit pipeline.

## Rail 3 — Provider billing APIs (live today)

OpenAI, Anthropic, AWS, GitHub, Cloudflare, Render, Vercel adapters exist and sync with a workspace API key. This is the "professional" rail for the founder/builder ICP and needs no permission from anyone. Nothing to buy.

## Rail 4 — UPI AutoPay & card e-mandates

No consumer-facing API exists — not from PhonePe, not from Google Pay, not from NPCI. Mandate visibility APIs are exposed only to PSPs, banks, and payment aggregators. The playbook (existing) targets Razorpay/Cashfree/Juspay-class partners for user-authorized mandate visibility; until one signs, Vognary's Guided Proof Capture + RBI pre-debit email parsing is the *only honest coverage in the market* — competitors claiming "UPI sync" are scraping notifications on-device or faking it.

## The "Netflix API" question, answered professionally

Netflix, Spotify, Hotstar, Prime have **no** subscription-status APIs for third parties, in any country, at any price. How the category leaders (Rocket Money, Trim, CRED) actually cover them:

1. Bank/card descriptors via the regulated rail (Rail 1: `NETFLIX.COM` debit rows).
2. Email receipts (Rail 2: renewal and price-change emails).
3. Merchant knowledge base for cancel paths — Vognary already ships ~103 cancel-action entries.

Vognary's coverage story for these merchants is therefore already correct; Rail 1 + verified Gmail complete it. No partnership with Netflix is available or needed.

## Sequenced founder checklist (only items Claude cannot do)

1. **Today (30 min):** create the Setu Bridge sandbox account → paste `SETU_AA_*` keys into `.env.local` → the AA flow runs against sandbox banks.
2. **This week:** send the two prepared Setu/Finvu emails (partner-rails-send-queue.md) with the Fair Use question added; book the Google OAuth verification start (Cloud Console → OAuth consent screen → submit for restricted-scope review).
3. **On sandbox approval:** set `ACCOUNT_AGGREGATOR_PARTNER_STATUS=sandbox-approved` in Vercel so the trust pages advance one honest notch.
4. **On production agreement:** set `production-live`, flip the registry status in one line, and the sidebar's "Link live sources" door becomes the primary onboarding path for every user.

Sources: Setu AA docs and pricing policy (docs.setu.co, setu-aa.com/pricing-policy), Sahamati FIU eligibility and Fair Use rollout (sahamati.org.in), Setu FIU go-live process (docs.setu.co/data/account-aggregator/licenses-and-go-live/go-live).
