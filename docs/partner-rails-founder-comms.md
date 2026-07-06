# Partner Rails Founder Comms

Use this file when contacting AA/TSP, UPI AutoPay, and card e-mandate providers. The goal is not to ask for a vague partnership. The goal is to discover whether a compliant sandbox path exists and whether Vognary can become a paid API/customer use case.

## Positioning

One-liner:

```text
Vognary is an evidence-first recurring-payment audit product that helps users and founders identify recurring financial commitments across bank debits, UPI AutoPay, card mandates, SaaS, cloud, app stores, insurance, EMIs, SIPs, and receipts.
```

What Vognary is not:

```text
We are not collecting payments, storing card numbers, scraping bank passwords, or asking for cancellation powers on day one.
```

What Vognary needs:

```text
We need a compliant sandbox path to test user-consented recurring-payment evidence: merchant or biller, amount/cap, cadence, next debit or last debit, status, and consent metadata.
```

## Why They Benefit

### AA / TSP / Open-Finance Provider

They benefit if Vognary becomes a new recurring-use-case customer on their AA or open-finance rails.

Say:

```text
If this works, Vognary can become a paid API/customer use case for consented account-data access. We bring a specific recurring-payment intelligence workflow, not a generic PFM ask.
```

Their likely interests:

- More FIU/use-case demand on their rails.
- A clear founder/household recurring-payment use case.
- Usage-based API revenue if the beta converts.
- A differentiated demo of AA data beyond lending and wealth.

### Payment Aggregator / PSP / Payments Infrastructure

They benefit if Vognary helps merchants and founders understand mandates, subscriptions, invoices, and failed recurring payments attached to their payment stack.

Say:

```text
If the sandbox proves useful, Vognary can route qualified founders and merchants toward your subscription, mandate, payment-link, or recurring-payment stack.
```

Their likely interests:

- Merchant adoption of subscriptions, mandates, payment links, and recurring payments.
- Better visibility for merchants already using their stack.
- Reduced support burden around failed mandates and unclear recurring charges.
- A founder-facing analytics layer that can drive payment product usage.

### Bank / Issuer / Network

They benefit only if Vognary can prove user demand and compliance maturity.

Say:

```text
We are starting with proof and sandbox validation. We are not asking for broad production access before proving the user value and consent design.
```

Their likely interests:

- Customer trust and visibility into recurring debits.
- Reduced mandate confusion and support tickets.
- A compliant consent UX, not screen scraping.

## Primary Email

Subject options:

```text
Sandbox question: user-consented recurring-payment evidence
```

```text
Can your sandbox expose mandate/account evidence for recurring-payment audits?
```

Email:

```text
Hi <name>,

I am building Vognary, an evidence-first recurring-payment audit product for founders, freelancers, and households in India.

Vognary already supports manual, statement, and private-audit workflows. We are now checking the compliant partner path for user-authorized mandate and account-data visibility.

We are not collecting payments, storing card numbers, scraping bank passwords, or asking for cancellation powers on day one.

The specific sandbox question:

Can your API expose any user-consented recurring-payment evidence such as merchant/biller, amount or amount cap, cadence, next debit or last debit, mandate status, and consent metadata?

We are trying to determine which of these your sandbox supports:

1. Account Aggregator / FIU or TSP path for consented account statement data.
2. UPI AutoPay mandate visibility for active mandates.
3. Card e-mandate or recurring transaction visibility.
4. Merchant-side mandate/subscription visibility for businesses using your payment stack.

If yes, could you share the sandbox onboarding steps, API docs, compliance requirements, DPA/security requirements, and commercial path?

If the sandbox proves useful, Vognary can become a paid API/customer use case and a recurring-payment intelligence layer that sends qualified users or merchants into your ecosystem.

Relevant links:
- Product: https://www.vognary.com
- Privacy: https://www.vognary.com/privacy
- Security: https://www.vognary.com/security

Thanks,
Varun
```

## Provider-Specific Notes

### Setu / Pine Labs

Ask:

```text
Does your current open-finance / AA partner path support a startup like Vognary testing consented account-statement data for recurring-payment audits, or do we need to be an FIU directly before sandbox access?
```

Best angle: open-finance use case, AA/TSP route, consented account data.

### FinBox

Ask:

```text
Can FinBox support a sandbox for consented account data where Vognary detects recurring financial commitments from transaction evidence?
```

Best angle: transaction intelligence, enrichment, recurring debit detection.

### Decentro

Ask:

```text
Which Decentro APIs or partner routes can support user-consented bank/account evidence or mandate evidence for recurring-payment audits?
```

Best angle: banking/API infra and sandbox onboarding.

### Perfios

Ask:

```text
Can Perfios support a recurring-payment audit use case from consented statement/account data, and what compliance path is required?
```

Best angle: statement/account analytics and compliance.

### Digio

Ask:

