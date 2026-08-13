# Ultimate closeout run — craft 10/10 + company floor exit

> **Historical; retired by the 2026-08-13 autopilot pivot.**
> Do not execute this packet. Live instructions are [`docs/THE-LAW.md`](../THE-LAW.md), [`docs/CONTINUE-HERE.md`](../CONTINUE-HERE.md), and WP-A through WP-E in [`docs/execution/phase-b-loop-shipping.md`](../execution/phase-b-loop-shipping.md). Preserve the measured closeout facts below; do not rewrite them as new pilot evidence.

> **Parent law:** [`docs/THE-LAW.md`](../THE-LAW.md)  
> **Live state:** [`docs/CONTINUE-HERE.md`](../CONTINUE-HERE.md)  
> **Prior packet:** [`pre-public-retention-wp.md`](pre-public-retention-wp.md)  
> **This file is execution, not a new strategy.**

## 0. Honesty gate (read before you paste any prompt)

| Claim | Possible in one GPT session? |
| --- | --- |
| Code / UX craft of the loop → **10/10** | **Yes**, if the agent finishes every WP below with green gates |
| Company composite (min-row) → **10/10** | **No** — needs real humans, pay, corpus, live rails proof over days/weeks |
| Business validation → **10/10** | **No** without ≥10 connected+mandate autopilot pilots + paid signal (founder) |
| “Users love it / best in market / PMF” | **Forbidden** until measured |

**What this run *can* deliver if executed fully:**

1. **Product craft 10/10** on the evidence → insight → decide → re-check loop (user perspective).  
2. **Activation honesty 10/10** (nothing claimed that is not proven).  
3. **Company floor exit from 1.5** toward Day-30 metrics **only if founder completes the human gates inside the same run**.  
4. A product that is **the best honest version of Vognary**, not a fake Rocket Money.

**What “10/10 ultimate” means in this document (definition of done):**

| Dimension | 10/10 definition for THIS run |
| --- | --- |
| Niche / direction | One job, one story, India-first, cite-or-shut-up |
| USP felt | Proof beside every rupee; changed-since; no bank theater |
| Weak diffs removed | No redaction-first leak; no empty after save; no inbox overclaim |
| MVP | Cold path: sign-in → 2 matching receipts → burn + next + decision + WhatsApp &lt;3 min **human-timed** |
| Why sign up | Clear outcome before friction piles up; private-audit escape hatch |
| Retention design | Changed-since + re-check coach + inbox-when-ready + reminder path proven or unclaimed |
| FE quality | One IA; mobile e2e; axe clean; progressive disclosure |
| BE quality | Gates green; Recovery integrity; fail-closed readiness |
| Business | CRM has real audits OR run stops at FOUNDER BLOCK (no fake rows) |
| Public launch | GO only if Phase 10 + THE-LAW Day-21 metrics met |

If founder blocks are incomplete, the agent’s honest end state is:  
**Craft 10/10 · Company BLOCKED · Public NO-GO** — still a valid complete run.

---

## 1. Master checklist (nothing missing)

### A. Defects from last critic (must close — code)

| ID | Item | Done when |
| --- | --- | --- |
| D1 | Landing “Your data” removes **redaction-first source plan** for self-serve Recovery | Copy is bank/mailbox honesty only |
| D2 | FirstObservationHome shows **saved facts** (merchant/amount/date when published) + second-receipt coach | User never wonders “did it save?” |
| D3 | Share/WhatsApp on first-observation (honest: observations checked, not recurring burn) | Copy does not invent cadence |
| D4 | Empty Home three-step + manual CTA → paste is one obvious path | No dead ends |
| D5 | Inbox UI **only** when `isReceiptInboxPubliclyAvailable()` true | Fail-closed everywhere: landing, home, sources, claims |
| D6 | Login subcopy matches one product story | Same language as landing/home |
| D7 | Private-audit remains secondary CTA only | No second hero product |
| D8 | Claims:check + no unlabeled personal sample totals | Green |
| D9 | Multi-currency never FX-combined in UI or share | Tests assert |
| D10 | Decision save works on first recurring commitment | E2E |

