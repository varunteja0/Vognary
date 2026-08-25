# Phase A — Paid Commitment Control pilots (30 days)

> **Operating motto: Take smart risks. Do not play safe.** Pursue asymmetric,
> falsifiable upside and bound irreversible downside. Every market bet needs a
> deadline and kill metric. Full doctrine: [`THE-LAW.md`](../THE-LAW.md).

> **Parent law:** [`docs/THE-LAW.md`](../THE-LAW.md)
> **Goal:** Prove companies will put Vognary before a real obligation and pay ₹40,000/month for a human-approved control workflow.
> **Owner:** Founder owns targeting, conversations, offers, contracts, and payment evidence. Agents support CRM structure, proposal intake, and evidence-safe artifacts.
> **Day 10 gate:** 20 qualified targets contacted, 10 conversations, five explicit offers, and two upfront payments.
> **Day 30 gate:** three paid pilots, 30 pre-spend proposals, three materially changed/capped/declined decisions, at least 80% pre-spend arrival, and two paid renewals.

---

## 0. Success / stop criteria

### Day 10 success

- 20 companies match the ICP using public evidence only.
- 10 founder-confirmed conversations happen.
- Five explicit ₹40,000/month offers are made.
- Two pilots pay upfront. Written intent, invoice sent, and payment received remain separate fields.

### Day 30 success

- Three paid pilots are active.
- 30 proposals are evaluated; at least 80% arrive before spend.
- At least three decisions are materially changed, capped, or declined.
- Two pilots renew at the paid price.
- Zero unauthorized decisions, invented money, cross-workspace evidence links, or autonomous actions.

### Kill / rework

- Fewer than two of ten offers pay.
- Fewer than half of proposal requests arrive before spending.
- 30 proposals change zero decisions.
- Buyers require Vognary to move money, issue cards, or auto-approve before they will pay.
- Any proposal, policy result, or reconciliation is presented as evidence when it is only an assumption.

### Measurable funnel

```text
20 qualified targets
  → 10 conversations
  → 5 explicit ₹40,000/month offers
  → 2 upfront payments by Day 10
```

Current Commitment Control counts: targets **0**, conversations **0**, offers **0**, payments **0**. Historical Autopilot conversations do not count toward the new thesis.

---

## 1. CRM schema (canonical)

**Working file (gitignored; may contain PII):** `docs/execution/private-commitment-control-pilot-crm.csv`. Do not commit names, emails, private proposals, contracts, or payment records.
**Committed field contract:** [`private-commitment-control-pilot-crm.csv.example`](private-commitment-control-pilot-crm.csv.example).

Agents never infer `qualified`, `offered`, `paid`, `renewed`, or `decision_changed`. The founder records those transitions from direct evidence.

### Required columns