```text
Does Digio support an AA/TSP or consent workflow route for a recurring-payment audit product, and what sandbox credentials or compliance documents are needed?
```

Best angle: onboarding, consent, regulated workflow infrastructure.

### Razorpay

Ask:

```text
For Razorpay subscriptions, payment links, UPI AutoPay, or card mandates, can a merchant retrieve active mandates/subscriptions with amount, cadence, status, next debit, and failure reason? Is there any user-consented consumer-side mandate visibility, or is the API merchant-side only?
```

Best angle: merchant-side recurring payment intelligence first.

### Cashfree

Ask:

```text
Can Cashfree expose merchant-side subscription or mandate metadata in sandbox, including merchant/biller, amount/cap, cadence, next debit, status, and failed debit reasons?
```

Best angle: merchant-side mandate/subscription visibility.

### PayU

Ask:

```text
Does PayU provide sandbox APIs for recurring payments, mandates, or subscriptions that expose mandate status, amount, cadence, and next debit metadata for merchants?
```

Best angle: merchant recurring payments and subscription intelligence.

### Juspay

Ask:

```text
Can Juspay support a sandbox route for UPI/card mandate metadata, either merchant-side or through a PSP/issuer processor route?
```

Best angle: payments orchestration, mandate metadata, PSP/processor route.

### PhonePe / PSP Contact

Ask:

```text
Is there any partner route for a user-authorized app to view active UPI AutoPay mandates, or is mandate visibility limited to the user's PhonePe app experience?
```

Best angle: truth discovery. Expect a no or redirection unless you have a partner contact.

## LinkedIn Connection Note

```text
Hi <name>, I am building Vognary, a recurring-payment audit product for India. I am trying to understand whether your sandbox can expose user-consented mandate/account evidence such as merchant, amount, cadence, next debit, and status. Could I ask the right person on your team?
```

## Follow-Up 1: Three Days Later

```text
Hi <name>, quick follow-up on this.

The narrow question is whether your sandbox can expose recurring-payment evidence, not whether you can support a broad partnership immediately.

If there is a better product/API partnerships contact for AA, UPI AutoPay, subscriptions, or card e-mandates, could you point me there?
```

## Follow-Up 2: Seven Days Later

```text
Hi <name>, closing the loop on this.

Even a no is useful. We are mapping which rails are actually available for compliant recurring-payment evidence and which ones must stay manual/fallback for now.

Can your team support sandbox access for this use case, or should we treat this rail as unavailable for now?
```

## Objection Handling

### "We only support merchants, not consumer-wide mandates."

Reply:

```text
That is useful. Can we test merchant-side mandate/subscription visibility first for founders and businesses using your stack? We can keep consumer-wide mandate visibility marked as unavailable and avoid making any public claim.
```

### "You need to be an FIU."

Reply:

```text
Understood. Do you have a TSP/partner route where Vognary can validate the product workflow before pursuing direct FIU status, or should we treat direct FIU approval as the required path?
```

### "What volume do you have?"

Reply:

```text
We are in private beta. The goal is sandbox validation first, then paid audits and recurring monitoring. If sandbox confirms the data surface, we can route qualified early users or merchants into the approved production path.
```

### "Are you trying to cancel mandates?"

Reply:

```text
No. The first use case is visibility and evidence. Cancellation/modify would only be considered after legal review and explicit user action, and only if your policy allows it.
```

### "Can you send docs?"

Reply:

```text
Yes. Current product: https://www.vognary.com
Privacy: https://www.vognary.com/privacy
Security: https://www.vognary.com/security

The requested fields are merchant/biller, amount or cap, cadence, next debit or last debit, status, and consent metadata. We do not need card numbers or banking credentials.
```

## First Call Agenda

Use this 20-minute agenda:

1. Explain Vognary in 60 seconds.
2. Confirm whether they support AA, UPI AutoPay, card mandates, subscriptions, or merchant-side recurring payments.
3. Ask whether the data is consumer-side, merchant-side, or both.
4. Ask for available fields and sample payloads.
5. Ask for sandbox onboarding steps.
6. Ask for compliance documents, DPA, and consent-copy requirements.
7. Ask for commercial path and production approval sequence.
8. Confirm next action and owner.

## What To Record In The Tracker

For every response, update:

- Status: `outreach-started`, `sandbox-requested`, `sandbox-approved`, or `production-live`.
- Whether access is merchant-side only or user-consented consumer-side.
- Available fields.
- Required legal/compliance steps.
- Next owner and date.

## Decision Rules

- If they only expose merchant-side APIs, use them for merchant/founder customers but do not claim consumer-wide mandate visibility.
- If they require direct FIU status and offer no partner route, mark AA as a later regulated path.
- If they cannot expose mandate status, keep that rail manual/fallback.
- If they provide sandbox credentials, build a sandbox adapter before changing any production claims.