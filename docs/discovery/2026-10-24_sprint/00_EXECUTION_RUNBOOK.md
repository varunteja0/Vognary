# Execution runbook — 14-day validation

**Decision: validation only. No build, no pivot, no launch before G1.**

Inspection time: **2026-10-24 14:44 IST**. Workspace: `/Users/varunteja/Desktop/CVT Group/Vognary`. Branch: `main`. HEAD: `3604496af496891db5ecc68de29f602ea6fc775b` (2026-09-10, "fix: publish local launch repairs and lifecycle updates"). This matches the handoff.

Worktree before this packet: untracked `docs/strategy/` and untracked `research/`. No product files were modified. After this packet, the only new tree is `docs/discovery/2026-10-24_sprint/` plus short dated addenda under `docs/strategy/vognary_2026-10-24/`. `research/` was not edited.

## 1. Repository truth

| Claim in the handoff | What this inspection found | Label |
| --- | --- | --- |
| Stage is "Make it work" | [`docs/THE-LAW.md`](../../THE-LAW.md) and [`docs/CONTINUE-HERE.md`](../../CONTINUE-HERE.md) still say so. No paid Control pilot is recorded | FACT |
| Business validation 1.5, 0 conversations, 0 payments | [`docs/execution/scoreboard.md`](../../execution/scoreboard.md), business-validation row dated 2026-09-02. Not re-counted from the private CRM | FACT as of that file. UNKNOWN after 2026-09-09 |
| Product code unchanged for the strategy | Confirmed. `git status` shows no tracked source edits | FACT |
| Control loop exists | `src/lib/commitment-control/`, desk under `src/app/workspace/recovery/control/`, routes under `src/app/api/workspaces/current/control/` | FACT |
| Price ₹14,999 one-time | `src/lib/pilot-offer.ts` (`amountMinor` 1499900, terms `terms-2026-09-01`). `/pay` copy says the same and renders "ONLINE COLLECTION NOT CONFIGURED" when the payment link is unavailable | FACT in source |
| Collection needs env, not a code change | `getPilotPaymentLink()` in `src/lib/pilot-payment-link.ts` returns unavailable unless `COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_MODE` is exactly `one-time` and a verified Razorpay URL record matches the offer. Env values were not printed | FACT |
| Autopilot, connectors, checkout retired or off | Autopilot execution requires the literal env `true`. Legacy connectors return 410. `POST /api/checkout` is retired in source. Live checkout was 410 on 2026-10-24 in the prior review. Not re-requested this sprint | FACT in source |
| Anonymous audit is 403 in source | `tests/audit-route.test.ts` and `tests/financial-intake.test.ts`: 27/27 passed locally on 2026-10-24 with Node 22.23.2. Uncleared receipt text returns `FINANCIAL_INTAKE_LOCKED` | FACT for this tree |
| Production returned 200 on 2026-10-24 | Recorded in [`01_AS_BUILT_VS_AS_PROMISED.md`](../../strategy/vognary_2026-10-24/01_AS_BUILT_VS_AS_PROMISED.md) from a prior session. **This sprint did not call production.** Deployed SHA is UNKNOWN | Prior observation, not re-verified today |
| `/start` invites a paste | `src/app/start/start-client.tsx` still says "Upload or paste a bill." Live `/start` text was read on 2026-10-24 in the prior session | FACT in source |

**Gate-name conflict, do not erase.** The strategy pack called the 2026-11-07 conversation test **G0** and the pilot month **G1**. This runbook follows the execution brief and calls the conversation test **G1**. They are the same four conditions. THE-LAW §0.1 still has a different commercial gate (offers and two payments). This sprint does not replace THE-LAW. A pass on G1 is permission to design a pilot, not proof of a company. See the addendum in [`11_DECISION_LOG.md`](../../strategy/vognary_2026-10-24/11_DECISION_LOG.md).

## 2. What the agent finished, and what only the founder can do

| ID | Status | Meaning |
| --- | --- | --- |
| Repo audit, local intake tests, source read of pay/audit/start | AGENT COMPLETED | This file and `10_PRODUCTION_SAFETY_BLOCKER.md` |
| Competitive source ledger | AGENT COMPLETED | `05_COMPETITIVE_GAP_AND_SOURCE_LEDGER.md`. Verdict: **hypothesis narrows**. Demand is not validated |
| Target matrix and unsent drafts | AGENT COMPLETED | `06_TARGETS_AND_OUTREACH.md`. Status on every row: `NOT CONTACTED` |
| Script, empty ledger, blank gate memo, pilot protocol | AGENT COMPLETED | Files 07, 08, 09, 11 |
| Sending, booking, interviewing, scoring G1 | FOUNDER ACTION | Not started. The agent must not mark these done |
| Production fix, payment enablement, assessment | BLOCKED | Separate written authorization. Not this sprint |

## 3. Calendar

Owner of every founder row: the founder. Timeboxes assume one person. Do not invent a booking to fill a day.

### 2026-10-24 — prep

