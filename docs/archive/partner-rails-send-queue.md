# Partner Rails Send Queue

This is the copy/paste send queue. Open the route, paste the matching message, submit, then update `docs/partner-rails-outreach-tracker.csv`.

## Universal Subject

```text
Sandbox question: recurring-payment evidence for Vognary
```

## Universal Short Message

Use this when a form has a small message box.

```text
I am building Vognary, an evidence-first recurring-payment audit product for India. We already support manual and statement-based audits. I want to confirm whether your sandbox can expose user-consented recurring-payment evidence: merchant/biller, amount/cap, cadence, next debit/last debit, mandate status, and consent metadata. We are not collecting payments, storing card numbers, scraping passwords, or asking for cancellation powers. Could you route me to the right API/partnership contact?
```

## 1. Razorpay

Open:

```text
https://razorpay.com/support/payments/#request
```

Reference links:

```text
https://razorpay.com/docs/api/
https://razorpay.com/docs/api/sandbox-setup
https://razorpay.com/docs/api/payments/tpap-pro/mandate-flow/
https://razorpay.com/docs/api/payments/subscriptions/
```

Paste:

```text
Hi Razorpay team,

I am building Vognary, an evidence-first recurring-payment audit product for founders, freelancers, and households in India.

Vognary already supports manual, statement, receipt, and private-audit workflows. We are now checking the compliant partner path for mandate and recurring-payment evidence.

We are not collecting payments, storing card numbers, scraping bank passwords, or asking for cancellation powers on day one.

Specific question for Razorpay:

For Razorpay subscriptions, payment links, UPI AutoPay, or card mandates, can a merchant retrieve active mandates/subscriptions with amount, cadence, status, next debit, and failure reason? Is any user-consented consumer-side mandate visibility available, or is the API merchant-side only?

If the sandbox supports this, could you share the onboarding steps, relevant API docs, compliance requirements, DPA/security requirements, and commercial path?

If useful, Vognary can become a qualified merchant/use-case lead for Razorpay subscriptions, mandates, payment links, and recurring-payment products.

Product: https://www.vognary.com
Privacy: https://www.vognary.com/privacy
Security: https://www.vognary.com/security

Thanks,
Varun
```

Tracker note after submit:

```text
Sent Razorpay request via payments support ticket. Asked merchant-side vs consumer-side mandate visibility.
```

## 2. Cashfree

Open:

```text
https://www.cashfree.com/contact-sales/
```

Fallback:

```text
https://www.cashfree.com/contact-us
https://merchant.cashfree.com/merchants/signup/
```

Reference links:

```text
https://www.cashfree.com/docs/api-reference/payments/latest/subscription/overview
https://www.cashfree.com/docs/api-reference/payments/latest/subscription/mandate/create
```

Paste:

```text
Hi Cashfree team,

I am building Vognary, an evidence-first recurring-payment audit product for founders, freelancers, and households in India.

Vognary already supports manual, statement, receipt, and private-audit workflows. We are now checking whether Cashfree Subscriptions can support merchant-side recurring-payment intelligence in sandbox.

We are not collecting payments, storing card numbers, scraping bank passwords, or asking for cancellation powers on day one.

Specific question for Cashfree:

Can Cashfree Subscriptions expose merchant-side subscription or mandate metadata in sandbox, including customer/merchant reference, amount or amount cap, cadence, next debit, mandate status, payment status, and failed debit reason?

If yes, could you share sandbox onboarding steps, API docs, webhook/event docs, compliance requirements, DPA/security requirements, and commercial path?

If useful, Vognary can route founders and merchants toward Cashfree subscription, mandate, and recurring billing products.

Product: https://www.vognary.com
Privacy: https://www.vognary.com/privacy
Security: https://www.vognary.com/security

Thanks,
Varun
```

Tracker note after submit:

```text
Submitted Cashfree sales request. Asked about subscription/mandate metadata and failure fields.
```

## 3. PayU

Open:

```text
https://onboarding.payu.in/app/account/signup
```

Reference links:

```text
https://docs.payu.in/docs/using-api-integration-recurring-payments
https://docs.payu.in/reference/check-mandate-status-api
https://docs.payu.in/reference/get-mandate-status-api-for-upi-only
```

Paste:

