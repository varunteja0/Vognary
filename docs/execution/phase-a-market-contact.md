# Phase A — Paid Commitment Control pilots (30 days)

> **Operating sequence: Make it work. Make it perfect. Make it fast. Make it cheap.**
> **Strategy rule: Take smart risks. Do not play safe.** Pursue asymmetric,
> falsifiable upside and bound irreversible downside. Every market bet needs a
> deadline and kill metric. Full doctrine: [`THE-LAW.md`](../THE-LAW.md).

> **Parent law:** [`docs/THE-LAW.md`](../THE-LAW.md)
> **Goal:** Determine which of three buyer cells will pay for a rail-neutral decision-to-outcome record for AI, SaaS, and cloud commitments, without changing the product before behavior chooses the wedge.
> **Owner:** Founder owns targeting, conversations, offers, contracts, and payment evidence. Agents support CRM structure, proposal intake, and evidence-safe artifacts.
> **Day 14 wedge gate (2026-09-16):** five completed conversations in each test cell, 10 identical explicit offers across credible buyers, and two upfront payments. The original seven-day gate was missed; this test does not erase or reclassify that result.
> **Day 30 gate:** three paid pilots, 30 pre-spend proposals, three materially changed/capped/declined decisions, at least 80% pre-spend arrival, and two paid renewals.

---

## 0. Success / stop criteria

### Day 14 wedge success

- Five completed conversations per test cell, each founder-confirmed: `DIRECT_FINANCE`, `FRACTIONAL_FINANCE`, and `FINOPS_AI_OPERATIONS`.
- A cell wins directionally only when at least three of five buyers describe a concrete repeated job, at least two commit to bring a qualifying upcoming or recent event, and at least one pays or makes a specific invoice commitment.
- Ten identical one-time ₹14,999 pilot offers are made.
- Two pilots pay upfront. Written intent, invoice sent, and payment received remain separate fields.
- Pending LinkedIn invitations count as transmitted contact attempts only. They do not count as a reply or conversation.

### Day 30 success

- Three paid pilots are active.
- 30 proposals are evaluated; at least 80% arrive before spend.
- At least three decisions are materially changed, capped, or declined.
- Two pilots renew at the paid price.
- Zero unauthorized decisions, invented money, cross-workspace evidence links, or autonomous actions.

### Kill / rework

- Fewer than two of ten offers pay.
- No test cell reaches three concrete repeated jobs and two committed events.
- Fewer than half of proposal requests arrive before spending.
- 30 proposals change zero decisions.
- Buyers require Vognary to move money, issue cards, or auto-approve before they will pay.
- Any proposal, policy result, or reconciliation is presented as evidence when it is only an assumption.
- Interviews consistently select post-spend Recovery over pre-spend authorization: make Recovery the front-door wedge and keep Control as the next-cycle action rather than averaging the two jobs.

### Measurable funnel

```text
5 DIRECT_FINANCE + 5 FRACTIONAL_FINANCE + 5 FINOPS_AI_OPERATIONS conversations
  → one cell meets 3 concrete jobs + 2 committed events + 1 payment/invoice commitment
  → 10 identical one-time ₹14,999 offers
  → 2 upfront payments by Day 14
```

Current Commitment Control counts (private CRM, 2026-09-02): rows **45**;
founder-qualified direct-finance **5**; exploratory public-evidence-ready Cell
B/C candidates **10**; older unassigned **30**; contacted **3/15**; replied
**0**; conversations **0**; repeated jobs **0**; committed events **0**; offers
**0**; invoice commitments **0**; invoices **0**; payments **0**. The sourcing
cohort gate is **READY** at 5/5/5; the company demand gate remains
**INCOMPLETE**. LinkedIn is paused after the authenticated browser logged out
following an anti-scraping protection request. Historical Autopilot
conversations do not count toward the new thesis. Drafts and opened profiles are
not contacts.

### Three-cell test — one product, three possible buyers