| Column | Type | Values / notes |
| --- | --- | --- |
| `id` | string | `P01`, `P02`, … stable |
| `company_name` | string | Private working identity; never commit the populated row |
| `company_public_url` | URL | Canonical company source |
| `india_entity_evidence_url` | URL | Public evidence of an India-registered operating entity |
| `headcount_evidence_url` | URL | Public evidence supporting 20–100 people; record uncertainty |
| `funding_evidence_url` | URL | Public funding announcement or database source |
| `funding_date` | date | Must be within the last 24 months for the first beachhead |
| `ai_native_evidence_url` | URL | Public evidence that AI is core to product or operations |
| `finance_owner_role` | string | Finance lead, fractional CFO, or ops-owning cofounder; `UNKNOWN` is not qualified |
| `finance_owner_public_url` | URL | Public source for the role, not assumed identity |
| `qualified_at` | datetime | Public beachhead criteria verified; spend is still unmeasured until a conversation |
| `contacted_at` | datetime | A message was actually sent; drafts stay blank |
| `conversation_at` | datetime | A real call or substantive reply, not a sent message |
| `last_real_commitment_at` | datetime | Last specific obligation discussed; blank until the buyer names it |
| `last_real_commitment_amount_minor` | integer string | Exact amount only when the buyer states or cites it |
| `last_real_commitment_currency` | char(3) | Currency paired with the amount |
| `pain_class` | enum | `PRE_SPEND` \| `POST_SPEND` \| `BOTH` \| `NONE` \| `UNMEASURED` |
| `spend_threshold_confirmed_at` | datetime | Buyer confirmed ≥₹8 lakh/month controllable exposure; public proxies do not count |
| `monthly_controllable_spend_minor` | integer string | Buyer-stated/cited amount only |
| `monthly_controllable_spend_currency` | char(3) | Usually INR; never convert FX |
| `working_session_at` | datetime | One real upcoming commitment was brought to the desk |
| `offer_at` | datetime | Explicit ₹40,000/month offer made |
| `invoice_sent_at` | datetime | Invoice delivery; does not count as payment |
| `payment_received_at` | datetime | Cleared upfront payment; the paid gate |
| `payment_amount_inr` | integer | Cleared gross INR amount |
| `proposal_count` | integer | Proposals actually evaluated |
| `pre_spend_proposal_count` | integer | Proposals received before an obligation existed |
| `obligation_created_at` | datetime | Buyer-confirmed creation time for the latest proposal; needed to classify pre-spend honestly |
| `pre_spend_status` | enum | `YES` \| `NO` \| `UNKNOWN`; first-charge date is not a substitute |
| `changed_decision_count` | integer | Capped, declined, or materially changed after evaluation |
| `renewal_offered_at` | datetime | Renewal explicitly offered |
| `renewal_paid_at` | datetime | Cleared renewal payment |
| `status` | enum | Exact state below |
| `loss_reason` | enum | `NO_PAIN` \| `POST_SPEND_ONLY` \| `PRICE` \| `NEEDS_ENFORCEMENT` \| `NO_HABIT` \| `OTHER` \| blank |
| `notes` | text | Redacted behavioral learning only; no private proposal contents |

### Status machine (use exactly)

```
  sourced
  → qualified
  → contacted
  → conversation
  → offered
  → invoice-sent
  → paid-pilot
  → active-pilot
  → renewed | closed-lost | refunded
```

### Minimum weekly CRM hygiene

- Same day: conversation, offer, invoice, and cleared payment timestamps.
- Record proposal counts from product evidence; never reconstruct them from memory.
- Friday: export aggregate counts to the scoreboard; never commit the private CRM.

---

## 2. ICP (who to contact first)

**First beachhead:** India-registered, 20–100-person AI-native companies that raised seed through Series B in the last 24 months and have a named finance owner: finance lead, fractional CFO, or ops-owning cofounder. Public sources must support entity, size, funding recency, AI relevance, and finance ownership before `qualified_at` is set.

**Conversation gate:** the buyer confirms at least ₹8 lakh/month of controllable AI, cloud, software, contractor, or campaign exposure and can bring one real upcoming commitment before spend. Until then, spend remains `UNMEASURED`; never infer it from funding or headcount.

**Deprioritize:** solo/duo builders, agencies whose total annual stack is below the pilot fee, companies under 20 or over 100 people, teams without a named finance owner, enterprise procurement transformations, teams seeking spend cards or payments, companies unable to provide a pre-spend proposal, and anyone requiring autonomous approval or purchasing.

---

## 3. Offer and delivery contract

Position this as a **founder-delivered control desk**, not naked SaaS. The paid pilot includes a policy workshop, up to 50 commitment evaluations, a 13-week obligation register, weekly reconciliation, and a one-business-day response SLA. It records decisions; it does not purchase, provision, cancel, or move money. Compare the job with adding fractional finance/procurement capacity; do not quote third-party market prices without a source in the private notes.

### First-touch frame

```text
Hi {Name} — I’m running a founder-delivered Commitment Control pilot for recently funded AI-native teams with a named finance owner.

Before the next AI, cloud, software, contractor, or campaign obligation is created, the desk shows cited existing exposure, checks your stated policy, and records a named human decision and frozen cap. Later bills are reconciled against that approval.

The pilot is ₹40,000/month, paid upfront, including setup and weekly reconciliation. Vognary never auto-approves or moves money. Do you have one real upcoming commitment we could put through a 20-minute working session this week?
```

Do not discount, add a menu, or offer free implementation before the offer-ten gate. Record price-specific rejection separately from rejection of the underlying job.

## 4. Live behavioral discovery (before a demo)

Ask about the last real financial obligation; do not explain Vognary until question 6.