```text
Hi PayU team,

I am building Vognary, an evidence-first recurring-payment audit product for founders, freelancers, and households in India.

Vognary already supports manual, statement, receipt, and private-audit workflows. We are now checking whether PayU recurring payment APIs can support merchant-side mandate/subscription visibility in sandbox.

We are not collecting payments, storing card numbers, scraping bank passwords, or asking for cancellation powers on day one.

Specific question for PayU:

Can PayU recurring payment APIs expose UPI, card, or net-banking mandate status, amount/cap, cadence, next debit or last debit, pre-debit notification status, and failure metadata for merchant-side recurring-payment audits?

If yes, could you share sandbox onboarding steps, required account activation steps, relevant API docs, webhook docs, compliance requirements, and commercial path?

If useful, Vognary can become a use-case and merchant lead for PayU recurring payments, mandates, and subscription products.

Product: https://www.vognary.com
Privacy: https://www.vognary.com/privacy
Security: https://www.vognary.com/security

Thanks,
Varun
```

Tracker note after submit:

```text
Submitted PayU inquiry. Asked for UPI/card/net-banking mandate status APIs and sandbox path.
```

## 4. Juspay

Open:

```text
https://juspay.io/contact
```

Reference links:

```text
https://docs.juspay.io/ec-api-global/docs/mandates/introduction
https://juspay.io/docs
https://portal.juspay.in/
```

Paste:

```text
Hi Juspay team,

I am building Vognary, an evidence-first recurring-payment audit product for founders, freelancers, and households in India.

Vognary already supports manual, statement, receipt, and private-audit workflows. We are now checking whether Juspay can support merchant-side mandate/subscription visibility in sandbox or route us to the right PSP/processor path.

We are not collecting payments, storing card numbers, scraping bank passwords, or asking for cancellation powers on day one.

Specific question for Juspay:

Can Juspay support sandbox access for mandate metadata, either merchant-side or through PSP/issuer processor routes, including mandate status, amount, cadence, next debit, failed debit reason, and analytics fields?

If yes, could you share sandbox onboarding steps, relevant docs, sample payloads, compliance requirements, DPA/security requirements, and commercial path?

If useful, Vognary can route qualified founders and merchants toward Juspay recurring payments, mandate orchestration, and payment observability products.

Product: https://www.vognary.com
Privacy: https://www.vognary.com/privacy
Security: https://www.vognary.com/security

Thanks,
Varun
```

Tracker note after submit:

```text
Submitted Juspay contact form. Asked about merchant-side/processor-route mandate metadata and sample payloads.
```

## 5. PhonePe

Open:

```text
https://business.phonepe.com/pg/register
```

Fallback/contact:

```text
https://www.phonepe.com/contact-us/
```

Reference links:

```text
https://developer.phonepe.com/payment-gateway
https://developer.phonepe.com/payment-gateway/autopay/api-integration/introduction
https://developer.phonepe.com/payment-gateway/autopay/uat-sandbox
```

Paste:

```text
Hi PhonePe team,

I am building Vognary, an evidence-first recurring-payment audit product for founders, freelancers, and households in India.

Vognary already supports manual, statement, receipt, and private-audit workflows. We are now checking whether PhonePe Autopay can support merchant-side or user-consented mandate evidence in sandbox.

We are not collecting payments, storing card numbers, scraping bank passwords, or asking for cancellation powers on day one.

Specific question for PhonePe:

Does PhonePe Autopay or any partner route expose merchant-side or user-consented UPI AutoPay mandate status, amount/cap, cadence, next debit, and revocation/cancellation metadata in sandbox?

If yes, could you share sandbox onboarding steps, docs, compliance requirements, DPA/security requirements, and commercial path?

If useful, Vognary can route qualified founders and merchants toward PhonePe Autopay, payment links, and recurring-payment products.

Product: https://www.vognary.com
Privacy: https://www.vognary.com/privacy
Security: https://www.vognary.com/security

Thanks,
Varun
```

Tracker note after submit:

```text
Submitted PhonePe PG/Autopay inquiry. Asked whether mandate visibility is merchant-side only or user-consented.
```

## 6. Setu / Pine Labs

Open:

```text
https://www.pinelabs.com/contact-sales
```

Reference links:

```text
https://api-playground.setu.co/
https://www.pinelabs.com/docs
https://www.pinelabs.com/fintech-infrastructure/account-aggregator-gateway
https://www.pinelabs.com/fintech-infrastructure/upi-autopay
```

Paste:

```text
Hi Setu / Pine Labs team,

I am building Vognary, an evidence-first recurring-payment audit product for founders, freelancers, and households in India.

Vognary already supports manual, statement, receipt, and private-audit workflows. We are now checking the compliant partner path for Account Aggregator and UPI AutoPay evidence.

We are not collecting payments, storing card numbers, scraping bank passwords, or asking for cancellation powers on day one.

Specific question for Setu/Pine Labs:

Can your AA Gateway or UPI Autopay sandbox support user-consented recurring-payment evidence for a product like Vognary, or do we need to be an FIU directly before sandbox access?

The evidence fields we are trying to validate are merchant/biller, amount or amount cap, cadence, next debit or last debit, mandate status, and consent metadata.

If yes, could you share sandbox onboarding steps, API docs, compliance requirements, DPA/security requirements, and commercial path?

If useful, Vognary can become a paid API/customer use case for Setu/Pine Labs open-finance and UPI Autopay rails.

Product: https://www.vognary.com
Privacy: https://www.vognary.com/privacy
Security: https://www.vognary.com/security

Thanks,
Varun
```

