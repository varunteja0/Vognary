# First-10 Commitment Control pilots — operating runbook

> **Operating motto: Take smart risks. Do not play safe.** Prefer a decisive
> customer test over another internal refinement; record the success threshold,
> kill threshold, and downside bound. Full doctrine: [`THE-LAW.md`](../THE-LAW.md).

> **Parent law:** [`docs/THE-LAW.md`](../THE-LAW.md) · Live state: [`docs/CONTINUE-HERE.md`](../CONTINUE-HERE.md)
> Purpose: run the first 10 qualified Commitment Control conversations and working sessions professionally. This is an operating runbook, not a plan.
> Behavioral discovery script: [`phase-a-market-contact.md`](phase-a-market-contact.md) §4.
> Rule that binds every field below: never invent a value; empty means unmeasured.

## 1. Commitment Control live session contract

The live loop is a real upcoming proposal → cited existing exposure → policy
context → named human decision → frozen cap → later observed evidence. A
retrospective bill review does not prove this thesis. Do not count historical
Recovery/Autopilot sessions, old CRM replies, product praise, or a demo proposal.

| Milestone | Truthful definition | Source of truth |
| --- | --- | --- |
| **Conversation** | A substantive reply or call completes the behavioral questions in Phase A §4 | Private CRM `conversation_at` plus redacted notes |
| **Working session** | The company brings one real upcoming commitment that does not yet exist | CRM `working_session_at`; private timing evidence |
| **Proposal evaluated** | Their proposal is stored with `USER_ENTERED_ASSUMPTION` and deterministic policy context | `commitment_control_proposals` + `commitment_control_evaluations` |
| **First value** | An owner/admin records APPROVE, APPROVE_WITH_CAP, or DECLINE on that proposal; approval/cap remains human authority | `commitment_control_decisions` |
| **Observed outcome** | Later same-workspace Recovery evidence is appended against the frozen decision | `commitment_control_reconciliations` |
| **Continuation** | The company submits a second real proposal before spend without the founder prompting that specific request | Second product proposal plus CRM `pre_spend_status=YES` |
| **Paid pilot** | Cleared ₹14,999 subscription payment | CRM `payment_received_at`; intent/invoice do not count |

## 2. Before the 20-minute working session

- Confirm the CRM row meets the public 20–100-person, India entity, recent funding, AI-native, and named-finance-owner criteria.
- Confirm the buyer described pre-spend pain and ≥₹8 lakh/month controllable exposure. Leave both blank if not confirmed.
- Require one real upcoming AI, cloud, software, contractor, or campaign commitment. Do not manufacture a demo case.
- Identify the owner/admin who can decide. A member submitting without an authorized human present cannot complete T3.
- Prepare an enrolled private workspace and policy workshop; never use the production wildcard.
- Start one stopwatch when the Control desk becomes visible. Keep private proposal contents and identities out of git, screenshots, and public notes.

## 3. Commitment Control live session (20 minutes)

| Min | Participant behavior | Founder behavior |
| ---: | --- | --- |
| 0–2 | Explain what the Control desk does in their own words | Ask “What do you think happens here?”; do not pitch |
| 2–5 | Name the real proposed obligation, its amount, currency, first charge, cadence, and purpose | Clarify facts only; label unknowns |
| 5–8 | Record policy version 1 together if none exists | Explain category posture and limits; state that policy never decides |
| 8–12 | Submit the proposal and choose any existing commitments that genuinely inform exposure | Stay silent unless the journey is impossible; every intervention is a rescue |
| 12–15 | Read the assumption/evidence separation and open at least one cited receipt when exposure exists | Ask “What is evidence here, and what did you tell us?” |
| 15–18 | Owner/admin approves, caps, or declines; then explains the frozen amount/cap | Re-state that Vognary does not purchase, provision, or move money |
| 18–20 | Name the next proposal they expect and how they would route it before spend | Ask for the paid pilot only if the real behavior and ICP fit are present |

Do not guide click-by-click, rescue before about 60 seconds of genuine struggle,
pitch integrations, promise enforcement, or turn post-spend pain into a
pre-spend claim. The paid service includes founder-led setup and weekly
reconciliation; operator help is not disguised as autonomous software.

## 4. T0–T4 behavior ladder