This is a buyer-and-job test, not three products. `contact_cohort` continues to
describe evidence quality (`QUALIFIED | EXPLORATORY`); `test_cell` describes the
hypothesis being tested. The existing five qualified contacts remain
`DIRECT_FINANCE`. New candidates in the other cells remain `EXPLORATORY` until
their cell-specific public criteria and buyer authority are verified.

| Test cell | Public qualification before contact | Unknown that conversation must resolve |
| --- | --- | --- |
| `DIRECT_FINANCE` | India-registered, 20–100-person AI-native company, recent seed–Series B funding, named finance owner | Whether a real pre-spend decision gap exists and an advisory record is valuable without enforcement |
| `FRACTIONAL_FINANCE` | Fractional CFO, CA, or finance-operations firm publicly serving at least five startup clients | Whether one operator has repeated cross-client commitment decisions and can buy or sponsor a one-to-many workflow |
| `FINOPS_AI_OPERATIONS` | FinOps, platform-engineering, or AI-operations leader with explicit responsibility for variable AI, SaaS, or cloud costs | Whether decision-to-outcome evidence is missing and materially different from existing provider budgets and procurement tooling |

Test the descriptor **Authorization Ledger** only in interviews. It means a
rail-neutral record that preserves evidence, policy, actor, decision, and frozen
cap, then reconciles observed evidence. It is not a rename and must never imply
that Vognary blocks a card, API call, purchase, or payment.

Every completed conversation also classifies the event the buyer will actually
bring, using `idea_candidate_observed`. This is an entry-path test, not three
products or a public rename:

| Value | Count only when |
| --- | --- |
| `AI_SPEND_CHANGE_CONTROL` | The buyer commits an upcoming human-initiated AI or cloud obligation that needs a named decision, cap, expiry, and later outcome proof. |
| `RECOVERY_FIRST_CONTROL` | The buyer starts with an observed bill or variance and commits to use that evidence to govern the next cycle. |
| `AGENT_SPEND_AUTHORIZATION` | An AI agent or automated workflow initiated the proposed spend or action, while a named human remains responsible for its cap and outcome. |
| `NONE` | A completed conversation produces no qualifying committed event for any candidate. |
| `UNMEASURED` | The conversation did not establish enough evidence to classify the event. |

A concrete candidate value requires `conversation_at`. Praise, macro market
interest, or a hypothetical event stays `UNMEASURED`; the reporter rejects a
concrete value without a recorded conversation. The existing C1/R2/C3 desk below
remains a narrower operator test and cannot manufacture a broad candidate win.

### Five-call C3 candidate desk — run before more product code

This desk tests one candidate against two rival explanations of the same buyer
behavior. It does not select a company direction. Keep private identities and
case details in the gitignored CRM; commit aggregate counts only.

| Candidate | Buyer/job claim under test | What one call can support | What one call cannot prove |
| --- | --- | --- | --- |
| `C3` | An MSP/FinOps operator repeatedly needs a named client authorization before an exact gateway remediation, can delegate a narrowly scoped sandbox management credential, and will pay to close action-to-outcome proof. | Two concrete cases, a missing authorization/action/outcome link, named credential authority, one committed case, and price-specific invoice behavior. | Production safety, a working LiteLLM contract, retention, or another operator's demand. |
| `C1` | A multi-client adviser needs a common authorization record, but an advisory workflow without technical enforcement is sufficient. | The operator chooses a cross-client advisory record as the job they will bring and rejects enforcement as unnecessary. | Fractional-CFO buying behavior; that still requires the five `FRACTIONAL_FINANCE` calls. |
| `R2` | The funded job begins after spend: resolve an invoice/cost variance, attach an owner, and prove the outcome. | The buyer's actual next event starts from observed spend and they choose evidence-to-resolution over pre-action authorization. | That pre-action control has no market elsewhere. |

**Observed roll-up at desk creation (2026-09-02):**

| Evidence | `C3` | `C1` | `R2` |
| --- | ---: | ---: | ---: |
| Completed candidate-classifying calls | 0/5 | 0/5 | 0/5 |
| Concrete repeated jobs | 0 | 0 | 0 |
| Committed qualifying cases/events | 0 | 0 | 0 |
| Scoped sandbox credential delegation: willing **and authorized** | 0 | N/A | N/A |
| Price-specific invoice commitments | 0 | 0 | 0 |
| Cleared payments | 0 | 0 | 0 |

