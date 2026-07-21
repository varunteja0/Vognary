# Partner Rails Access Playbook

Use this to pursue Account Aggregator, UPI AutoPay, and card e-mandate access without overclaiming live coverage.

For exact emails, LinkedIn notes, follow-ups, objections, and call scripts, use [docs/partner-rails-founder-comms.md](partner-rails-founder-comms.md).

## Current Truth

Vognary already supports manual/fallback evidence for mandates and recurring payments. Direct AA/UPI/card mandate sync is not self-serve. It needs written partner approval, sandbox credentials, legal/compliance review, and production credentials before any public claim.

Do not set partner rail env vars to `production-live` until the matching partner confirms production access in writing.

## Readiness Status Values

Use these exact values in Vercel only when they are true:

```text
ACCOUNT_AGGREGATOR_PARTNER_STATUS=outreach-started | sandbox-requested | sandbox-approved | production-live
UPI_MANDATE_PARTNER_STATUS=outreach-started | sandbox-requested | sandbox-approved | production-live
CARD_MANDATE_PARTNER_STATUS=outreach-started | sandbox-requested | sandbox-approved | production-live
```

Strict production only treats partner rails as ready when all three are `production-live`.

## Who To Contact First

Prioritize partners by the data Vognary needs, not by brand familiarity.

| Rail | First partner type | Ask for | Stop if |
| --- | --- | --- | --- |
| Account Aggregator | AA TSP / FIU enablement partner | Consent-based bank/account statement data for recurring-payment audit use case | They require Vognary to become a regulated FIU before sandbox discussion and offer no partner route. |
| UPI AutoPay | PSP, bank, payment aggregator, or NPCI-connected partner | User-authorized active mandate visibility: merchant, amount, next debit, status, cancel/modify metadata | They only expose merchant collection APIs for mandates created by Vognary. |
| Card e-mandates | Issuer, card network partner, payment aggregator, or issuer processor | User-authorized card mandate visibility and pre-debit evidence | They only expose merchant-side subscription APIs. |

Candidate examples to verify before outreach:

- AA / TSP / open-finance: Sahamati ecosystem participants, Setu, FinBox, Decentro, Perfios, Digio, Finvu, OneMoney, Anumati.
- UPI / mandates / payments: Razorpay, Cashfree, PhonePe, PayU, Juspay, Decentro, bank PSP teams.
- Card mandates: Razorpay, Cashfree, PayU, Juspay, issuer partnership teams, card network fintech partnership teams.

## Minimum Ask

Ask for sandbox access to read user-consented evidence, not payment collection.

Required fields:

- `provider_account_id`
- `mandate_id` or consent artifact reference
- merchant or biller name
- amount or amount cap
- frequency / cadence
- next debit date or last debit date
- status: active, paused, revoked, expired, failed, pending
- source rail: AA, UPI AutoPay, card e-mandate, bank debit
- consent expiry and revocation URL or procedure

Optional but high value:

- pre-debit notification timestamp
- cancel/modify deep link or API route
- failure reason
- masked funding account/card descriptor

## Email Template

Subject: Sandbox access request for consent-based recurring-payment audit

```text
Hi <name>,

I am building Vognary, an evidence-first recurring-payment audit product for founders, freelancers, and households in India.

The product already supports manual and statement-based recurring-payment audits. We are now looking for a compliant partner path for user-authorized mandate and account-data visibility.

Use case:
- User consents to connect a source.
- Vognary reads only recurring-payment evidence: active mandates, merchant/biller, amount or cap, cadence, next debit/last debit, and status.
- Vognary does not collect payments, store card numbers, scrape passwords, or initiate cancellation without explicit user action.

Could you confirm whether your sandbox supports any of these?
1. Account Aggregator / FIU or TSP path for account statement data.
2. UPI AutoPay mandate visibility for user-authorized active mandates.
3. Card e-mandate / recurring transaction visibility.
4. Merchant-side mandate visibility for businesses using your payment stack.

If yes, please share the sandbox onboarding steps, API docs, compliance requirements, data processing agreement, and commercial requirements.

Relevant Vognary endpoints:
- Product: https://www.vognary.com
- Privacy: https://www.vognary.com/privacy
- Security: https://www.vognary.com/security

Thanks,
Varun
```

## Call Script

1. Confirm whether they support consumer-wide mandate visibility or only merchant-side mandates.
2. Confirm whether Vognary can operate through their regulated/TSP route or must become an FIU directly.
3. Ask for sandbox credentials and sample payloads.
4. Ask which consent text and retention limits they require.
5. Ask whether cancellation/modify is allowed, referral-only, or prohibited.
6. Ask for production approval sequence: sandbox, security review, DPA, commercials, production keys.

## Technical Validation Checklist

Before marking any rail as `sandbox-approved`, collect:

- Written confirmation of permitted use case.
- Sandbox credentials or partner sandbox invitation.
- API docs or sample files.
- Sample payload with recurring-payment evidence fields.
- Consent/revocation requirements.
- Data retention requirements.
- Security questionnaire or DPA requirements.

Before marking any rail as `production-live`, collect:

- Production credentials.
- Signed agreement / DPA where applicable.
- Approved consent copy.
- Security review pass.
- At least one real production user consent test.
- Evidence persisted in Vognary without storing prohibited data.

## Vognary Implementation Sequence After Sandbox

1. Add connector adapter behind the existing connector registry id.
2. Store partner credentials through encrypted token refs, not raw env vars when per-workspace access exists.
3. Normalize payloads into `connector_evidence` and recurring graph evidence.
4. Show source coverage gaps instead of claiming universal coverage.
5. Add consent revocation and deletion tests.
6. Run strict production check only after production credentials are live.