Score each step `PASS`, `RESCUED`, `FAIL`, or `UNMEASURED`. `RESCUED` never
counts as a pass. Five independent people are required; reruns with one person
do not satisfy the gate.

| Step | Question | PASS requires |
| --- | --- | --- |
| **T0 — Pre-spend comprehension** | Do they understand the job before input? | Within about 10 seconds of seeing Control, they describe a proposed obligation reaching a named human before commitment, without reading interface copy aloud |
| **T1 — Real proposal** | Will behavior begin before spend? | They enter one real upcoming commitment that does not yet exist; a retrospective bill or hypothetical example fails |
| **T2 — Evidence boundary** | Do they distinguish fact from assumption? | They correctly identify user-entered assumptions versus cited existing exposure and open/point to cited evidence when exposure exists |
| **T3 — Human authorization** | Does the desk change or formalize a decision? | An owner/admin records approve, approve with cap, or decline and can state the frozen expected amount or frozen cap; verify the decision row |
| **T4 — Repeated habit** | Does the loop continue without founder push? | Within seven days they submit a second proposal that is real and arrives before spend, without the founder prompting that specific proposal; “useful” or naming a future idea is not enough |

Record separately:

```text
Session date / private CRM id:
Proposal created before obligation? YES / NO / UNKNOWN
Seconds Control visible → proposal submitted:
Seconds Control visible → decision recorded:
T0 / T1 / T2 / T3 / T4:
Founder rescues (exact):
Evidence opened / cited:
Decision action and whether it changed from the initial intent:
Participant's explanation of what remains frozen:
Enforcement objection? none / advisory-insufficient / money-movement-required
Next real proposal submitted unprompted at:
```

## 5. Consent-independent product verification

Use product rows for financial/authorization facts and the private CRM for
conversation, payment, and pre-spend timing. Product events are consent-gated
and cannot replace either source.

```sql
select proposal.id as proposal_id,
       proposal.created_at as proposed_at,
       proposal.merchant,
       proposal.amount_minor::text,
       proposal.currency,
       proposal.assumption_basis,
       evaluation.status as policy_status,
       evaluation.policy_version,
       decision.action,
       decision.expected_amount_minor::text,
       decision.approved_cap_minor::text,
       decision.decided_at,
       count(reconciliation.id)::int as reconciliation_count
from commitment_control_proposals proposal
join commitment_control_evaluations evaluation
  on evaluation.workspace_id = proposal.workspace_id
 and evaluation.proposal_id = proposal.id
left join commitment_control_decisions decision
  on decision.workspace_id = proposal.workspace_id
 and decision.proposal_id = proposal.id
left join commitment_control_reconciliations reconciliation
  on reconciliation.workspace_id = proposal.workspace_id
 and reconciliation.proposal_id = proposal.id
where proposal.workspace_id = '<session-workspace-uuid>'::uuid
group by proposal.id, evaluation.id, decision.id
order by proposal.created_at;
```

Never infer pre-spend timing from `first_charge_date`. Compare product
`created_at` with the buyer-confirmed obligation creation time in the private
CRM; classify `UNKNOWN` when that time is unavailable.

## 6. Session note and WTP record

Append one redacted block to the gitignored Commitment Control CRM on the same
day:

```text
Session: <date> <private CRM id>
Last real commitment described: <date / amount / currency or UNMEASURED>
Pain class: PRE_SPEND / POST_SPEND / BOTH / NONE
Steps completed: policy → proposal → evidence → decision → cap → outcome(if later)
Hesitations/questions (short, verbatim):
Founder rescues:
Value moment (behavior or exact words):
Initial intended decision → recorded decision:
Enforcement objection:
Offer made? yes/no  Invoice sent? yes/no  Payment cleared? yes/no
Classification: BUG / UX-FRICTION / COPY / TRUST / ICP-MISMATCH / NO-PAIN / POST-SPEND-ONLY / PRICE / NEEDS-ENFORCEMENT
Next action:
```

WTP ladder remains strict: `INTEREST` (asks about price), `INTENT` (written
would-pay), `COMMITMENT` (specific invoice path), `PAYMENT` (cleared funds).
Only `PAYMENT` satisfies the paid gate.

## 7. What session evidence may authorize