Zero means no evidence, not a negative market result. Recompute this table only
from founder-confirmed CRM fields after each call.

#### One call sheet, repeated five times

Do not explain Vognary before question 7. Ask for artifacts by screen share or
verbal reconstruction; do not collect customer financial data in Vognary.

| Min | Ask | Count only when |
| ---: | --- | --- |
| 0–4 | “Walk me through the last two client technology-cost variances you personally helped resolve. What happened and when?” | Two specific instances or one instance plus a buyer-stated recurring cadence establishes `repeated_job_status=YES`. |
| 4–7 | “What system detected each case, what exact remediation was proposed, and where did the work wait?” | The buyer names the actual console/ticket/script and a concrete wait or handoff. |
| 7–10 | “Who could authorize the change, what did they see, where was approval recorded, and who held the credential that could act?” | Actor, authority, evidence, action point, and credential custodian are specific. |
| 10–13 | “How did you determine whether the action happened and whether actual impact matched the estimate?” | A provider request/result, later bill, or explicit absence of proof is named. |
| 13–16 | “Which one job would you bring next: a cross-client advisory authorization record (`C1`), a post-spend variance resolution (`R2`), or a client-authorized bounded action with outcome proof (`C3`)? Show me the event, not a preference.” | `primary_candidate_observed` follows the event they commit, not the option they praise. |
| 16–18 | For a `C3` event only: “Could your organization authorize a dedicated disposable-sandbox management credential limited to reading and updating one test key, never a master or production key? Who signs that off?” | Both willingness and named organizational authority exist. A founder cannot infer authority from title. |
| 18–20 | Explain the candidate in one sentence, ask for one dated synthetic/cleared case, then make the fixed offer only if its price was founder-approved before the first offer. | Commitment, offer, invoice commitment, invoice, and cleared payment retain separate timestamps. |

Record for each call: private CRM ID, two-case evidence status, recurrence,
current tool, authorization gap, exact action point, primary candidate observed,
credential willingness, credential authority, committed case/date, fixed price
offered, invoice commitment, invoice, payment, and disqualifying reason. Do not
record secrets, raw customer amounts, or private case text in Git.

#### Candidate decision rule after call five

- `C3` may advance to founder acceptance only with **at least 3/5** repeated
  C3-class gaps, **at least 2/5** operators both authorized to delegate the
  scoped sandbox role and committed to a qualifying case, **at least 1/5**
  price-specific invoice commitment, and at least a two-call lead over each
  rival job classification. It still does not become a company pivot until the
  company payment gate clears.
- `C1` is supported when at least 3/5 committed events require cross-client
  advisory authorization but not action enforcement. Confirm buying behavior in
  the separate fractional-finance cell before choosing it.
- `R2` is supported when at least 3/5 committed events begin with observed
  spend/invoice variance and buyers choose post-spend resolution over a
  pre-action control.
- If none clears its rule, report `INCONCLUSIVE`; do not average counts or use
  the thesis scores to manufacture a winner.
- The currently authorized company offer remains the one-time ₹14,999
  Commitment Control pilot. The report's ₹75,000 C3 design-partner price is an
  unapproved hypothesis. No C3 offer counts until the founder chooses one fixed
  price; after that, do not discount or vary it inside the test.

---

## 1. CRM schema (canonical)

**Working file (gitignored; may contain PII):** `docs/execution/private-commitment-control-pilot-crm.csv`. Do not commit names, emails, private proposals, contracts, or payment records.
**Committed field contract:** [`private-commitment-control-pilot-crm.csv.example`](private-commitment-control-pilot-crm.csv.example).

Agents never infer `qualified`, `offered`, `paid`, `renewed`, or `decision_changed`. The founder records those transitions from direct evidence.

### Required columns

