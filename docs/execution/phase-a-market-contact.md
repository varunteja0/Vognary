# Phase A — Private autopilot pilots (21 days)

> **Parent law:** [`docs/THE-LAW.md`](../THE-LAW.md)
> **Goal:** Prove humans will connect once, sign a standing mandate, and pay for zero-chore discretionary cancellation. Not more product features. Not free paste audits.
> **Owner:** Founder primary; agents support CRM hygiene, redaction helpers, and copy polish.
> **Exit:** Day-21 stop/go using THE-LAW scoreboard metrics.
> **Historical field memory (pre-autopilot paste-audit campaign):** [`people-conversation-learning.md`](people-conversation-learning.md) — read as history; do not rewrite those quotes as new pilot evidence.

> **FREEZE OVERRIDE (2026-08-18, independently restated 2026-08-22):** THE-LAW outranks this file on the product offer. Live V1 is Commitment Intelligence: add 2–5 software bills → cited Keep / Review later / Plan to cancel before the charge. Vognary does not cancel a service and does not move money. **Do not send §3, §3.5, §3.6, §4, §9 (mandate/cancel questions), or §10 as live copy.** Those sections are historical Autopilot-era scripts. Live first-10 copy is the top “SEND NOW” block in gitignored `docs/execution/private-autopilot-outreach-draft.md` only — not the “Historical — Private Autopilot” block later in that same file. Funnel counts in §0 remain the measurement skeleton; do not invent connected / mandate / paid.

---

## 0. Success / stop criteria

Actual payment and written pay intent are **separate metrics**. The paid 5/20 gate requires **actual payment**. Written pay intent is research signal only.

### Go (continue building loop + activation)

- ≥10 connected accounts with active standing mandates
- ≥5 produce an eligible discretionary candidate
- ≥3 supported actions complete with **no post-mandate customer work**
- ≥2 reach a covered clean financial window
- ≥5 **actual payments** of 20 real ₹999/month + verified-savings offers
- Zero protected-class, unauthorized, or premature executions
- Median operator effort below 15 minutes on handled cases

### Stop / rework offer

- People refuse even redacted evidence after a clear privacy pitch
- Findings feel obvious / zero surprise
- **0 actual payments** after 20 real autopilot offers (written intent does not save this gate)
- Users only care if full bank/UPI auto-magic exists (wedge may be wrong timing)
- Any protected-class or unauthorized execution

### Measurable funnel (do not mark ahead of events)

This is the only private-pilot conversion sequence agents may count. Empty cells and `not-contacted` mean unmeasured, not failure.

```text
20 sourced targets
  → 5 conversations (current: 1 — Prashanth Vaidya, 2026-08-20/22)
  → 2 connected sources plus standing mandates
  → 1 financially meaningful cited aha
  → 1 explicit payment ask
```

| Step | Current (2026-08-15) | Rule |
| --- | ---: | --- |
| Sourced targets in gitignored CRM | 20 | Direct public sources only; no invented spend or identity |
| Conversations | 1 | Founder-confirmed reply or call. Drafts are not conversations. Evidence 2026-08-22: Prashanth Vaidya replied in https://x.com/pvbuilds/status/2090155802158084243 |
| Connected sources + mandates | 0 | Both events on the same workspace |
| Financially meaningful cited aha | 0 | Customer sees an unexpected cited commitment from their evidence |
| Explicit payment ask | 0 | Founder asked; `actual_payment_at` stays blank until money arrives |

Do **not** mark contacted, replied, activated, paid, or referred. Five founder-approval drafts live in gitignored `docs/execution/private-autopilot-outreach-draft.md`. Nothing sent.

---

## 1. CRM schema (canonical)

**Working file (gitignored; may contain PII):** `docs/execution/private-autopilot-pilot-crm.csv` — sourced targets, not qualified prospects.
**Committed headers:** [`private-autopilot-pilot-crm.csv.example`](private-autopilot-pilot-crm.csv.example)
**Historical paste-audit CRM (gitignored; not new pilot evidence):** `docs/execution/private-audit-crm.csv`