### B. User-perspective pain killers (must ship — code)

| ID | Pain | Fix |
| --- | --- | --- |
| U1 | Time-to-value | Guided paste; seen-once with proof; second receipt unlocks burn/next/action |
| U2 | Feels like another tracker | Proof chips, inspect evidence, floor coverage, changed-since hero |
| U3 | Spreadsheet good enough | Stale-sheet copy + real change list with provenance |
| U4 | Cognitive overload | First session: totals → changed/coach → attention → next → share; advanced later |
| U5 | “Feifei tax” (tool to manage tools) | One screen job; cancel = plan-to-cancel + evidence, not fake cancel-for-you |
| U6 | India | ₹ format, separate FX, UPI/statement language only where engines support |
| U7 | Trust | Never claim bank/UPI/Gmail/inbox/reminders/paid unless proven |
| U8 | Return visit | Re-check empty/full states; reminder prefs honest |

### C. Differentiators (force into product, not deck)

| Real (amplify) | Weak (kill from copy) |
| --- | --- |
| Cite-or-shut-up / proof graph | “AI money OS” without key |
| Changed-since last visit | “Find all subscriptions” |
| Honest incomplete coverage | Fake bank link |
| Decision + outcome path | Cancel-for-you |
| India rails literacy where evidence exists | US Rocket Money clone story |
| Neutral (no lending) | CRED-shaped rewards |

### D. Correct MVP surface (single path)

```
Landing (one job)
  → Login Google (or dev login only in non-prod)
  → Empty Home (manual or inbox-if-ready)
  → Add evidence (3 steps)
  → Seen once (proof of save) OR Home with burn/attention/next/changed
  → Inspect evidence → Decide keep/monitor/cancel/investigate
  → Copy for WhatsApp
  → Later: add receipt → Changed since last visit
  → Optional: private-audit for done-for-you
```

No guest demo that pretends to be the user’s money. Sample only if labeled.

### E. Retention system (code + founder proof)

| Layer | Code | Founder proof |
| --- | --- | --- |
| Passive in | Inbox when ready | One signed event, replay, retention |
| Habit | Changed-since + re-check coach | Human returns day 2 with new receipt |
| Nudge | Reminder prefs + templates PII-safe | One real email + disable works |
| Outcome | Decision persisted | User quotes value |
| Re-audit | Share + report fields for CRM | 5–10 audits logged |

### F. Frontend / backend quality bar

```bash
npm run lint && npm run typecheck && npm run claims:check && npm run tokens:check && npm test
npm run build && npm run perf:budget
# Recovery + Customer #0 + first-value + landing e2e desktop+mobile as applicable
```

- No serious/critical axe on Recovery paths  
- Prefer `src/app/workspace/recovery/**` — do not grow monolith  
- Engine money changes: failing test first  

### G. Business floor (founder — cannot be invented)

| Metric | Target this run | Source |
| --- | --- | --- |
| Real audits completed | ≥5 private batch; 10 for public GO | CRM |
| Surprise rate | ≥50% with verbatim quote | CRM |
| Human TTI median | &lt;3 min | Stopwatch notes |
| Paid / hard intent | ≥1 this run; 3 for stronger GO | CRM |
| Corpus consent | ask every completed audit | CRM |
| Scoreboard update | only measured cells | scoreboard.md |

### H. Production / ops (founder)

| Item | Rule |
| --- | --- |
| Google OIDC | Works for Customer #0 |
| Receipt inbox attestations | Blank until real signed proof |
| ANTHROPIC_API_KEY | Optional; product must work without it |
| Razorpay | No checkout claim until runbook READY |
| Reminders | No “we email you” claim until one delivery |
| Deploy | Only after craft gates + founder GO for that env |

### I. Explicit non-goals (still forbidden)

- New strategy/master/leap plans  
- New connectors except Gmail/statement India path  
- Design-system rewrite  
- Fake social proof / fake users / fake paid  
- Platform sales  
- AA/Setu product ahead of provisioning  
- Claiming 10/10 company without CRM evidence  

---

## 2. Work packages for the agent (execute in order — all required)