The closed `contact_cohort` vocabulary is `QUALIFIED | EXPLORATORY`. Exploratory
rows keep `qualified_at` blank and never count toward the qualified cohort. The
independent `test_cell` vocabulary is
`DIRECT_FINANCE | FRACTIONAL_FINANCE | FINOPS_AI_OPERATIONS`.

| Column | Type | Values / notes |
| --- | --- | --- |
| `id` | string | `P01`, `P02`, … stable |
| `contact_cohort` | enum | `QUALIFIED` \| `EXPLORATORY`. Exploratory rows keep `qualified_at` blank and never count as qualified. |
| `test_cell` | enum | `DIRECT_FINANCE` \| `FRACTIONAL_FINANCE` \| `FINOPS_AI_OPERATIONS` |
| `company_name` | string | Private working identity; never commit the populated row |
| `company_public_url` | URL | Canonical company source |
| `india_entity_evidence_url` | URL | Public evidence of an India-registered operating entity |
| `headcount_evidence_url` | URL | Public evidence supporting 20–100 people; record uncertainty |
| `funding_evidence_url` | URL | Public funding announcement or database source |
| `funding_date` | date | Must be within the last 24 months for the first beachhead |
| `ai_native_evidence_url` | URL | Public evidence that AI is core to product or operations |
| `finance_owner_role` | string | Finance lead, fractional CFO, or ops-owning cofounder; `UNKNOWN` is not qualified |
| `finance_owner_public_url` | URL | Public source for the role, not assumed identity |
| `operator_scope_count` | integer or blank | Publicly proved number of client companies or governed workloads; blank is unknown, never inferred |
| `technology_spend_responsibility` | enum | `YES` \| `NO` \| `UNMEASURED`; requires role evidence or buyer confirmation |
| `buying_role` | enum | `BUYER` \| `SPONSOR` \| `USER` \| `UNKNOWN`; never inferred from title alone |
| `contact_channel` | enum | `WARM_INTRO` \| `MANUAL_DIRECT` \| `REFERRAL` \| `PARTNER` \| `OTHER`; blank until an actual contact attempt |
| `founder_minutes` | non-negative integer or blank | Cumulative founder minutes for sourcing, outreach, calls, offer follow-up, and delivery on this row; never estimate or backfill |
| `qualified_at` | datetime | Public beachhead criteria verified; spend is still unmeasured until a conversation |
| `contacted_at` | datetime | A message was actually sent; drafts stay blank |
| `replied_at` | datetime | A substantive reply was received; delivery/pending state stays blank |
| `conversation_at` | datetime | A real call or substantive reply, not a sent message |
| `last_real_commitment_at` | datetime | Last specific obligation discussed; blank until the buyer names it |
| `last_real_commitment_amount_minor` | integer string | Exact amount only when the buyer states or cites it |
| `last_real_commitment_currency` | char(3) | Currency paired with the amount |
| `pain_class` | enum | `PRE_SPEND` \| `POST_SPEND` \| `BOTH` \| `NONE` \| `UNMEASURED` |
| `repeated_job_status` | enum | `YES` \| `NO` \| `UNMEASURED`; `YES` requires at least two concrete instances or a buyer-stated recurring cadence |
| `job_selected` | enum | `PRE_SPEND` \| `RECOVERY` \| `DECISION_TO_OUTCOME` \| `NONE` \| `UNMEASURED`; based on the event the buyer will bring, not stated preference |
| `idea_candidate_observed` | enum | `AI_SPEND_CHANGE_CONTROL` \| `RECOVERY_FIRST_CONTROL` \| `AGENT_SPEND_AUTHORIZATION` \| `NONE` \| `UNMEASURED`; concrete values require `conversation_at` and a buyer-committed event, not stated preference |
| `enforcement_requirement` | enum | `ADVISORY_ACCEPTED` \| `NEEDS_ENFORCEMENT` \| `UNMEASURED` |
| `next_event_committed_at` | datetime | Buyer committed to bring a qualifying upcoming or recent event; a compliment is not a commitment |
| `spend_threshold_confirmed_at` | datetime | Buyer confirmed ≥₹8 lakh/month controllable exposure; public proxies do not count |
| `monthly_controllable_spend_minor` | integer string | Buyer-stated/cited amount only |
| `monthly_controllable_spend_currency` | char(3) | Usually INR; never convert FX |
| `working_session_at` | datetime | One real upcoming commitment was brought to the desk |
| `offer_at` | datetime | Explicit one-time ₹14,999 pilot offer made |
| `invoice_commitment_at` | datetime | Buyer agreed to a specific invoice path; does not count as invoice delivery or payment |
| `invoice_sent_at` | datetime | Invoice delivery; does not count as payment |
| `payment_received_at` | datetime | Cleared upfront payment; the paid gate |
| `payment_amount_inr` | integer | Cleared gross INR amount |
| `proposal_count` | integer | Proposals actually evaluated |
| `pre_spend_proposal_count` | integer | Proposals received before an obligation existed |
| `obligation_created_at` | datetime | Buyer-confirmed creation time for the latest proposal; needed to classify pre-spend honestly |
| `pre_spend_status` | enum | `YES` \| `NO` \| `UNKNOWN`; first-charge date is not a substitute |
| `changed_decision_count` | integer | Capped, declined, or materially changed after evaluation |
| `t0_status` … `t5_status` | enum | `PASS` \| `RESCUED` \| `FAIL` \| `NOT_YET_ELIGIBLE`; T5 is later evidence reconciled against the frozen authorization |
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
- After each actual action: add measured elapsed time to `founder_minutes`; set
  `contact_channel` on the first transmitted contact and do not rewrite it to
  make a later channel look better.