Tracker note after submit:

```text
Submitted Pine Labs contact-sales request. Asked about AA Gateway/UPI Autopay sandbox and FIU requirement.
```

## 7. FinBox

Send email to:

```text
sales@finbox.in
```

Official pages:

```text
https://finbox.in/contact-us
https://finbox.in/products/account-aggregator
https://efproddoc.finbox.in/dev/
https://efproddoc.finbox.in/bank-connect/rest-api/
```

Email body:

```text
Hi FinBox team,

I am building Vognary, an evidence-first recurring-payment audit product for founders, freelancers, and households in India.

Vognary already supports manual, statement, receipt, and private-audit workflows. We are now checking whether FinBox BankConnect or your Account Aggregator stack can support recurring-payment evidence in sandbox.

We are not collecting payments, storing card numbers, scraping bank passwords, or asking for cancellation powers on day one.

Specific question for FinBox:

Can BankConnect or your Account Aggregator stack support sandbox testing where Vognary detects recurring financial commitments from consented account or statement evidence?

The fields we are trying to validate are merchant/biller, amount or amount cap, cadence, next debit or last debit, status, and consent metadata.

If yes, could you share sandbox onboarding steps, relevant API docs, compliance requirements, DPA/security requirements, and commercial path?

If useful, Vognary can become a paid API/customer use case for FinBox account-data and transaction-intelligence rails.

Product: https://www.vognary.com
Privacy: https://www.vognary.com/privacy
Security: https://www.vognary.com/security

Thanks,
Varun
```

Tracker note after send:

```text
Sent FinBox email to sales@finbox.in. Asked about BankConnect/AA recurring debit evidence.
```

## 8. Decentro

Send email to:

```text
hello@decentro.tech
```

Fallback/support:

```text
support@decentro.tech
pgsupport@decentro.tech
```

Official pages:

```text
https://decentro.tech/signup
https://docs.decentro.tech
https://decentro.tech/products/recurring-payments
https://decentro.tech/products/upi-payment-gateway
```

Email body:

```text
Hi Decentro team,

I am building Vognary, an evidence-first recurring-payment audit product for founders, freelancers, and households in India.

Vognary already supports manual, statement, receipt, and private-audit workflows. We are now checking whether Decentro can support account, UPI, or recurring-payment evidence in sandbox.

We are not collecting payments, storing card numbers, scraping bank passwords, or asking for cancellation powers on day one.

Specific question for Decentro:

Which Decentro APIs or partner routes can support user-consented bank/account evidence, UPI mandate evidence, or recurring-payment metadata for Vognary?

The fields we are trying to validate are merchant/biller, amount or amount cap, cadence, next debit or last debit, mandate/subscription status, and consent metadata.

If yes, could you share sandbox onboarding steps, relevant API docs, compliance requirements, DPA/security requirements, and commercial path?

If useful, Vognary can become a paid API/customer use case for Decentro banking, UPI, and recurring-payment rails.

Product: https://www.vognary.com
Privacy: https://www.vognary.com/privacy
Security: https://www.vognary.com/security

Thanks,
Varun
```

Tracker note after send:

```text
Sent Decentro email to hello@decentro.tech. Asked for account/UPI/recurring metadata route.
```

## 9. Perfios

Open:

```text
https://perfios.ai/contact-us/
```

Alternate sandbox signup:

```text
https://hub.perfios.ai/app/register
```

Reference links:

```text
https://perfios.ai/in/products/perfios-hub/
https://perfios.ai/in/products/perfios-dpi-stack/
```

Paste:

```text
Hi Perfios team,

I am building Vognary, an evidence-first recurring-payment audit product for founders, freelancers, and households in India.

Vognary already supports manual, statement, receipt, and private-audit workflows. We are now checking whether Perfios Hub or Perfios DPI Stack can support recurring-payment audit evidence from consented statement/account data.

We are not collecting payments, storing card numbers, scraping bank passwords, or asking for cancellation powers on day one.

Specific question for Perfios:

Can Perfios Hub or Perfios DPI Stack support a sandbox where Vognary detects recurring financial commitments from consented account statement data or AA/FIU/TSP flows?

The fields we are trying to validate are merchant/biller, amount, cadence, next debit or last debit, status, and consent metadata.

If yes, could you share sandbox onboarding steps, relevant API docs, compliance requirements, DPA/security requirements, and commercial path?

If useful, Vognary can become a paid API/customer use case for Perfios account-data and DPI rails.

Product: https://www.vognary.com
Privacy: https://www.vognary.com/privacy
Security: https://www.vognary.com/security

Thanks,
Varun
```