- Before the first cleared payment: only money-wrong, trust-broken, security, privacy, or journey-impossible fixes. No new feature work.
- A `FAIL` or `RESCUED` result in at least 2 of 5 sessions identifies a repeated problem; it does not automatically authorize the buyer's requested feature.
- T0–T3 should each pass in at least 4 of 5 sessions. T4 is observed over seven days and should pass in at least 2 of 5 before treating the habit as promising.
- After the first cleared payment, the aggregate reconciliation read model may enter review only if a real pilot needs multiple observations compared with a period cap. It is not pre-authorized work.
- If fewer than half of proposals arrive before spend or 30 proposals change zero decisions, apply THE-LAW's rework/kill gate. Do not rescue the thesis with integrations.

## 8. Ten-day session scoreboard

```text
Publicly qualified targets: <n>  Contacted: <n>  Conversations: <n>
Pre-spend pain: <n>  Post-spend-only pain: <n>  Working sessions: <n>
Explicit ₹14,999 offers: <n>  Invoices: <n>  Cleared payments: <n>
Real proposals: <n>  Pre-spend YES / NO / UNKNOWN: <n>/<n>/<n>
Decisions recorded: <n>  Capped/declined/materially changed: <n>
T0/T1/T2/T3/T4 PASS counts: <n>/<n>/<n>/<n>/<n>
Founder-rescue rate: <rescues / sessions>
Top pain-class result: <one line>  Top trust blocker: <one line>
```

## Historical Recovery instrument — superseded 2026-08-25

The material below preserves the previous bills/renewals first-user instrument
for audit history. It is not the live Commitment Control discovery script,
session packet, T0–T4 ladder, CRM, or product gate.

## 1. Encoded milestones (four different things — never collapse them)

`workspace.activated` is **strict**: it requires a recurring-spend picture
(`hasCitedRecurringSpendPicture` = active commitments **and** non-empty monthly
totals; `countsTowardMonthly` excludes `PROVISIONAL_RISK_TAG`). Verified
empirically 2026-08-22 on a disposable workspace: three distinct vendors, one
receipt each → 3 cited decision cards, `monthlyTotals.length = 0`, activation
route outcome = `deferred-no-picture`. A user can complete a genuinely useful
first session (paste 2–5 bills, read cards, Keep / Review later / Plan to
cancel) and still never register as activated.

Therefore the first-10 scoreboard reports FOUR separate milestones:

| Milestone | Truthful definition | How measured today |
| --- | --- | --- |
| **First value** | The user's own submitted evidence produced ≥1 cited decision card AND the user recorded ≥1 decision (Keep / Review later / Plan to cancel) on it | Source of truth: `recovery_decision_cycles` has ≥1 row for the workspace whose commitment links to user-submitted evidence. Consented workspaces also emit `review.action_recorded`; no-consent workspaces still count from the cycle row, never from missing telemetry. |
| **Strict recurring picture** (`workspace.activated`) | Consent-gated, insert-once event after the cited *cadence-established* monthly picture renders (`activation_semantic_version = 1`, `secondsToTrustworthyPicture` metric) | Existing `product_events` row. Do NOT bump the semantic version without both-agent review + real evidence that the definition is wrong |
| **Activation (first-10 headline)** | First value — the minimum honest "a stranger reached trustworthy value unaided" bar for this mission | Reported next to strict numbers, always labeled separately |
| **Return** | Second authenticated session with ≥1 new evidence or decision action | `workspace.returned` / new cycle rows after first value |

Anti-goals (unchanged): signup is not activation; a rendered card nobody acted
on is not first value; `deferred-no-consent` is a consent gap, not product
failure — record it separately; a compliment is not willingness to pay.

## 2. Funnel queries (run on production Postgres; read-only)

Consented events only exist in `product_events`. Pre-auth steps (landing view,
sign-in start) are deliberately unmeasured today; do not infer them.