- Record proposal counts from product evidence; never reconstruct them from memory.
- Friday: export aggregate counts to the scoreboard; never commit the private CRM.
- Run `npm run market:cohort-gate`; it remains red until every cell has five public-evidence-ready candidates. Assigned labels alone never pass it.
- Current measured state (2026-09-02): cohort gate READY at 5/5/5; rerun after every candidate-evidence change.

---

## 2. ICP cells (who to contact first)

**Cell A / current beachhead:** India-registered, 20–100-person AI-native companies that raised seed through Series B in the last 24 months and have a named finance owner: finance lead, fractional CFO, or ops-owning cofounder. Public sources must support entity, size, funding recency, AI relevance, and finance ownership before `qualified_at` is set.

**Cell B / operator channel:** India-serving fractional CFO, CA, and finance-operations firms with public evidence of at least five startup clients. The conversation must establish whether the operator repeatedly governs AI, SaaS, or cloud commitments and whether they are buyer, sponsor, or user. Client count does not prove pain or authority.

**Cell C / technology-value owner:** FinOps, platform-engineering, or AI-operations leaders with public responsibility for variable technology cost. Company size is exploratory in this cell. The conversation must establish a real decision-to-outcome gap; FinOps macro demand does not prove this buyer needs Vognary.

**Conversation gate:** the buyer confirms at least ₹8 lakh/month of controllable AI, cloud, software, contractor, or campaign exposure and can bring one real upcoming commitment before spend. Until then, spend remains `UNMEASURED`; never infer it from funding or headcount.

**Deprioritize:** solo/duo builders, agencies whose total annual stack is below the pilot fee, companies under 20 or over 100 people, teams without a named finance owner, enterprise procurement transformations, teams seeking spend cards or payments, companies unable to provide a pre-spend proposal, and anyone requiring autonomous approval or purchasing.

---

## 3. Offer and delivery contract

Position this as a **founder-delivered control desk**, not naked SaaS. The one-time ₹14,999 pilot covers one month: one policy setup, up to ten real proposals, one 30-minute reconciliation review per week (maximum four), and up to two additional founder-support hours. It records decisions; it does not purchase, provision, cancel, or move money. Service and customer-data access begin only after the written activation conditions, including the required independent security review, are complete. If Vognary cannot activate within ten business days after payment, the buyer may request a full refund. A second month requires a separate purchase.

### First-touch frame