| Min | Ask | Evidence sought |
| ---: | --- | --- |
| 0–3 | “Walk me through the last real commitment your company made for AI, cloud, software, a contractor, or a campaign.” | A dated, specific obligation — not general frustration |
| 3–6 | “When was the company committed: before the invoice, when someone said yes, or only when the card/bill arrived?” | `PRE_SPEND`, `POST_SPEND`, `BOTH`, or `NONE` |
| 6–9 | “Who could have capped or declined it, and what information did they have at that moment?” | Named authority and missing context |
| 9–12 | “Show me how that approval happened — message, call, sheet, accounting tool, or nothing.” | Actual incumbent behavior, not feature preference |
| 12–15 | “What did the obligation cost, over what period, and what would have changed the decision?” | Exact amount/currency and counterfactual decision |
| 15–17 | “What happens if someone ignores an approved cap today?” | Whether advisory accountability is valuable or physical enforcement is mandatory |
| 17–20 | Only if the pain is pre-spend: explain the control desk in one sentence and ask them to bring the next real commitment. | Working-session behavior, not praise |

Classify the conversation the same day. If most buyers describe only post-hoc bill surprise, that supports Recovery, not Commitment Control. If they require cards or money movement to pay, record `NEEDS_ENFORCEMENT`; do not build rails.

## 5. Ten-day execution cadence

| Day | Founder action | Evidence |
| ---: | --- | --- |
| 1–2 | Source and qualify 20 beachhead companies from public evidence; create no assumed spend facts | 20 CRM rows with source URLs |
| 3–4 | Send 20 first touches in two batches | `contacted_at`, never drafts |
| 5–8 | Run 10 behavioral conversations; book working sessions only for pre-spend pain | `conversation_at`, pain class, exact notes |
| 6–9 | Make five explicit ₹40,000/month offers; invoice same day on yes | `offer_at`, `invoice_sent_at` |
| 8–10 | Run paid working sessions with a real upcoming commitment | product rows plus CRM timing fields |
| 10 | Apply the two-payment gate with cleared funds only | GO / REWORK / KILL worksheet in CONTINUE-HERE |

Agents may prepare sources, copy, redaction, and aggregate reports. Only the founder sends messages, confirms identities, records private notes, invoices, and marks payment.

### Session proof

1. Capture one real proposed obligation as user-entered assumptions.
2. Show currency-separated 13-week and annual exposure plus cited existing exposure.
3. Apply the workspace policy deterministically.
4. Have an owner/admin approve, cap, or decline.
5. Freeze the decision and later reconcile cited Recovery evidence without rewriting it.
6. Ask for the upfront pilot payment; record received money separately from intent.

## Historical Autopilot material — superseded 2026-08-25

Everything below this marker is retained only for audit history. It is not a live offer, interview, workflow, or implementation instruction.

### 3. Historical outreach scripts

**DO NOT SEND. Historical Autopilot-era copy. See the freeze override at the top of this file.**

These replace the free paste-audit scripts. Do not offer a free PDF audit as the product.

### 3.1 LinkedIn / cold DM (first touch)

```text
Hi {Name} — quick one.

Vognary is a private autopilot for recurring money: connect once, sign a standing mandate, and we cancel supported discretionary subscriptions under your rules after a 48-hour veto.

We do not auto-touch EMI, SIP, insurance, utilities, or cloud infrastructure. No bank passwords, OTPs, or CVV.

Private-pilot offer this week: connect a real source, sign the mandate, and we run in shadow then supported execution only. Monitoring is ₹999/month, credited against 15% of verified savings, capped at 33% of verified savings in year one.

If you want in, reply “pilot” and I’ll send the intake.

— {Your name}, Vognary
```

### 3.2 Follow-up (day 3, if no reply)

```text
Looping once — still holding 2 private-pilot slots this week.
Connect + signed mandate is the whole ask. Silence after the 48-hour notice authorizes only what you already signed.
```

### 3.3 Follow-up (day 7)

```text
Closing this pilot batch Friday. Reply “pilot” if you want the standing-mandate path; otherwise I’ll close the thread.
```

### 3.4 After they agree