```sql
-- Funnel counts (all time; add occurred_at bounds for weekly)
select event_name, count(*) as events, count(distinct workspace_id) as workspaces
from product_events
where event_name in (
  'receipt_setup.started', 'receipt_setup.completed', 'receipt_forwarding.verified',
  'receipt_backfill.completed', 'commitments.detected', 'ledger.viewed',
  'workspace.activated', 'workspace.returned', 'review.action_recorded',
  'correction.recorded', 'mandate.signed'
)
group by event_name
order by event_name;

-- Median seconds to trustworthy picture among activated workspaces
select percentile_cont(0.5) within group (order by (metrics->>'secondsToTrustworthyPicture')::numeric) as median_s,
       count(*) as n
from product_events
where event_name = 'workspace.activated'
  and activation_semantic_version = 1
  and metrics ? 'secondsToTrustworthyPicture';

-- Drop diagnosis: workspaces with detected commitments but no activation
select w.id, w.name, max(pe.occurred_at) as last_event
from workspaces w
join product_events pe on pe.workspace_id = w.id and pe.event_name = 'commitments.detected'
where not exists (
  select 1 from product_events a
  where a.workspace_id = w.id and a.event_name = 'workspace.activated'
)
group by w.id, w.name;
```

**T3 / First value — consent-independent (use this one during sessions).**
`product_events` is consent-gated, so a no-consent workspace can reach real
first value and emit nothing. §1 makes `recovery_decision_cycles` the source of
truth; this is that query. Run it after each session against the session's
workspace:

```sql
-- First value for one session workspace: submitted evidence -> linked commitment -> decision
select w.id,
       w.name,
       w.created_at,
       count(distinct e.id) filter (
         where source.source_type in ('RECEIPT_PASTE', 'CSV_IMPORT')
       )                                                 as submitted_evidence_rows,
       count(distinct c.id) filter (
         where source.source_type in ('RECEIPT_PASTE', 'CSV_IMPORT')
       )                                                 as commitments_from_submitted_evidence,
       count(distinct d.id) filter (
         where source.source_type in ('RECEIPT_PASTE', 'CSV_IMPORT')
       )                                                 as decisions_on_submitted_evidence,
       min(d.decided_at) filter (
         where source.source_type in ('RECEIPT_PASTE', 'CSV_IMPORT')
       )                                                 as first_decision_at,
       extract(epoch from (
         min(d.decided_at) filter (
           where source.source_type in ('RECEIPT_PASTE', 'CSV_IMPORT')
         ) - w.created_at
       ))::int                                           as seconds_workspace_to_decision,
       count(distinct d.id) filter (
         where source.source_type in ('RECEIPT_PASTE', 'CSV_IMPORT')
       ) > 0                                             as first_value
from workspaces w
left join recovery_commitments c      on c.workspace_id = w.id
left join recovery_commitment_evidence link
  on link.workspace_id = c.workspace_id and link.commitment_id = c.id
left join recovery_evidence e
  on e.workspace_id = link.workspace_id and e.id = link.evidence_id
left join recovery_sources source
  on source.workspace_id = e.workspace_id and source.id = e.source_id
left join recovery_decision_cycles d
  on d.workspace_id = c.workspace_id and d.commitment_id = c.id
where w.id = '<session-workspace-uuid>'::uuid
group by w.id, w.name, w.created_at
order by w.created_at desc;
```

`seconds_workspace_to_decision` measures workspace creation → decision, **not**
landing → decision. It may understate a new user's session by omitting pre-signup
time or greatly overstate a returning workspace. Treat it as diagnosis only;
only the stopwatch in §9 produces time-to-first-decision.

Founder-rescue rate is manual: count sessions where you had to intervene (see §3 log).

## 3. Per-user observation log (append to gitignored CRM notes, same day)

One block per observed session, appended to the user's row notes in
`private-autopilot-pilot-crm.csv`. Classification vocabulary is closed:

```text
Session: <date> <user id>
Steps completed: landing → sign-in → bills added → decisions → sources
Hesitations/questions: <verbatim, short>
Founder explanations needed: <list>          ← each one is a founder rescue
Errors seen: <exact text/screenshot ref>
Value moment: <what they read aloud / reacted to>
Useful? honest/useful-not-yet/not useful
Returned without reminder? yes/no/unmeasured
Classification(s): BUG | UX-FRICTION | COPY | TRUST | MISSING-EXPECTATION | MISSING-CAPABILITY | ICP-MISMATCH | NOT-A-PROBLEM
Evidence class: behavior > statement > request   (record which one you have)
Next action:
```

Do not implement a classified item on first sighting unless severity is P0/P1
(money wrong, trust broken, journey impossible). Repeated (≥2 independent users)
or high-severity items go through the Phase-N gate: frequency · severity · ICP
relevance · activation impact · retention impact · revenue impact · strategic
fit · implementation cost. Fix the underlying job, not the literal request.

