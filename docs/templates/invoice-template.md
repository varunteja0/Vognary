# Manual Invoice — usage notes + email version

Companion to [`invoice-template.html`](./invoice-template.html) (open in a browser →
fill placeholders → Print → Save as PDF). The live commercial pack is **₹40,000/month
Commitment Control private pilot**. The retired one-time ₹999 / ₹4,999 audit checkout
must stay off; `/api/checkout` remains `410`. Never wire payment links into the product
UI. Historical settlement handling lives in `docs/billing-activation-runbook.md`.

## Before the first invoice (one-time)

- Fill your permanent details in the HTML once and save a personal copy **outside the
  repo** (it will contain your PAN/UPI — don't commit it).
- Numbering: `VOG-2026-001`, increment per invoice, never reuse or backfill. Log every
  issued number + status in the pipeline tracker's Notes column (the tracker is the truth).
- GSTIN: placeholder on the template. Charge GST only after a real GSTIN is written on
  the founder-local copy. Never commit PAN, UPI, or GSTIN.
- TDS: startup clients may deduct 10% under §194J. That's normal — the invoice tells
  them how; you reconcile via Form 26AS at tax time. ₹40,000 net of 10% TDS = ₹36,000.

## Per-invoice checklist

1. Duplicate your personal HTML copy → update number, date, client block, pilot month.
2. Line item stays **Commitment Control private pilot (monthly)** at ₹40,000. Do not
   revive the retired spend-audit SKU or invent a success-fee line unless a later
   paid contract says so in writing.
3. Do not invoice the retired one-time assisted-audit SKU.
4. Print → Save as PDF → filename `VOG-2026-001.pdf`.
5. Send with the email below; mark Paid in the tracker when UPI settles.
6. Issue this pack only when someone actually pays. Checkout stays 410.

## Email that carries the invoice

> Subject: Invoice VOG-2026-001 — Commitment Control pilot
>
> Hi [Name],
>
> Attached is the invoice for one month of the Commitment Control private pilot
> (₹40,000, due on receipt). Fastest way to pay: UPI to **[yourid@upi]** with
> **VOG-2026-001** in the remark.
>
> The desk is proposal → policy → named human authorization → frozen cap →
> cited Recovery evidence → reconciliation. Vognary never purchases, provisions,
> cancels, or moves money.
>
> [Your name]

## What never goes on an invoice

- No claims beyond the Control loop (`scripts/check-public-claims.mjs` discipline
  applies to anything a client sees).
- No Slack, Gmail OAuth, bank-connector, or in-app Razorpay line items.
- No GST line without a GSTIN on the founder-local copy.
- No PAN/UPI in git — those stay on the personal copy only.
