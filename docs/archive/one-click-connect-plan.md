# Consent Rails and Merchant Watches — Activation Plan

Date: 2026-07-17
Goal: Vognary contracts and operates the product integration while a named regulated FIU remains the accountable AA data recipient. Users never see provider credentials or deployment configuration. A user reviews the scoped, revocable consent required to access that user's data and returns automatically to Vognary; expiry or provider policy may require reauthorization. Pair with [direct-linking-activation-dossier.md](direct-linking-activation-dossier.md) for the procurement and regulatory gates.

## The model in one paragraph

The primary target is a **company-managed bank-transaction product** through an approved Account Aggregator/FIU arrangement. The regulated FIU receives AA financial information; Vognary processes or displays derived recurring-spend insights only to the extent the FIU contract, customer consent, and applicable law explicitly permit. Supported transaction evidence may refresh while the scoped periodic consent and FIP remain active. **Email receipts** are optional coverage for merchants that bank narration cannot identify and require a separate Google approval. Merchant tiles remain local matching preferences, not direct merchant connections. No customer supplies an API key, redirect URI, provider secret, or developer-console setting.

## What shipped in code (this change)

| Piece | File | State |
| --- | --- | --- |
| Rail + tile registry with merchant descriptors and honest coverage copy | `src/lib/connect-rails.ts` | Done; covered by `tests/connect-rails.test.ts` and `claims:check` |
| Connections panel: 2 consent rail cards + clearly labelled merchant-watch grid | `src/app/vognary-mvp-client.tsx` (`IntegrationCommandCenter`, `RailCard`) | Done |
| Merchant watches included in the encrypted/opt-in workspace snapshot, with instant matching against existing ledger evidence | `WorkspaceBackup.merchantLinks` | Done |
| Account Aggregator consent start: create pending Setu consent → return approval URL → poll → activate only after provider confirmation | `src/app/api/integrations/aa/start/route.ts` + `requestSetuConsent` in `setu-aa-adapter.ts` | Done; sandbox requires credentials plus `sandbox-approved`; production requires the approved endpoint plus `production-live` |
| Gmail top-level browser authorization and automatic return | existing `/api/integrations/gmail/start` | Code-ready for supported browsers; public availability remains closed until Google restricted-scope verification and security assessment are complete |

## Exact activation sequence (founder-only steps)

1. **Qualify the regulated structure.** Before buying anything, obtain written confirmation naming the regulated FIU, the consent purpose, the data recipient, and Vognary's permitted role. A gateway or TSP subscription alone is insufficient.
2. **Contract the FIU and gateway structure.** Compare a Setu quote with Finvu's published per-fetch/per-active-account ranges, active-FIP coverage, periodic-fetch support, consent theming, uptime metrics, deletion, and support SLA. The agreement must name the FIU as recipient and define Vognary's processor and display rights. Users never receive company credentials.
3. **Prove the full lifecycle in sandbox.** Test the regulated FIU's consent request, approval and return, permitted processing, recurrence detection, scheduled refresh, failure recovery, expiry, reauthorization, revocation, deletion, and fallback when an FIP is inactive.
4. **Complete the Google supplement separately.** Submit `gmail.readonly` for restricted-scope verification and complete the annual security assessment required when server-side systems transmit or store restricted Gmail data.
5. **Open production only on evidence.** Signed FIU/provider contracts, qualified legal approval, production credentials, approved consent copy, and observed fetch/revocation evidence are mandatory. The customer UI receives only `available` or `company-activation-pending`.

## What this deliberately does not claim

- No universal "connect once, everything appears" promise — coverage is per-rail and the UI says so per tile.
- No Netflix/Spotify/Hotstar direct APIs exist; the tiles say evidence arrives via bank descriptors and receipts.
- Merchant payment-processor APIs cover only mandates created through that merchant account. Consumer-wide UPI/card mandate visibility remains unavailable until an authorized party validates a broader user-consented route.

## How a user experiences it

1. Open Connections and choose **Bank transactions**. Vognary has already arranged the company-side FIU and provider integration.
2. Enter the AA handle and review the scoped request in the regulated consent experience. When the provider supplies a browser return URL, Vognary continues in the same tab; otherwise approval completes in the Account Aggregator app while Vognary waits for provider confirmation.
3. The regulated FIU receives the permitted transaction history. Vognary detects and displays recurring streams only under its approved processing role. Refresh continues only while consent and provider coverage remain active; inactive institutions fall back to receipt paste or statement import.
4. Optionally connect **Email receipts** through Google's secure approval to improve merchant and renewal detail.