Tracker note after submit:

```text
Submitted Perfios contact form. Asked about Hub/DPI Stack recurring-payment evidence.
```

## 10. Digio

Send email to:

```text
support@digio.in
```

Phone if needed:

```text
080-69489510
```

Official pages:

```text
https://www.digio.in/
https://documentation.digio.in/
https://documentation.digio.in/fiu-tsp/environment/
https://www.digio.in/digi-collect/
https://www.digio.link/
```

Email body:

```text
Hi Digio team,

I am building Vognary, an evidence-first recurring-payment audit product for founders, freelancers, and households in India.

Vognary already supports manual, statement, receipt, and private-audit workflows. We are now checking whether Digio FIU-TSP, DigioLink, or DigiCollect can support recurring-payment evidence in sandbox.

We are not collecting payments, storing card numbers, scraping bank passwords, or asking for cancellation powers on day one.

Specific question for Digio:

Can Digio FIU-TSP, DigiCollect, or DigioLink support sandbox access for recurring-payment evidence such as UPI mandates, NACH/e-mandates, card/mandate status, or consented AA account data?

The fields we are trying to validate are merchant/biller, amount or amount cap, cadence, next debit or last debit, status, and consent metadata.

If yes, could you share sandbox onboarding steps, API docs, compliance requirements, DPA/security requirements, and commercial path?

If useful, Vognary can become a paid API/customer use case for Digio consent, FIU-TSP, and mandate rails.

Product: https://www.vognary.com
Privacy: https://www.vognary.com/privacy
Security: https://www.vognary.com/security

Thanks,
Varun
```

Tracker note after send:

```text
Sent Digio email to support@digio.in. Asked about FIU-TSP/DigiCollect/DigioLink sandbox route.
```

## 11. Sahamati

Open:

```text
https://sahamati.org.in/contact/
```

Reference links:

```text
https://sahamati.org.in/tsp/
https://sahamati.org.in/tsp/fip-fiu-tsp/
https://sahamati.org.in/sahamati-ecosystem-map/
```

Paste:

```text
Hi Sahamati team,

I am building Vognary, an evidence-first recurring-payment audit product for founders, freelancers, and households in India.

Vognary already supports manual, statement, receipt, and private-audit workflows. We are now trying to identify the right Account Aggregator / FIU / TSP path for a compliant recurring-payment audit use case.

We are not collecting payments, storing card numbers, scraping bank passwords, or asking for cancellation powers on day one.

Specific question for Sahamati:

Which TSP/FIU enablement partners should Vognary speak to for validating a consented recurring-payment audit use case from Account Aggregator data?

The fields we are trying to validate are merchant/biller, amount, cadence, next debit or last debit, status, and consent metadata from consented account data.

Could you route me to the correct TSP/FIU enablement contacts or ecosystem onboarding path?

Product: https://www.vognary.com
Privacy: https://www.vognary.com/privacy
Security: https://www.vognary.com/security

Thanks,
Varun
```

Tracker note after submit:

```text
Submitted Sahamati contact form. Asked for TSP/FIU enablement routing for recurring-payment audit use case.
```

## Follow-Up After 3 Days

Subject:

```text
Follow-up: recurring-payment evidence sandbox question
```

Body:

```text
Hi,

Quick follow-up on this.

The narrow question is whether your sandbox can expose recurring-payment evidence, not whether you can support a broad partnership immediately.

If there is a better product/API partnerships contact for AA, UPI AutoPay, subscriptions, or card e-mandates, could you point me there?

Thanks,
Varun
```

## Follow-Up After 7 Days

Subject:

```text
Closing loop: recurring-payment evidence sandbox question
```

Body:

```text
Hi,

Closing the loop on this.

Even a no is useful. We are mapping which rails are actually available for compliant recurring-payment evidence and which ones must stay manual/fallback for now.

Can your team support sandbox access for this use case, or should we treat this rail as unavailable for now?

Thanks,
Varun
```

## Execution Order

Do not overthink. Send in this order:

```text
1. Razorpay
2. Cashfree
3. PayU
4. Juspay
5. PhonePe
6. Setu / Pine Labs
7. FinBox
8. Decentro
9. Perfios
10. Digio
11. Sahamati
```