| WP | Name | Owner | 10/10 means |
| --- | --- | --- | --- |
| **U0** | Baseline + file map + dirty tree report | Agent | Gates known; no illegal git |
| **U1** | Close D1–D10 defects | Agent | Critic cannot re-open those nits |
| **U2** | First-value UX perfection | Agent | Seen-once shows proof; 2 receipts → full home |
| **U3** | Differentiator UX | Agent | Changed-first, proof, floor, share |
| **U4** | Inbox + Sources fail-closed | Agent | Zero overclaim paths |
| **U5** | Decision + re-check + share all states | Agent | E2E green |
| **U6** | Phase A instrument polish | Agent | Report/CRM fields ready; no fake rows |
| **U7** | Reminder path code + tests | Agent | PII-safe; ready for founder send |
| **U8** | Full gate chain + e2e matrix | Agent | All green |
| **U9** | Runbook Phase 10 + CONTINUE-HERE truth | Agent | Status accurate |
| **F1** | Human Customer #0 | **Founder** | Timed TTI + quote |
| **F2** | Audits 2–5 (aim 10) | **Founder** | CRM complete |
| **F3** | Inbox + reminder proof or explicit unclaimed | **Founder** | Attestations honest |
| **F4** | Pay ask | **Founder** | Intent or yes logged |
| **F5** | GO/NO-GO | **Founder** | Written decision |

Agent must **stop and prompt founder** at F1–F5. Completing U0–U9 without F* is craft-complete, not company-complete.

---

## 3. Exact paste prompt for GPT (SOL)

Copy **everything** inside the fence into a fresh session. Fill the bracketed founder lines first.