| | |
| --- | --- |
| Status | AGENT COMPLETED for documents. FOUNDER ACTION to read them |
| Timebox | 90 minutes of founder reading |
| Output | Founder has read this runbook, the safety blocker, and the target file |
| Acceptance | Founder can say which of the eight targets are in the 15–80 band before any send |
| Blocker | Several headcounts conflict across public sources. Drop a row rather than guess |

### 2026-10-25 — first sends

| | |
| --- | --- |
| Status | FOUNDER ACTION. NOT STARTED |
| Timebox | 2 hours |
| Output | First approved batch sent only to rows the founder has personally confirmed. Update each row from `NOT CONTACTED` to `SENT` with the date. Do not log a reply that has not arrived |
| Acceptance | At least four sends or warm-intro asks, using the drafts, with the research sentence and no product pitch. Zero sends to a company whose size is still an unresolved conflict |
| Dependency | Founder approval of the exact text. The drafts are not pre-authorised |

### 2026-10-26 (Sunday)

No sends required. If a reply arrives, answer with the calendar blurb and put the call on a weekday. Log the reply the same day. Do not count a reply as a completed conversation.

### 2026-10-27 through 2026-10-31 — interviews

| | |
| --- | --- |
| Status | NOT STARTED |
| Aim | About two completed approver conversations per weekday **if** people accept. A shortfall is data, not a reason to lower the bar |
| Timebox | 45 minutes per call plus 20 minutes the same day on the ledger |
| Output | One ledger row per completed call in `08_EVIDENCE_LEDGER.csv`. Quote the workflow. Leave price blank if it was not reached |
| Acceptance | The row names whether the person can approve the bill. Advisers go in the notes and do not count toward five |
| Blocker | Do not ask anyone to paste a live bill. Words and ranges only |

### 2026-11-01 and 2026-11-02 (weekend)

Same rule as 2026-10-26. Catch up on ledger rows. Do not decide.

### 2026-11-03 — preliminary read

| | |
| --- | --- |
| Status | NOT STARTED |
| Timebox | 90 minutes |
| Output | A private note: how many completed approver calls, how many pre-spend, how many priced, what substitute they named. Title it preliminary |
| Acceptance | The note does not say pass or fail. It lists who is still unbooked |
| Dependency | Ledger rows, not memory |

### 2026-11-04 and 2026-11-05

Last interview days. One polite follow-up only to people who were already sent the first message and have not replied. No third chase. No new segment.

### 2026-11-06 — freeze

| | |
| --- | --- |
| Status | NOT STARTED |
| Timebox | 60 minutes |
| Output | Ledger frozen. Copy the blank memo in `09_GATE_MEMO_TEMPLATE.md` and fill counts from the CSV only |
| Acceptance | Every counted conversation has a same-day row. Missing fields stay blank. The founder writes which of the four bars are already missed |
| Reminder of the bar | 5 approver conversations, 3 pre-spend, 2 priced or explicitly discussing ₹14,999 as plausible, 1 next pilot conversation after the data boundary |

### 2026-11-07 — G1

| | |
| --- | --- |
| Status | NOT STARTED. No result exists today |
| Timebox | 60 minutes |
| Output | The memo marked PASS or FAIL, dated, with the four counts |
| If PASS | Do not write code the same day. Open the safety blocker and the pilot protocol. Real bills stay forbidden until that blocker is closed by a separate decision |
| If FAIL | Stop Commitment Control investment. Do not start another product the same week. Record the result in the decision log |
| Acceptance | A stranger can recompute the result from the CSV |

## 4. First founder actions, in order

1. Read `10_PRODUCTION_SAFETY_BLOCKER.md`. Do not send anyone to `/start` with a real bill.
2. In `06_TARGETS_AND_OUTREACH.md`, strike every company whose public size is outside 15–80 or still conflicting. Keep at least the rows you can defend.
3. Send the first message only after that cut. Copy is in that file, labelled `READY TO SEND — NOT SENT`.
4. After each call, append one CSV row the same day.
5. On 2026-11-07, fill the gate memo from the CSV and stop or continue under the rule. Do not improvise a new market.

## 5. Where the rest of the packet lives

| File | Use |
| --- | --- |
| `05_COMPETITIVE_GAP_AND_SOURCE_LEDGER.md` | What to believe about substitutes |
| `06_TARGETS_AND_OUTREACH.md` | Who might be reachable, and the unsent words |
| `07_INTERVIEW_SCRIPT.md` | The call |
| `08_EVIDENCE_LEDGER.csv` | Empty on purpose |
| `08_EVIDENCE_LEDGER_GUIDE.md` | How to fill a row |
| `09_GATE_MEMO_TEMPLATE.md` | Blank until 2026-11-07 |
| `10_PRODUCTION_SAFETY_BLOCKER.md` | Why real bills are off |
| `11_CONCIERGE_PILOT_PROTOCOL.md` | Used only after a pass and a separate safety close |

Strategy history stays in `docs/strategy/vognary_2026-10-24/`. This packet does not replace it.