```text
Perfect. Three things, in order:

1) Connect a real evidence source (paste/CSV now; forwarded email if the inbox is attested; Gmail OAuth only after Google verification).
2) Read and sign the standing mandate (per-action ceiling + rolling 30-day ceiling + 48-hour veto).
3) We contact you only for vetoes and genuine exceptions.

I never need passwords, OTPs, or CVV.
```

### 3.5 LinkedIn public post (air cover)

```text
Running a private autopilot pilot: connect once, sign once, 48-hour veto, then Vognary cancels only supported discretionary junk.

Not a spreadsheet. Not a free paste audit. EMI / SIP / insurance stay blocked.

₹999/month monitoring, credited against 15% of verified savings, first-year cap 33%.
```

### 3.6 WhatsApp short

```text
Private autopilot pilot: connect + signed mandate. 48h veto. Discretionary only. No passwords.
Reply “pilot” if you want in.
```

### 3.7 After a real offer → pay ask (actual payment)

```text
Here’s what the mandate covered this cycle.

Connected: {source} · Eligible candidates: {n} · Notices delivered: {n} · Executions: {n} · Clean windows: {n} · Verified saving: ₹{verified} (only if coverage exists).

Monitoring is ₹999/month. Outcome fee is 15% of verified savings, with monitoring credited, first-year retained charge capped at 33% of verified savings. Zero verified savings means zero retained first-year charge.

If you want to continue, pay the monitoring invoice. Written “I’ll pay” is recorded separately and does not count as paid.
```

---

### 4. Historical pilot delivery standard

Do **not** use the old free-audit report as the product. The product is the autopilot loop.

### Delivery checklist (agent or founder)

1. Connected account with a proven Recovery source
2. Standing mandate accepted (hash, actor, terms version, ceilings, 48h notice)
3. Candidates classified with citations; protected classes fail closed
4. 48-hour notice delivered before any clock starts
5. Silence / veto / exception recorded
6. Supported execution only on the allowlist; password/OTP/login/UPI-app/bank paths become exceptions
7. Post-mandate customer work minutes logged (target: 0)
8. Verification coverage named honestly (`covered` / `pending` / `missing`)
9. Clean window and verified saving only with covered financial proof
10. Actual payment vs written intent recorded in separate CRM columns

### Time budget

- Operator median: **< 15 minutes** per handled case
- Customer after mandate: **0 minutes** except vetoes and genuine exceptions

---

### 5. Historical corpus consent

**Never commit real statements to git.**  
Store offline under local path (founder machine / encrypted drive).  
Repo only holds: `corpus/manifest.example.yaml` + redacted fixtures when consented and scrubbed.

### Consent script

```text
Optional: can we keep a fully redacted version of this statement/receipt for parser tests?
We strip account numbers, names, phone, full card numbers, addresses.
Only merchant patterns, amounts, and dates remain.
You can say no — the pilot still stands.
```

### Redaction minimum

- Account numbers → last 4 only or `XXXX`
- Names / phones / emails → remove
- Addresses → remove
- Full UPI IDs → mask

When 25+ fixtures exist: run `npm run corpus` and track precision/recall toward THE-LAW targets.

---

### 6. Historical 21-day calendar

| Day | Founder | Agent support |
| ---: | --- | --- |
| 1 | Create/update autopilot CRM; start Google CASA / counsel review | WP-A Recovery evidence spine |
| 2 | Message 10 ICP leads with the mandate pitch | Fix connect / mandate blockers only |
| 3 | Message 10 more; no free-audit offer | Shadow evaluator prep (WP-B, after WP-A merges) |
| 4–7 | Get 3 connected + mandate | Notice / exception honesty |
| 8–14 | 10 connected + mandate; first eligible candidates | Do not execute until shadow + legal gates |
| 15–18 | Convert written intent → **actual payment** | Billing remains fail-closed until Razorpay/legal READY |
| 19–20 | Covered-window review for anyone executed | Verification pending if coverage is missing |
| 21 | **STOP/GO** with metrics only | Write measured scoreboard into THE-LAW §5 if founder asks |

---

### 7. Historical agent rules for Phase A

| Allowed | Forbidden |
| --- | --- |
| Draft outreach in founder voice | Spamming contacts without founder approval |
| Fill CRM from proven product events | Inventing payments, savings, or READY rails |
| Build redaction helpers / export UX | Putting PII in git, issues, or logs |
| Fix blockers that stop a pilot mid-flight | Reviving free paste-audit volume as the wedge |
| Track the columns in §1 | Counting written pay intent as paid |
| | Auto-executing EMI, debt, SIP, insurance, utilities, cloud, or conflicted items |

