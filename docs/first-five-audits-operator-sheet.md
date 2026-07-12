# First Five Private Audits — Operator Sheet

Date prepared: 2026-07-12. One page to execute five paid-audit conversations end to end.
The founder performs every external send. Nothing here auto-sends.

## Route mechanics — revalidated 2026-07-12

- **1:1 direct messages (WhatsApp / LinkedIn DM / email to people you already know) are the primary route.**
  They are unaffected by feed-ranking changes and match the trust-heavy ask (sharing redacted financial evidence).
- **Do not use comment-gating on LinkedIn** ("comment 'audit' and I'll DM you"). Multiple 2026 analyses of
  LinkedIn's March 2026 authenticity update report NLP-level detection and reach suppression of exactly this
  pattern ([digitalapplied](https://www.digitalapplied.com/blog/linkedin-algorithm-2026-engagement-strategy-guide),
  [expertlinked](https://expertlinked.in/posts/2026-02-10-linkedin-authenticity-algorithm-shift/),
  [synergist](https://synergist-digital-media.ghost.io/linkedins-2026-algorithm-the-engagement-bait-era-is-finally-over/)).
  The outreach kit's LinkedIn post must drop its "Comment \"audit\" or DM me" line; put the tracked link directly
  in the post or first comment and accept lower reach — the post is air cover, not the pipeline.
- **Reddit: 90/10 rule, at most one promotional post per week, disclose affiliation, never cross-post the same
  text** ([redship 2026 guide](https://redship.io/blog/reddit-self-promotion-rules),
  [getupvotes](https://getupvotes.com/reddit-self-promotion/)). Re-read the target subreddit's own rules the same
  day you post; Indian startup subreddits change promo rules frequently. Reddit is optional for the first five —
  use it only if your direct network stalls.

## Tracked links (live in production)

`/private-audit?src=<tag>` now persists the tag server-side: the lead row's `source` column becomes
`vognary-private-audit-intake:<tag>`. Use one tag per target:

| Target slot | Tracked link |
| --- | --- |
| A1 | `https://www.vognary.com/private-audit?src=a1-dm` |
| A2 | `https://www.vognary.com/private-audit?src=a2-dm` |
| A3 | `https://www.vognary.com/private-audit?src=a3-dm` |
| A4 | `https://www.vognary.com/private-audit?src=a4-partner` |
| A5 | `https://www.vognary.com/private-audit?src=a5-dm` |
| LinkedIn post (air cover) | `https://www.vognary.com/private-audit?src=li-post` |

Attribution query (operator, read-only):

```sql
select source, name, email, score, created_at
from private_audit_leads
order by created_at desc;
```

## The five target slots

Fill each slot with a real person from your own network. Do not buy lists; do not message strangers in bulk.
Qualification (from the outreach kit): founder/agency/AI builder persona, pays for AI + SaaS/cloud tools,
10+ recurring payments or UPI/card mandates, will share at least one redacted source, can pay ₹999 after value.

| Slot | Archetype to pick from your network | Route to verify before sending |
| --- | --- | --- |
| A1 | AI builder paying OpenAI/Anthropic/Cursor + Vercel/Render | WhatsApp or LinkedIn 1st-degree DM |
| A2 | Founder with a small team, no finance ops | WhatsApp or LinkedIn 1st-degree DM |
| A3 | Freelancer/agency owner with client-billed SaaS stack | WhatsApp/Telegram/email — whichever they actually answer |
| A4 | CA / finance operator who serves founders (referral partner) | Email or LinkedIn DM; ask for one client referral |
| A5 | Household power user: UPI AutoPay, SIPs, EMIs, insurance | WhatsApp |

Route verification = you have exchanged messages on that channel in the last 6 months, or a mutual intro exists.
If neither, pick someone else; cold routes are not worth it for the first five.

## Messages (personalize the [bracket] before sending)

**A1–A3, A5 (direct ask):**

> Hey [Name] — quick one. Do you actually know what your recurring burn is right now across
> [their stack: e.g. OpenAI, Vercel, AWS, domains, UPI mandates]?
>
> I'm running 5 private audits this week on Vognary. You paste redacted statements or receipts,
> it builds an evidence-backed ledger: monthly burn, what renews next, what's avoidable, and which
> source is missing. No passwords, OTPs, CVV, or bank credentials — redact everything sensitive.
>
> Start here (no login needed): [tracked link]
> If the audit finds nothing useful, don't pay. If it's useful, it's ₹999.

**A4 (partner referral):**

> Hi [Name] — I'm building Vognary, an evidence-first recurring-spend audit for founders.
> It surfaces forgotten renewals, duplicate tools, upcoming debits, and missing invoices before
> monthly review. I'm running 5 private audits this week. Would you refer one client with messy
> recurring spend? First report is free for you to judge quality: [tracked link]

**48-hour follow-up (all):**

> Quick follow-up — even a manual list of your SaaS/AI/cloud renewals is enough for a source-coverage
> score. Takes ~3 minutes, no login: [tracked link]

## Expected responses and next steps

| Response | Next step |
| --- | --- |
| "What do you need from me?" | "One redacted card statement CSV, SaaS invoice set, or receipt emails — whichever is easiest. The page shows a paste box." |
| Submits intake, shares nothing | Reply with the safest minimum source for their persona (from `/sources`); one nudge, then park. |
| Shares evidence | Run the audit same day (checklist below). Deliver within 24h. |
| "Is my data safe?" | Point at `/privacy` + `/security`; remind them to redact; never ask for credentials. |
| Silence after follow-up | Park after one follow-up. Do not chase; note it in the ledger. |

## Audit delivery checklist (per audit)

1. Open `https://www.vognary.com/app?guest=1` (or your signed-in workspace for persistence).
2. Import their evidence: CSV/statement upload, receipt paste, or guided capture. Redact-first.
3. Verify the ledger: every item has amount, cadence, next debit, source, confidence. Fix merges.
4. Confirm the overview: monthly burn, renews-next, "Do this first" action, proof strength, missing sources.
5. Export: sealed pack (JSON) + PDF. Verify the pack at `/verify` before sending.
6. Deliver by reply on the same channel: 3-line summary (burn, top avoidable item, next debit) + attachments + one recommended action.
7. Record outcomes in the ledger below immediately.

## Payment ask

- After delivery, if they found it useful: "It's ₹999 for this audit — link below."
- **Tracked checkout state (honest):** the code path is live but Razorpay production keys are not yet
  configured, so the intake page's pay button correctly reports payment as not activated. Until the founder
  completes `docs/billing-activation-runbook.md`, create a manual Razorpay Payment Link for ₹999 in the
  dashboard and reconcile by hand. Never claim automatic settlement before the runbook's test-mode proof passes.
- One-time audit ≠ monitoring. Pitch monthly monitoring only after they ask "can this stay updated?" — record
  that ask in the ledger; it is the retention signal Phase 5 measures.

## Outcome ledger (fill as you go)

| Slot | Name | Route | Sent (date) | Replied | Intake row (source tag seen) | Evidence shared | Audit delivered | Avoidable item found | Would pay | Paid ₹ | Asked for monitoring |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 |  |  |  |  |  |  |  |  |  |  |  |
| A2 |  |  |  |  |  |  |  |  |  |  |  |
| A3 |  |  |  |  |  |  |  |  |  |  |  |
| A4 |  |  |  |  |  |  |  |  |  |  |  |
| A5 |  |  |  |  |  |  |  |  |  |  |  |

## Stop conditions (from the validation playbook — honor them)

- If targets refuse to share even redacted evidence → fix the trust pitch/offer, not features.
- If five completed audits produce no meaningful surprise → reassess the wedge before more outreach.
- If audits are praised but nobody pays → fix packaging/pricing before building connectors.
- Never report an audit, payment, or saving that was not actually observed.
