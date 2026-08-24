# First-10 users — operating runbook (activation, funnel, observation, value, WTP)

> **Parent law:** [`docs/THE-LAW.md`](../THE-LAW.md) · Live state: [`docs/CONTINUE-HERE.md`](../CONTINUE-HERE.md)
> Purpose: run the first 10 qualified users professionally. This is an operating runbook, not a plan.
> Interview script lives in [`phase-a-market-contact.md`](phase-a-market-contact.md) §9 (do not duplicate it here).
> Rule that binds every field below: never invent a value; empty means unmeasured.

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