Agents: never invent “connected”, “mandate accepted”, “paid”, or “verified saving” statuses. Founder owns status transitions.

### Required columns

| Column | Type | Values / notes |
| --- | --- | --- |
| `id` | string | `P01`, `P02`, … stable |
| `connected_account_at` | datetime | First proven connected evidence source |
| `mandate_accepted_at` | datetime | Signed standing mandate |
| `mandate_terms_version` | string | Exact terms version on the signed text |
| `candidate_discovered_at` | datetime | First eligible discretionary candidate |
| `notice_delivered_at` | datetime | 48-hour veto notice **successfully delivered** |
| `veto_at` | datetime | User veto before execution |
| `exception_at` | datetime | Password / OTP / login / UPI-app / bank-confirmation / unknown path |
| `supported_execution_at` | datetime | Merchant API, authenticated support/agency, or equivalent supported channel |
| `post_mandate_customer_work_minutes` | number | Minutes the customer spent after signing. Zero is the product promise. |
| `verification_coverage` | enum | `covered` \| `pending` \| `missing` |
| `clean_window_at` | datetime | Covered window with no baseline debit |
| `verified_saving_minor` | integer | Exact minor units; empty until covered proof |
| `verified_saving_currency` | char(3) | Usually `INR` |
| `actual_payment_at` | datetime | Money received. **Required for the paid gate.** |
| `actual_payment_amount_inr` | number | Gross collected |
| `written_pay_intent_at` | datetime | Written intent only. **Does not satisfy the paid gate.** |
| `refund_at` | datetime | |
| `refund_amount_inr` | number | |
| `operator_minutes` | number | Internal effort on this workspace |
| `status` | enum | see below |
| `notes` | text | |

### Status machine (use exactly)

```
not-contacted
  → connected
  → mandate-accepted
  → candidate-found
  → notice-delivered
      → silence-authorized
      → vetoed
      → exception
  → supported-execution
  → verifying
  → clean-window
  → paid | refunded | closed-lost
```

Veto or mandate revocation returns queued cases to withdrawn immediately. Exceptions are not “supported execution.”

### Minimum weekly CRM hygiene

- Same day: `connected_account_at` / `mandate_accepted_at` / `notice_delivered_at`
- Separate columns for `actual_payment_at` and `written_pay_intent_at`
- Friday: export counts for THE-LAW scoreboard — never mix intent into paid

---

## 2. ICP (who to contact first)

**Priority 1 — Beachhead**

- India-based founders / freelancers with AI + SaaS + cloud stacks who will connect a real mailbox or statement source
- People who already said a spreadsheet still surprises them
- People willing to sign a standing mandate with a 48-hour veto

**Priority 2**

- Fractional CFOs / CAs (channel pilots later in Phase E)
- Indie hackers with multi-currency tools

**Deprioritize for Phase A**

- Enterprise procurement
- Users who only want fully automated bank sync day-one
- Anyone requesting credit products
- Anyone asking Vognary to auto-stop EMI, SIP, insurance, utilities, or cloud infrastructure

---

## 3. Outreach scripts (copy-paste)

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

## 4. Pilot delivery standard (every pilot identical)

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

## 5. Corpus consent (privacy-safe)

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

## 6. 21-day calendar

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

## 7. Agent rules for Phase A

| Allowed | Forbidden |
| --- | --- |
| Draft outreach in founder voice | Spamming contacts without founder approval |
| Fill CRM from proven product events | Inventing payments, savings, or READY rails |
| Build redaction helpers / export UX | Putting PII in git, issues, or logs |
| Fix blockers that stop a pilot mid-flight | Reviving free paste-audit volume as the wedge |
| Track the columns in §1 | Counting written pay intent as paid |
| | Auto-executing EMI, debt, SIP, insurance, utilities, cloud, or conflicted items |

---

## 8. Day-21 stop/go worksheet

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

## 9. 15-minute behavioral interview (do not treat as qualification)

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

## 10. Live-onboarding checklist (private Autopilot path)

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
