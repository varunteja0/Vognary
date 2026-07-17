# Consent Rails and Merchant Watches — Activation Plan

Date: 2026-07-17
Goal: users never paste provider credentials in the Connections panel. They authorize supported evidence rails on provider consent pages, then save clearly labelled local merchant watches. Pair with [direct-linking-activation-dossier.md](direct-linking-activation-dossier.md) (the market-reality research this plan implements).

## The model in one paragraph

Two consent rails can supply data: **email receipts** (Gmail OAuth — the user approves on Google's page) and **bank evidence** (RBI Account Aggregator — the user approves in the regulated AA flow). Every consumer platform tile (Netflix, Spotify, Prime, ChatGPT, Claude, Apple, Google Play, …) is a **merchant watch**: one click saves a local matching preference, and qualifying evidence from connected rails can be organized by merchant descriptors. It does not connect to the merchant account. No API keys are collected on this consumer surface; workspace admins can still register scoped provider keys (OpenAI org, AWS, GitHub org) on `/sources`.

## What shipped in code (this change)

| Piece | File | State |
| --- | --- | --- |
| Rail + tile registry with merchant descriptors and honest coverage copy | `src/lib/connect-rails.ts` | Done; covered by `tests/connect-rails.test.ts` and `claims:check` |
| Connections panel: 2 consent rail cards + clearly labelled merchant-watch grid | `src/app/vognary-mvp-client.tsx` (`IntegrationCommandCenter`, `RailCard`) | Done |
| Merchant watches included in the encrypted/opt-in workspace snapshot, with instant matching against existing ledger evidence | `WorkspaceBackup.merchantLinks` | Done |
| Account Aggregator consent start: create pending Setu consent → return approval URL → poll → activate only after provider confirmation | `src/app/api/integrations/aa/start/route.ts` + `requestSetuConsent` in `setu-aa-adapter.ts` | Done; sandbox requires credentials plus `sandbox-approved`; production requires the approved endpoint plus `production-live` |
| Gmail one-click OAuth redirect | existing `/api/integrations/gmail/start` | Already live (needs Google verification for >100 users) |

## Exact activation sequence (founder-only steps)

1. **Setu sandbox.** Create the FIU product instance, configure its consent object and callback/redirect, obtain the issued sandbox credentials, then set `SETU_AA_CLIENT_ID`, `SETU_AA_CLIENT_SECRET`, `SETU_AA_PRODUCT_INSTANCE_ID`, `SETU_AA_BASE_URL`, and `ACCOUNT_AGGREGATOR_PARTNER_STATUS=sandbox-approved`. Validate consent creation, approval, polling, and transaction fetch against the provider's test FIP before enabling testers.
2. **This week — Google OAuth verification.** Submit the restricted-scope (`gmail.readonly`) verification in Google Cloud Console. Until approved, Gmail one-click works for up to 100 test users — enough for the private-audit pipeline.
3. **Setu/Finvu FIU agreement.** Complete the partner, eligibility, security, consent-object, and production endpoint reviews. Set `ACCOUNT_AGGREGATOR_PARTNER_STATUS=production-live` only after the partner confirms the production FIU path; the application refuses to use a sandbox endpoint in production.
4. **Later — provider OAuth rail (optional third rail).** Register developer apps where true OAuth exists (GitHub, Google, Microsoft). Each adds a direct one-click connection for that provider without touching the tile UX.

## What this deliberately does not claim

- No universal "connect once, everything appears" promise — coverage is per-rail and the UI says so per tile.
- No Netflix/Spotify/Hotstar direct APIs exist; the tiles say evidence arrives via bank descriptors and receipts.
- UPI mandate *registries* (PhonePe/GPay) remain partner-gated; pre-debit notification emails via the Gmail rail are the honest interim coverage.

## How a user experiences it

1. Open Connections → click **Connect** on Email receipts → approve on Google's page → receipts import.
2. Click **Connect** on Bank & UPI → enter only the AA handle (identity, not a password) → review and approve in the regulated AA flow → Vognary keeps the source pending until provider confirmation, then starts scheduled evidence sync.
3. Click **Watch** on Netflix (or any tile) → matching commitments already in the ledger surface instantly; future matching evidence can attach as connected rails sync.
