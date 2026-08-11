# Phase A — Market contact kit (21 days)

> **Parent law:** [`docs/THE-LAW.md`](../THE-LAW.md)  
> **Goal:** Prove humans care and will pay. Not more product features.  
> **Owner:** Founder primary; agents support with CRM hygiene, report generation, redaction helpers, copy polish.  
> **Exit:** Day-21 stop/go using THE-LAW scoreboard metrics.
> **Live field memory (people, threads, learnings, scripts):** [`people-conversation-learning.md`](people-conversation-learning.md) — read before new outreach; append same day.

---

## 0. Success / stop criteria

### Go (continue building loop + activation)

- ≥10 completed real audits with redacted evidence  
- ≥50% have at least one “I didn’t know / forgot this was renewing” finding  
- ≥3 paid ₹999 **or** hard verbal/written commitment to pay after free batch  
- ≥15 consented corpus fixtures stored (private; never commit PII to git)  
- Repeated unsolicited ask for “do this every month”

### Stop / rework offer

- People refuse even redacted evidence after clear privacy pitch  
- Findings feel obvious / zero surprise  
- Praise for idea but zero pay intent after 20 valuable free audits  
- Users only care if full bank/UPI auto-magic exists (wedge may be wrong timing)

---

## 1. CRM schema (canonical)

**Working file:** `docs/archive/private-audit-pipeline.csv`  
**Better path (create when editing):** `docs/execution/private-audit-crm.csv`  
Agents: never invent “completed” statuses. Founder owns Status transitions.

### Required columns

| Column | Type | Values / notes |
| --- | --- | --- |
| `id` | string | `C01`, `C02`, … stable |
| `name` | string | Person |
| `company` | string | |
| `segment` | enum | `funded-startup` \| `freelancer` \| `solo-founder` \| `smb` \| `household` \| `ca-client` |
| `contact` | url/email | LinkedIn URL or email |
| `channel` | enum | `linkedin-dm` \| `linkedin-post` \| `email` \| `whatsapp` \| `referral` \| `inbound` \| `x-public` \| `x-dm` \| `peerlist` |
| `source` | string | How found |
| `asked_at` | date | First outreach ISO date |
| `status` | enum | see below |
| `audit_booked_at` | date | |
| `files_received` | bool | |
| `audit_completed_at` | date | |
| `monthly_recurring_found_inr` | number | |
| `avoidable_monthly_found_inr` | number | |
| `surprise_quote` | text | Verbatim |
| `paid` | enum | `no` \| `intent` \| `yes-999` \| `refunded` |
| `objection` | text | |
| `next_follow_up` | date | |
| `corpus_consent` | enum | `no` \| `asked` \| `yes-redacted` |
| `notes` | text | |

### Status machine (use exactly)

```
not-asked → asked → replied → booked → files-in → audit-done → paid|closed-lost
                ↘ no-reply (after 2 nudges)
                ↘ declined
```

### Minimum weekly CRM hygiene

- Every outreach updates `asked_at` + `status` same day  
- Every completed audit fills money fields + `surprise_quote`  
- Friday: export counts for THE-LAW scoreboard  

---

## 2. ICP (who to contact first)

**Priority 1 — Beachhead**

- India-based founders / freelancers with AI + SaaS + cloud stacks  
- Funded startups (pre-seed/seed) with 5–30 tool stack  
- People who publicly complain about burn / subscriptions  

**Priority 2**

- Fractional CFOs / CAs (channel pilots later in Phase E)  
- Indie hackers with multi-currency tools  

**Deprioritize for Phase A**

- Enterprise procurement  
- Users who only want fully automated bank sync day-one  
- Anyone requesting credit products  

---

## 3. Outreach scripts (copy-paste)

### 3.1 LinkedIn / cold DM (first touch)

```text
Hi {Name} — quick one.

I run private recurring-burn audits for founders (AI/SaaS/cloud + UPI/card mandates).
Most people know revenue and runway; almost nobody has one evidence-backed list of what renews next.

Offer this week: free redacted audit (no bank passwords). You paste receipts / statement exports / mandate screenshots.
You get: monthly burn, next 45-day renewals, top 3 actions, missing-source checklist.

If useful, the one-time assisted audit is ₹999 (no auto-renew). Happy to do yours free in this batch.

Intake: https://www.vognary.com/private-audit?src=dm
Or reply with a good time for a 20-min share-screen.

— {Your name}, Vognary
```

### 3.2 Follow-up (day 3, if no reply)

```text
Looping once — still holding 2 free audit slots this week.
Even a redacted CSV or 3 receipt screenshots is enough to show whether this is useful.
No pressure if timing is off.
```

