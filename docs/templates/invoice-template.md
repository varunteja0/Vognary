# Manual Invoice — usage notes + email version

Companion to [`invoice-template.html`](./invoice-template.html) (open in a browser →
fill placeholders → Print → Save as PDF). Sanctioned by the revenue sprint
(`docs/REVENUE_SPRINT_2026-07-16.md` §1): SKU A/B are founder-billed services paid by
UPI + manual invoice from day 1. The retired one-time ₹999 product checkout must
stay off; never wire manual payment links into the product UI. Historical
settlement handling lives in `docs/billing-activation-runbook.md`.

## Before the first invoice (one-time)

- Fill your permanent details in the HTML once and save a personal copy **outside the
  repo** (it will contain your PAN/UPI — don't commit it).
- Numbering: `VOG-2026-001`, increment per invoice, never reuse or backfill. Log every
  issued number + status in the pipeline tracker's Notes column (the tracker is the truth).
- GST: not required below ₹20L services turnover — the invoice already carries the
  "not registered" wording. Confirm once with a CA; not a blocker.
- TDS: startup clients may deduct 10% under §194J. That's normal — the invoice tells
  them how; you reconcile via Form 26AS at tax time. ₹4,999 net of TDS = ₹4,499.10.

## Per-invoice checklist

1. Duplicate your personal HTML copy → update number, date, client block, engagement date.
2. SKU B (success fee): change the line item to
   "Burn Cut — success fee: 15% of verified first-year savings of ₹[X] (verification
   evidence: Verified Savings report dated [date])" and the amount accordingly;
   guarantee clause does not apply — delete term 1.
3. Do not invoice the retired one-time assisted-audit SKU.
4. Print → Save as PDF → filename `VOG-2026-001.pdf`.
5. Send with the email below; mark Paid in the tracker when UPI settles.

## Email that carries the invoice

> Subject: Invoice VOG-2026-001 — Founder Spend Audit
>
> Hi [Name],
>
> Attached is the invoice for your spend audit (₹4,999, due on receipt).
> Fastest way to pay: UPI to **[yourid@upi]** with **VOG-2026-001** in the remark.
>
> Reminder of the guarantee: if the audit doesn't surface at least ₹50,000/year of
> cuttable spend — with evidence attached to every line — the fee comes straight back.
>
> Your audit slot is confirmed for [date]. I'll need the intake items from
> [the intake link] before then.
>
> [Your name]

## What never goes on an invoice

- No claims beyond the guarantee wording above (`scripts/check-public-claims.mjs`
  discipline applies to anything a client sees).
- No monitoring/retainer line items until Spend Guard is sold at a day-30 call and
  scoped in writing.
- No GST line while unregistered — charging GST without a GSTIN is illegal, not just wrong.
