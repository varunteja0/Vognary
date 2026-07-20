# Vognary Private Audit Outreach Kit

## Share Link

Use this as the campaign link after deployment:

```text
https://www.vognary.com/private-audit
```

Local test link:

```text
http://localhost:3000/private-audit
```

## Deployment Requirement

Set one of these environment variables in production so audit requests persist:

```text
AUDIT_INTAKE_WEBHOOK_URL=<your Zapier/Make/Tally/Google Sheet webhook>
WAITLIST_WEBHOOK_URL=<existing generic lead webhook>
```

If neither is configured, the page still prepares a request brief, but public leads will not be stored server-side.

## LinkedIn Post

```text
I am running 10 private recurring-burn audits this week for founders, freelancers, and AI builders.

The pattern I am investigating:

People know their salary, revenue, and runway.
But they often do not know what is quietly renewing every month across:
- SaaS tools
- AI tools
- cloud hosting
- domains
- app stores
- UPI AutoPay
- card mandates
- insurance
- EMIs
- SIPs
- receipt emails

Vognary turns this into an evidence-backed recurring burn report:
- monthly recurring spend
- annual run-rate
- upcoming debits
- avoidable/watch items
- missing source checklist
- proof for every recommendation

You can redact sensitive details. No passwords, OTPs, CVV, or bank credentials.

I am taking a small assisted-audit batch this week.
The current one-time assisted audit is INR 999 for one request; it does not auto-renew or include monitoring.
Online payment is offered only when tracked checkout is activated. You can request a full refund any time before evidence review begins; after review begins, eligibility follows the Terms.

Intake link (no login needed): https://www.vognary.com/private-audit?src=li-post
```

Note (2026-07-12): the earlier "Comment \"audit\" or DM me" close was removed. LinkedIn's 2026
authenticity update suppresses comment-gating engagement bait, so the link now goes directly in
the post (or first comment). 1:1 DMs from `docs/first-five-audits-operator-sheet.md` are the
primary route; this post is air cover.

Reply to comments:

```text
Sending it now. You can redact sensitive details before sharing anything.
```

DM after comment:

```text
Here is the intake link: https://www.vognary.com/private-audit

You do not need to upload anything immediately. First fill the form, then I will tell you the safest minimum source to share.
```

## Reddit / Community Post

Title:

```text
Do founders actually know their real monthly recurring burn?
```

Body:

```text
I am researching a problem I keep seeing with founders and AI builders:

People know payroll and runway, but recurring spend is scattered across SaaS tools, AI tools, cloud, domains, app stores, UPI AutoPay, card mandates, insurance, EMIs, SIPs, and receipt emails.

I am running 10 private recurring-burn audits this week.

The output:
- monthly recurring spend
- annual run-rate
- upcoming debits
- avoidable/watch items
- missing source checklist
- proof for every recommendation

I am not asking for passwords, OTPs, CVV, bank credentials, or identity documents. People can redact sensitive details.

Question for founders here:
How do you currently track what is renewing every month?
Spreadsheet, card statement, accounting tool, memory, or nothing?

If anyone wants to be part of the private audit batch, comment or DM. I will share the intake link.
```

Relevant comment:

```text
I am working on this exact problem: recurring burn across SaaS, AI tools, cloud, domains, app stores, UPI/card mandates, and invoices.

The hard part is not only tracking subscriptions. It is proving the source and showing what is missing.

I am running a small private audit batch this week. Happy to audit one redacted sample if useful.
```

## Cold Founder DM

```text
Hey [Name], quick founder question.

Do you currently track recurring burn across SaaS, AI tools, cloud, domains, app stores, UPI/card mandates, and invoices?

I am running 10 private Vognary audits this week. Output is monthly recurring burn, annual run-rate, upcoming debits, avoidable/watch items, and proof for every recommendation.

No passwords/OTP/CVV/bank credentials. Redacted sources are fine.

Worth sending you the intake link?
```

If they say yes:

```text
Here is the intake link: https://www.vognary.com/private-audit

Fill this first. After that I will tell you the minimum safe source to share. Usually one redacted card statement, SaaS invoice set, or UPI/card mandate screenshot is enough to start.
```

48-hour follow-up:

```text
Quick follow-up. Even a manual list of your SaaS/AI/cloud renewals is enough to get a source coverage score.

Useful if you want to know what is quietly renewing before the next debit.
```

## Partner Message

```text
Hi [Name], I am building Vognary, a recurring-money audit for founders and small teams.

It finds recurring spend across SaaS, AI tools, cloud, domains, app stores, UPI AutoPay, card mandates, insurance, EMIs, SIPs, and receipts, then creates an evidence-backed report.

I think this can help your clients before monthly bookkeeping/review because it surfaces:
- forgotten renewals
- duplicate tools
- upcoming debits
- missing invoices
- unmanaged SaaS/cloud costs
- source coverage gaps

I am running a small assisted-audit batch this week.

Would you be open to referring 1 client who has messy recurring spend?
For the beta, I can give you the first audit report free so you can judge quality.
```

If they reply:

```text
Perfect. Send them this intake link: https://www.vognary.com/private-audit

They can redact sensitive details. I do not need passwords, OTPs, CVV, netbanking credentials, or identity documents.
```

## Qualification Rule

Prioritize people with at least one:

```text
Founder/team
Pays for AI tools
Pays for cloud/SaaS
Has 10+ recurring payments
Has UPI/card mandates
Has insurance/EMIs/SIPs
Will share at least one real source
Can evaluate the one-time INR 999 assisted audit after seeing the source plan
```

Reject curiosity-only leads:

```text
I am prioritizing people with real recurring payments and at least one redacted source they can share. The self-audit is already available without login; assisted review slots are limited by operator capacity.
```