### 3.3 Follow-up (day 7)

```text
Closing this batch Friday. If you want the free recurring-burn report, reply “audit” and I’ll send the short intake.
```

### 3.4 After they agree

```text
Perfect. Three options (pick one):

1) Self-serve: https://www.vognary.com/private-audit?src=dm
2) Fast path: paste 2–5 receipts here (redact account numbers)
3) Share-screen 20 min — we import together

I never need passwords, OTPs, or CVV.
After the report, I’ll ask if we can keep a fully redacted fixture for parser quality (optional, consent-only).
```

### 3.5 LinkedIn public post (air cover)

```text
Running 10 private recurring-burn audits this week for founders and freelancers.

People know salary / revenue / runway.
They rarely know what quietly renews across SaaS, AI, cloud, domains, Play/App Store, UPI AutoPay, card mandates, EMIs, SIPs, insurance, and email receipts.

Vognary turns that into an evidence-backed report:
• monthly recurring burn
• next debits (45 days)
• avoidable / watch items
• missing sources named honestly
• proof beside every recommendation

Redact sensitive details. No bank passwords.

Intake: https://www.vognary.com/private-audit?src=li-post
```

### 3.6 WhatsApp short

```text
Free founder audit this week: what renews next across UPI/SaaS/AI/cloud.
Redacted OK. No passwords.
Link: https://www.vognary.com/private-audit?src=wa
```

### 3.7 After free audit → pay ask

```text
Here’s your report (attached / link).

Summary: ₹{monthly}/mo recurring · ₹{avoidable}/mo look avoidable or watch · next big debit {date}.

If this was worth it, the one-time assisted audit product is ₹999 (no subscription) once checkout is live — or you can pay that amount manually and I’ll invoice.

Either way: would a monthly refresh be useful? (research only — not a product promise yet)
```

---

## 4. Audit delivery standard (every audit identical)

Use template: [`docs/templates/audit-report-template.md`](../templates/audit-report-template.md)

### Delivery checklist (agent or founder)

1. Ingest evidence via guest `/app` or signed-in workspace  
2. Confirm currency separation (never sum USD into INR silently)  
3. Capture: monthly burn, annual run-rate, count of commitments  
4. Rank top 3 actions with **evidence citations**  
5. List missing sources (UPI / Gmail / statements / SaaS) honestly  
6. 45-day renewal timeline highlights  
7. Export pack (JSON + PDF/CSV if available)  
8. Fill CRM money + surprise quote fields same day  
9. Ask corpus consent with redaction  
10. No claim of bank linking or AI certainty beyond proof  

### Time budget

- Prep: 10 min  
- Live session: 20 min  
- Write-up: 20 min  
- **Total ≤ 50 min** per audit in Phase A  

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
You can say no — the audit still stands.
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
| 1 | Create/update CRM; message 10 leads | Ensure private-audit + guest audit paths work locally |
| 2 | Message 10 more; post LinkedIn air cover | Fix any intake/export bugs found |
| 3 | Book calls; send after-agree script | Prepare report template fills from sample |
| 4 | Deliver audit 1–2 | Help generate pack; CRM fields |
| 5 | Deliver audit 3–4 | Same |
| 6 | Nudge non-replies | Landing honesty if users confuse sample ledger |
| 7 | Scoreboard Friday | Update CONTINUE-HERE if product gaps found |
| 8–10 | Audits 5–7; first pay asks | Loop product gaps from user friction only |
| 11–14 | Audits 8–10; corpus consent drive | Corpus tooling / redaction checklist |
| 15–18 | Follow-ups; convert intent→paid | Billing runbook support (no fake READY) |
| 19–20 | Second-touch re-audits for 2 users | Diff / review quality |
| 21 | **STOP/GO** with metrics only | Write measured scoreboard into THE-LAW §5 if founder asks |

---

## 7. Agent rules for Phase A

| Allowed | Forbidden |
| --- | --- |
| Draft outreach variants in founder voice | Spamming contacts without founder approval |
| Fill report templates from product export | Inventing surprise quotes or paid status |
| Build redaction helpers / export UX | Putting PII in git, issues, or logs |
| Fix blockers that stop an audit mid-flight | New features “to impress” prospects |
| Track metrics tables | Declaring PMF without numbers |

---

## 8. Day-21 stop/go worksheet

```text
Date:
Completed audits:
% with surprise finding:
Paid / pay-intent count:
Corpus fixtures:
Median time-to-insight:
Top 3 objections:
Top 3 feature requests (only if repeated):
Decision: GO / STOP / REWORK OFFER
Evidence links (CRM rows):
```

Copy result into `docs/CONTINUE-HERE.md` under a short “Phase A result” note when decided.