## 4. Value-proof record (per activated user)

```text
What Vognary showed: <the exact sentence/card they saw>
New information to them? yes/no/partially — their words:
Trusted? (asked "how do you know?") reaction:
Changed an action/decision? what:
Would they miss it? (only answerable at removal/renewal time — leave blank until then)
```

## 5. Willingness-to-pay ladder (separate levels; never merge)

| Level | Counts only when |
| --- | --- |
| INTEREST | Unprompted question about price/availability of paid tier |
| INTENT | Written statement they would pay X (record date + quote). Does NOT satisfy any paid gate |
| COMMITMENT | Agreed to a specific price/invoice path |
| PAYMENT | Money received (`actual_payment_at` in the CRM; the only paid-gate row) |

"Sounds cool", thanks, likes, and feature praise are **not** evidence at any level.

## 6. Session scoreboard (copy into CONTINUE-HERE updates)

Milestone ladder — each row is its own event; never convert one into the next:

```text
Qualified prospects: <n or UNKNOWN> | Contacted: <n> | Responded: <n>
Live conversations: <n> | Started Vognary: <n> | Evidence submitted: <n>
First value (decision recorded on own-evidence card): <n>
Recurring picture established (workspace.activated, strict): <n>
Returned without reminder: <n> | WTP signal (INTENT+): <n> | Paid: <n>
Median time-to-first-value: UNMEASURED until n≥1
Founder-rescue rate: <rescues / sessions>
Top activation blocker: <one line> | Top trust blocker: <one line>
```

## 7. Automatic-receipt proof packet (AI-prepared; production evidence pending)

Code path is complete and verified on this checkout: signed Resend inbound →
alias resolution → MIME parse → sender provenance → materialize →
`submitRecoveryEvidence` acceptance auto-stamps `setup_completed_at`,
`forwarding_verified_at` (when Google verification was received),
`backfill_completed_at`, and fires `receipt_setup.completed` /
`receipt_forwarding.verified` / `commitments.detected`
(`src/lib/server/recovery-store.ts:553-619`). Nothing needs to ship.

### What AI can verify WITHOUT production evidence (done)

- Unsigned inbound returns 401 (verified live 2026-08-22).
- Acceptance/milestone SQL logic covered by disposable-PostgreSQL suite.
- Parser accepts real billing formats incl. unknown vendors (unit-tested).

### Founder actions that unblock proof (exact order)

1. Confirm Google's forwarded-address verification for the v1 alias (Google's
   confirmation mail was parsed 2026-08-18; URL stored; Sources shows the CTA).
2. Create ONE Gmail filter: matches billing senders → forward to the private
   alias. Global auto-forward stays OFF.
3. Do not send a manual receipt "to test" — a mock/manual paste is NOT proof.

### Expected DB/events per step (verification checklist)

| Step | Expected state |
| --- | --- |
| Filter created, no mail yet | alias row unchanged: `gmail_verification_received_at` set, `forwarding_verified_at` null |
| First automatic receipt arrives | inbound event ACCEPTED; evidence row(s) with source kind forwarding; commitment created/updated; `forwarding_verified_at` set once (`greatest(accepted_at, created_at)`); events `receipt_setup.completed` + `receipt_forwarding.verified`; Home shows cited card |
| Second matching receipt (untouched) | same commitment gains second dated observation; provisional card firms up; next-cycle expectation armed |
| Failure modes | unsigned/unknown alias → 401/IGNORED (no evidence); MIME invalid → lease released+retry then REJECTED; provenance weak → evidence kept, trust tier caps assertion (never blocks ingestion); duplicate → idempotency CONFLICT guarded |

Success criteria (mission law): ONE automatic receipt proves ingestion. A
SECOND untouched matching receipt begins to prove keep-current. Telemetry:
run §2 funnel queries filtered to the workspace after each step.

## 8. First live-user session packet (20 minutes, ~3 real bills)

### BEFORE

- Production healthy (`/api/health`, `/start` reachable); dev not required.
- You can sign in via Google OAuth beforehand so their wait is short.
- CRM row ready with consent question script (phase-a §5) if they agree.
- Know the honest boundaries: Vognary never cancels anything and never moves money.