```text
================================================================================
VOGNARY — ULTIMATE CLOSEOUT RUN (SOL)
You will not stop until craft acceptance is green and founder gates are either
DONE or explicitly BLOCKED with a founder action list. You may not invent users,
payments, surprise quotes, inbox READY, reminders delivered, or TTI.
================================================================================

## 0. IDENTITY AND LAW

You are SOL on Vognary.
Repo: quote paths that contain the space in "CVT Group".
Active work is isolated worktrees from `origin/main`. Recovery v1 same-checkout exception has **ended**.

Mandatory read order BEFORE any edit:
1. docs/THE-LAW.md
2. docs/CONTINUE-HERE.md
3. docs/execution/ultimate-closeout-run.md   ← THIS RUN (source of truth for scope)
4. docs/execution/pre-public-retention-wp.md
5. docs/execution/phase-a-market-contact.md
6. docs/execution/phase-b-loop-shipping.md
7. docs/execution/people-conversation-learning.md (§5–7 objections)
8. docs/execution/scoreboard.md
9. docs/production-activation-runbook.md (Phase 10)

Supreme rules:
- Composite score = MIN row. Business validation is the crisis. Do not polish theater.
- Loop only: evidence → recurring audit → brief/attention → decide → outcome with proof
- Cite-or-shut-up: deterministic engines sole money facts; LLM output without citations discarded
- India-first ₹; never invent FX
- Prefer src/app/workspace/recovery/** ; do not grow vognary-mvp-client.tsx
- Engine money changes: failing test FIRST
- Never fake READY / paid / audit-done / surprise quotes
- Forbidden: new master plans, new connectors (except Gmail/statement India path), design-system rewrite, platform sales, fake bank/UPI, cancel-for-you claims

Env truth (founder fill — do not guess):
- Google OIDC prod: [yes/no/test]
- Receipt inbox attestations: [blank / proven]   (default assume blank)
- ANTHROPIC_API_KEY: [set/not set]
- Local Postgres for e2e: [available/not]
- Public product story THIS run: software/recurring commitments from billing receipts → attention → decision. Full UPI universe is engine-capable but NOT public hero until audits demand it.

## 1. MISSION (WHAT “DONE” MEANS)

### Craft 10/10 (you own — mandatory)
Ship a user-facing Recovery product that a harsh critic cannot fault on:
- One product story (landing, login, empty home, workspace, sources)
- Time-to-value: after sign-in, user is coached to paste 2 matching receipts and sees burn + next + one decision when engine supports it
- One-receipt state shows SAVED PROOF (merchant/amount/date when published) + coach for second receipt — never silent empty, never false recurrence
- “Since your last visit” before attention when COMPARED; sheet-stale copy otherwise
- Coverage floor always honest
- Copy for WhatsApp pure projection of server Home facts (all relevant states)
- Receipt inbox UI only when isReceiptInboxPubliclyAvailable() is true
- Decisions persist; inspect exact evidence works
- No redaction-first / private-audit language on self-serve Recovery landing
- Progressive disclosure; mobile e2e; axe clean on Recovery paths
- Full gate chain green

### Company floor (founder owns — you orchestrate, never invent)
You must drive founder through F1–F5 with exact scripts. If founder is absent, end with
CRAFT COMPLETE / COMPANY BLOCKED and a 48h founder card. Do NOT mark scoreboard
business rows without measured CRM evidence.

### Public launch
GO only if Phase 10 + THE-LAW market metrics are met with real evidence.
Otherwise NO-GO written explicitly.

You are building the best honest Vognary, not a fake 10/10 company scoreboard.

## 2. USER PERSPECTIVE REQUIREMENTS (SOLVE ALL)

Implement so that from a founder’s eyes:

1. WHY SIGN UP: “I will know what renews and decide with proof — without bank login.”
2. TIME TO VALUE: median human path Get started → first evidence-backed amount or clear saved observation &lt; 3 minutes (founder measures; you make the path frictionless).
3. REAL DIFFERENTIATORS (must be unmissable in UI):
   - Proof / inspect evidence beside claims
   - Changed-since last visit
   - Honest coverage floor
   - Decision workflow (keep / review later / plan to cancel / don’t recognize)
   - Neutral (no lending/rewards)
4. WEAK DIFFERENTIATORS (delete from UI/copy if present):
   - “We find everything”
   - Bank/UPI connected theater
   - Uncited AI savings
   - Cancel-for-you
   - Generic “AI money OS”
5. CORRECT MVP: one path only (see ultimate-closeout-run.md §1D). Private audit = secondary done-for-you.
6. RETENTION DESIGN: return visit shows changes; re-check coach; reminders honest; inbox when proven.
7. FE QUALITY: one IA, clear CTAs, mobile, a11y.
8. BE QUALITY: Recovery integrity, fail-closed readiness, tests.
9. WHAT WE CAN BE: after metrics, commitment truth OS — do NOT build platform now; only leave honest hooks (export, proof, decisions).

## 3. MANDATORY DEFECT CLOSEOUT (FROM LAST CRITIC)

You MUST fix all of these; re-read code and verify each:

D1. launch-landing.tsx — remove “redaction-first source plan” from self-serve Your data when inbox off.
    Replace with: no bank passwords; no mailbox access; user chooses which billing text to add.
D2. recovery-home.tsx FirstObservationHome — when evidenceCount&gt;0 && commitmentTotal===0:
    Show what was saved if the server publishes observation/commitment-less facts available in DTOs;
    if Home DTO lacks per-observation list, extend API/projection HONESTLY to show latest saved
    evidence summaries (merchant/amount/date when present) without inventing recurrence.
    Primary CTA: Add a matching receipt.
D3. Share text for first-observation / zero-commitment state — honest lines only.
D4. Empty home → add evidence 3-step guide remains; primary CTA obvious.
D5. Thread receiptInboxPubliclyAvailable everywhere; Sources manual-only when false.
D6. login-client.tsx one story copy.
D7. Private-audit only as secondary link.
D8. claims:check green; no sample-as-personal.
D9. share-report + UI never combine currencies.
D10. E2E: two matching receipts → recurring home → decide → share.

If Home projection cannot list observations, implement the minimal Recovery read DTO + UI
needed so “did it save?” is answerable. Failing test first for any engine/API contract change.

## 4. WORK PACKAGE ORDER (DO NOT SKIP)

### U0 — Baseline
- Read law chain
- git status (report dirty files; do not destroy unrelated WIP without asking)
- Map: launch-landing, login, page.tsx, experience-client, recovery-*, share-report, inbound store, e2e
- Run lint/typecheck once; note baseline

### U1 — Defects D1–D10
- Implement completely
- Unit tests for share + home story + observation proof state
- Update Playwright Recovery / Customer #0 / states specs

### U2 — First-value perfection
- 3-step empty paste guide
- Seen-once with proof
- Two-receipt path to monthly totals / next / needs attention when engine supports
- Microcopy: one receipt ≠ pattern
- No login removal required (Google OIDC launch identity) but minimize steps after login

### U3 — Differentiator UX
- Changed section before attention when COMPARED
- Sheet-stale copy when no baseline
- Coverage floor
- Inspect evidence primary on attention/change rows
- WhatsApp share on full home + honest degrade states

### U4 — Passive path honesty
- isReceiptInboxPubliclyAvailable() gates all forward-first UI
- Landing eyebrow/body switch correctly
- loadSources skipped or safe when not public
- Never set operator attestations yourself

### U5 — Decide + return
- Decision save + labels human
- Re-check / add receipt path obvious after first session
- Reminder preferences UI honest (no “delivered” claim)

### U6 — Phase A instrument
- Ensure Recovery share + any guest/private-audit report fields support CRM:
  monthly burn, next debit, top action, coverage floor, surprise-ready bullets
- docs/execution/private-audit-crm.csv schema respected
- NEVER write audit-done/paid/surprise without founder-supplied facts

### U7 — Reminders code path
- Confirm prefs → due job → template PII-safe tests pass
- Document exact founder command/checklist to send one real reminder

### U8 — Full verification
Run and fix until green:
```
npm run lint
npm run typecheck
npm run claims:check
npm run tokens:check
npm test
npm run build
npm run perf:budget
```
Plus applicable Playwright:
- recovery-customer-zero (desktop+mobile)
- recovery-ui-home, recovery-ui-states
- first-value / landing as relevant
Use disposable Postgres when required. Clean up temp infra when done OR leave one
documented preview URL with test credentials only if founder wants it.

### U9 — Docs truth
- Update docs/CONTINUE-HERE.md only with verified code/state facts
- Update docs/execution/scoreboard.md ONLY for measured human metrics (or leave blank)
- Ensure production-activation-runbook Phase 10 still blocks public growth correctly
- Do NOT create new strategy/leap/perfection docs

### F1–F5 — FOUNDER GATES (orchestrate in chat)

After U8 green, output:

#### F1 Customer #0 script
1. Open [prod or preview URL]
2. Get started → Google (or dev login if non-prod)
3. Start stopwatch
4. Paste TWO redacted receipts same merchant + optional third
5. Stop watch at first amount OR clear saved observation proof
6. Inspect evidence → save one decision → Copy for WhatsApp
7. Founder pastes back: TTI seconds, surprise (yes/no + quote), issues

You wait for founder reply. Log into CRM only what founder provides.

#### F2 Audits 2–5
Use phase-a scripts. For each: files_received, monthly_recurring_found_inr,
avoidable, surprise_quote, paid, objection. No invented numbers.

#### F3 Inbox + reminder
If founder can: one signed inbox event proof per runbook; one reminder send+disable.
Else mark NOT CLAIMED and keep UI manual-only.

#### F4 Pay ask
After value only. ₹999 or hard intent. Razorpay claim only if READY.

#### F5 GO/NO-GO
Write decision table from Phase 10. Default NO-GO unless metrics met.

## 5. FILE OWNERSHIP MAP (single writer)

| Area | Paths |
| --- | --- |
| Landing | src/app/launch-landing.tsx, src/app/page.tsx |
| Login | src/app/login/login-client.tsx |
| App shell | src/app/app/page.tsx, experience-client.tsx |
| Recovery UI | src/app/workspace/recovery/** |
| Share | src/lib/recovery/share-report.ts |
| Recovery domain/API | src/lib/recovery/**, src/lib/server/recovery*.ts |
| Inbound readiness | src/lib/server/recovery-inbound-store.ts |
| Tests | tests/recovery-*.ts, tests/e2e/recovery-*.spec.ts, first-value/landing as needed |
| Docs | CONTINUE-HERE, scoreboard, production-activation-runbook, CRM only with evidence |

## 6. ACCEPTANCE MATRIX (ALL MUST PASS FOR CRAFT 10/10)

| # | Criterion | Proof |
| ---: | --- | --- |
| 1 | One public sentence job | Landing+login+home match |
| 2 | No redaction-first on Recovery landing | Code review + claims |
| 3 | Seen-once shows save proof + coach | Unit + e2e |
| 4 | Two matching receipts → recurring insight path | E2E Customer #0 |
| 5 | Changed-since before attention | Unit + e2e |
| 6 | Coverage floor visible | UI + share |
| 7 | WhatsApp share no FX merge no fake savings | Unit |
| 8 | Inbox fail-closed | Unit + e2e |
| 9 | Decision + inspect evidence | E2E |
| 10 | Gate chain green | CI/local log |
| 11 | Axe no serious/critical Recovery | E2E |
| 12 | Perf budget | perf:budget |
| 13 | No overclaim READY | claims:check + copy audit |
| 14 | CONTINUE-HERE accurate | Diff |
| 15 | Scoreboard human rows only if measured | Diff |

COMPANY complete only if additionally:
| 16 | ≥1 Customer #0 human timed | Founder |
| 17 | ≥5 CRM audit-done with quotes | Founder |
| 18 | Surprise ≥50% of completed | CRM |
| 19 | ≥1 pay or hard intent | CRM |
| 20 | Inbox/reminder claimed only if proven | Founder |

## 7. OUTPUT FORMAT (END OF RUN)

1. CRAFT STATUS: 10/10 COMPLETE | INCOMPLETE (list gaps)
2. COMPANY STATUS: FLOOR EXIT PROGRESS | BLOCKED (list F gates)
3. PUBLIC LAUNCH: GO | NO-GO (evidence)
4. WP table U0–U9 and F1–F5 with status
5. Files changed
6. Gate command transcripts (pass/fail)
7. Exact remaining founder actions (if any) — numbered, &lt;48h
8. Forbidden claims list (still true)
9. What user can do now that they could not before (3 bullets max)

## 8. BEHAVIOR RULES

- If blocked on founder, do not idle inventing features — finish all code WPs first, then wait.
- If tests fail, fix root cause; do not disable tests or weaken honesty.
- If scope creeps to platform/AA/design rewrite, REFUSE and stay on loop.
- Prefer small pure functions + tests over giant refactors.
- Do not declare “ultimate product / users love us / 10/10 company” without matrix 16–20.
- Your job is to make a critic unable to re-open D1–D10 or craft matrix 1–15.

## 9. START NOW

Begin U0. Then U1–U9 without asking for permission on loop-scoped fixes.
Surface founder F1 prompt as soon as U8 is green.
================================================================================
```