```text
Hi {Name} — I’m running a founder-delivered Commitment Control pilot for recently funded AI-native teams with a named finance owner.

Before the next AI, cloud, software, contractor, or campaign obligation is created, the desk shows cited existing exposure, checks your stated policy, and records a named human decision and frozen cap. Later bills are reconciled against that approval.

The pilot is a one-time ₹14,999 payment for one month, including one policy setup, up to ten proposals, weekly reconciliation reviews, and bounded founder support. Vognary never auto-approves or moves money. Do you have one real upcoming commitment we could put through a 20-minute working session after the independent security review is complete?
```

Do not discount, add a menu, or offer free implementation before the offer-ten gate. Record price-specific rejection separately from rejection of the underlying job.

## 4. Live behavioral discovery (before a demo)

Ask about the last real financial obligation; do not explain Vognary until question 6.

| Min | Ask | Evidence sought |
| ---: | --- | --- |
| 0–3 | “Walk me through the last real commitment you governed for AI, cloud, or software.” | A dated, specific obligation — not general frustration |
| 3–6 | “When was the company committed: before the invoice, when someone said yes, or only when the card/bill arrived?” | `PRE_SPEND`, `POST_SPEND`, `BOTH`, or `NONE` |
| 6–9 | “Who could have capped or declined it, and what information did they have at that moment?” | Named authority and missing context |
| 9–12 | “Show me how that approval happened — message, call, sheet, accounting tool, or nothing.” | Actual incumbent behavior, not feature preference |
| 12–15 | “Could you reconstruct the original evidence, policy, person, cap, and what the later bill showed?” | Whether the missing job is pre-spend, Recovery, or decision-to-outcome |
| 15–17 | “If Vognary records and proves the decision but does not block the card or API, is that useful enough to adopt?” | `ADVISORY_ACCEPTED` or `NEEDS_ENFORCEMENT` without negotiating the boundary |
| 17–20 | Explain the Authorization Ledger in one sentence and ask which qualifying upcoming or recent event they will bring next, including whether a human, agent, or automation initiated it. | `job_selected`, `idea_candidate_observed`, `next_event_committed_at`, and working-session behavior — not praise |

Classify the conversation the same day. Ask the same rival-job and enforcement questions in all three cells. If most buyers bring post-hoc bill evidence, that supports Recovery as the wedge, not Commitment Control. If they require cards or money movement to pay, record `NEEDS_ENFORCEMENT`; do not build rails.

### Cell scorecard and decision rule

For each buyer-cell × idea-candidate pair report only aggregate counts: completed
conversations in the cell, candidate observations, concrete repeated jobs,
committed next/recent events, and payment or invoice commitments. Also report
cell-level advisory acceptance, enforcement requirements, offers, invoices, and
cleared payments. Do not average cells or candidates. A pair is a directional
winner only after the cell completes five conversations and that candidate
reaches **3/5 concrete repeated jobs + 2/5 committed events + 1/5 payment or
invoice commitment**. Multiple qualifying pairs remain explicitly multiple;
the company still requires ten offers and two cleared payments to proceed.

## 5. Fourteen-day execution cadence

| Day | Founder action | Evidence |
| ---: | --- | --- |
| 1–3 | Verify current role evidence and complete the 12 remaining touches across the prepared 5/5/5 cohorts | `test_cell`, public evidence, `contacted_at`; do not route around channel restrictions |
| 2–10 | Complete five behavioral conversations per cell; collect no real customer financial data in Vognary before independent security clearance | `replied_at`, `conversation_at`, `job_selected`, `idea_candidate_observed`, `enforcement_requirement`, minimum necessary notes |
| 4–12 | Ask credible buyers to commit one qualifying upcoming or recent event and make the identical one-time ₹14,999 offer until ten offers are recorded | `next_event_committed_at`, `offer_at`, `invoice_commitment_at` |
| 13–14 | Apply the cell winner rule and two-payment company gate using cleared funds only; payment grants no data access before assurance clearance | One `WIN / REWORK / KILL` decision in CONTINUE-HERE and the scoreboard |

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