---

### 8. Historical Day-21 stop/go worksheet

```text
Date:
Connected accounts with active mandates:
Eligible candidates:
Notices delivered:
Vetoes:
Exceptions:
Supported executions (no post-mandate customer work):
Verification coverage pending / covered / missing:
Clean windows:
Verified savings (currency + minor units):
Actual payments (count / amount):
Written pay intents (count; separate; not the paid gate):
Refunds:
Median operator minutes:
Safety incidents:
Decision: GO / STOP / REWORK OFFER
Evidence links (CRM rows):
```

Copy result into `docs/CONTINUE-HERE.md` under a short “Phase A result” note when decided. Empty cells mean unmeasured.

---

### 9. Historical behavioral interview

**DO NOT use the mandate / 48-hour-veto / ₹999 questions below as the live first-10 script.** Under the freeze, the live session is: paste 2–5 bills, see cited decisions, ask whether that beat memory. Keep every CRM outcome column blank until the matching event exists.

Use after a sourced target replies “pilot” or agrees to a call. This is **not** a sales demo and does **not** mark the CRM row qualified. Keep every outcome column blank until the matching event exists.

**Clock (15:00)**

| Min | Ask | Why |
| ---: | --- | --- |
| 0–2 | How do you currently know what will debit next week? | Beachhead: founder/tiny-team recurring-money ops, not a budget-app user |
| 2–5 | Tell me about the last time a recurring charge surprised you. What evidence did you have? | First aha is a **cited unexpected commitment**, not a dashboard |
| 5–8 | If something cancelled a discretionary tool under a rule you signed, with 48 hours to veto, what would you need to trust it? | Class-safe private Autopilot wedge; EMI/SIP/insurance/utilities/cloud stay blocked |
| 8–11 | Walk through the last time you tried to cancel something. Login, OTP, phone, or a support email? | Zero post-mandate customer work; login/OTP paths are exceptions, not supported execution |
| 11–13 | Would you connect a real mailbox/statement and sign a standing mandate this week, or only look at a public audit? | Public audit claims stay unchanged; the offer is connect + mandate, not a free PDF |
| 13–15 | What would make you pay ₹999 monitoring credited against 15% of verified savings — and what would make you walk? | Actual payment vs written intent stay separate |

**Hard stops during the call**

- Do not invent amounts, merchants, or connector liveness
- Do not offer a free paste-audit PDF as the product
- Do not promise Gmail OAuth, Razorpay charges, or a proven provider route
- Do not call the person a qualified prospect; they remain a sourced target until CRM events exist

**After the call (same day)**

- Append a redacted note to the gitignored CRM `notes` cell
- Leave `connected_account_at` / `mandate_accepted_at` / `actual_payment_at` blank unless those events happened
- Status stays `not-contacted` until founder records a real transition

---

### 10. Historical Autopilot onboarding checklist

Run only after the human agrees to the standing-mandate path. Same loop for every pilot. Empty cells mean unmeasured.

```text
Pilot id:
Date:
Operator:

[ ] Identity matches the sourced public URL used for outreach (no assumed spend)
[ ] Privacy pitch given; no bank passwords, OTPs, or CVV requested
[ ] Real evidence source connected (paste/CSV now; forwarding if inbox attested)
[ ] Standing mandate signed (terms version, ceilings, 48h veto) — record mandate_accepted_at
[ ] Candidates classified with citations; protected classes fail closed
[ ] 48-hour veto notice queued; clock starts only on DELIVERED + valid token coverage
[ ] Silence / veto / exception recorded honestly
[ ] Supported execution only on a founder-proven zero-chore route; otherwise EXCEPTION
[ ] Post-mandate customer work minutes logged (target 0)
[ ] Verification coverage named: covered / pending / missing
[ ] Clean window + verified saving only with covered financial proof
[ ] Pay ask uses actual_payment_at; written intent in a separate column
[ ] Corpus consent asked; redaction minimum applied if yes
```

Do not tick boxes in git. Copy a filled sheet into the gitignored CRM notes after the session.