---

## 4. What YOU fill before pasting

```text
Git: You MAY commit on recovery/v1 when U8 is green.
Google OIDC prod: [yes/no]
Receipt inbox attestations: blank
ANTHROPIC_API_KEY: [set/not set]
Local Postgres: [yes/no]
I (founder) will stay available for F1–F5 in this chat: [yes/no]
```

If you will **not** stay for F1–F5, add:

```text
Founder offline: finish craft 10/10 only. End COMPANY BLOCKED with 48h card. Do not invent CRM.
```

---

## 5. Why a critic can still “point at something” after craft-only

| If only code runs | Critic will still say |
| --- | --- |
| 0 real audits | Business 1.5 |
| No human TTI | UX score not 10 as company metric |
| No inbox event | Retention unproven |
| No pay | No PMF |

That is **correct**. The prompt forces the model not to lie about it.  
**Fate change** = craft perfection **plus** you doing F1–F5 the same week — not a magical prompt alone.

---

## 6. Recommended run sequence (you + GPT)

| Step | Who | Time |
| --- | --- | --- |
| 1 | Paste prompt into GPT | — |
| 2 | GPT completes U0–U9 | hours |
| 3 | You run F1 immediately | 15 min |
| 4 | You run F2 over 2–3 days | — |
| 5 | F3–F5 | — |
| 6 | Only then discuss public launch | — |

Do **not** run ads between step 2 and step 5.