### SESSION TARGET

Ask them to add 2–3 REAL bills they already have (paste or PDF). Then be quiet.

### OBSERVE (write down what happens, not what it means)

1. Did they understand the promise before adding anything?
2. Where did they hesitate or ask a question?
3. Any step where they could not continue without your help? (founder rescue)
4. Did they open the cited receipt? What did they say about it?
5. Did Vognary tell them something they didn't know? Exact reaction.
6. Did they understand the Keep / Review later / Plan to cancel choice?
7. Would they naturally come back — what would make them?

### DO NOT

- Guide click-by-click; explain failures away; pitch future features;
  rescue before ~60 seconds of struggle; mention Autopilot/cancellation.

### AFTER (same day)

- Fill §3 observation log in the gitignored CRM notes.
- Record first value strictly per §1 (cycle row exists?), founder rescues, WTP level per §5.
- Score T0–T4 per §9. Five scored sessions are the P1 unlock gate.

## 9. T0–T4 session gate (the P1 unlock criterion)

`docs/CONTINUE-HERE.md` and `scoreboard.md` require "five T0–T4 sessions"
before P1 reopens, but the ladder was never written down, so the freeze had no
objective exit. Defined here, **derived** from the four items CONTINUE-HERE
names as unproven — human comprehension, time-to-first-decision, trust, and
preference for the light visual direction — plus First value from §1. No new
metric is invented; every row is observable in one session.

Score each step **PASS** / **RESCUED** / **FAIL**. `RESCUED` means they could
not continue without you (§3 founder rescue) — never score it as a pass.

| Step | Question it answers | PASS requires (behavior, not agreement) |
| --- | --- | --- |
| **T0** Comprehension | Does the promise land before any input? | Within ~10s of the landing, unaided and unprompted, they say what Vognary does in their own words, naming renewal/upcoming charges *and* deciding. Reading the H1 aloud is not a pass |
| **T1** Own evidence | Can a stranger get their real bill in? | They add ≥1 of **their own** real bills via `/start` with no click-by-click guidance |
| **T2** Cited trust | Is the evidence believed? | Unprompted, they open or point at the cited receipt, or ask "how do you know?" and are satisfied by the citation. Silence is not a pass |
| **T3** Decision (**= First value**, §1) | Do they act before the charge? | They record Keep / Review later / Plan to cancel on their own-evidence card. Verify the `recovery_decision_cycles` row exists — do not score from telemetry |
| **T4** Continuation | Do they want the loop after first value? | Without a founder pitch, they ask how Vognary stays current, add a second evidence batch, open Sources, or begin the private billing-forwarding setup. Saying “useful” without continuation behavior is a FAIL |

**Also record, once per session:**

```text
Seconds landing → T3               <n>   ← the only time-to-first-decision number
Memory check, asked after T3: "what happens next?" <verbatim>  ← record whether
  they name the frozen amount/date or next matching receipt; "it reminds me" is insufficient
Visual direction, asked only at the end: "does this look like something you'd
  put a card behind?"  <verbatim>       ← statement-class evidence (§3), weakest
  tier; never let it outrank a T0–T4 behavior
Founder rescues: <n>   Errors seen: <exact text>   Useful? honest/useful-not-yet/not useful
```

### What the five sessions are allowed to authorize

After **five** independent scored sessions (not five reruns with one person):

- A step scoring `FAIL` or `RESCUED` in **≥2 of 5** sessions is a real defect.
  It enters the existing Phase-N gate in §3 — it does **not** auto-authorize a
  build.
- One person's dislike authorizes nothing. Fix the underlying job, not the
  literal request (§3).
- Visual/aesthetic preference alone never authorizes a design pass. Only a
  T0/T2 behavioral failure can, and then only the specific surface that failed.
- If T0–T3 each pass in **≥4 of 5**, T4 passes in **≥2 of 5**, and no
  money/trust P0 appears, the first-session presentation is not the constraint
  and the bounded retention P1 may enter the existing Phase-N gate. This is
  eligibility to evaluate P1, not automatic permission to implement every
  documented item.
- If T0–T3 pass but T4 fails in 4 or 5 sessions, do not build notification or
  verdict delivery. Investigate why the ongoing evidence loop is unwanted.
