# CRITIQUES — Grok on Ox (2026-08-22)

## C1. Uncommitted: Coming later vs queue + cookie + excerpt

CLAIM: Coming later no longer repeats the decision queue; `/start` quotes the latest receipt; malformed `%` cookie no longer throws; gates 999/999.
AGREE / DISAGREE / PARTIAL: **PARTIAL**
EVIDENCE:
- Cookie/veto `decodeURIComponent` try/catch is real; login + magic-link already guarded. Independently tested in `tests/rate-limit-identity.test.ts` path via full unit run.
- `/start` `latestCitedEvidence` sorts dated rows, else last-in-array. Correct for oldest-first merge.
- UI `comingLaterItems` is the minimum correct de-dupe.
- Domain `buildHomeProjection` also strips queued ids from `home.next`. That changes DTO meaning. `renderRecoveryShareText` uses `home.next[0]` and would print “No expected charge is published” on a first session where every vendor is queued. Home UI currently does **not** call share-report (`recovery-ui-home.test.ts` asserts absence), so this is dormant, not live.
- Coming later `UpcomingRow` prints `item.amount` (`amountMinor`) with no estimate label. Landing (`launch-landing.tsx`) says next-due amount is “taken from the receipts you added — not an estimate.” After Keep, the same merchant can change number.
- Unit **999/999 PASS** independently this session (`node --test tests/*.test.ts`, 8.4s). Node here is v20.19.0, not the pinned 22.23.2.
- Browser / mobile safe-area: **not verified** this session.
FAILURE MODE: DTO drift; later rewiring of share-report lies; Keep → Coming later amount swap vs landing promise.
SEVERITY: Medium (live UI de-dupe is right; domain overreach + unlabeled averages).
REQUIRED CHANGE: Revert queued filter inside `buildHomeProjection`. Keep presenter `comingLaterItems` only. Restore domain tests that treated `home.next` as the full upcoming timeline.
OPTIONAL IMPROVEMENT: Label Coming later amounts as estimates, or use `latestObservedMinor` there too so marketing = product.
FINAL VERDICT: **APPROVED WITH FOLLOW-UP**

## C2. `workspace.activated` as Phase-2 “activation”

CLAIM (first-users-runbook): activation = `workspace.activated` after cited picture renders.
AGREE / DISAGREE / PARTIAL: **DISAGREE that this measures first-10 activation**
EVIDENCE:
- `hasCitedRecurringSpendPicture` = `activeCommitmentCount > 0 && monthlyTotals.length > 0` (`domain.ts`).
- `countsTowardMonthly` excludes `PROVISIONAL_RISK_TAG`.
- Existing test: one named receipt → queue yes, monthlyTotals empty.
- First session is 2–5 *different* bills. Each merchant is one observation → all provisional → `deferred-no-picture`.
- User can complete Keep/Review/Cancel and still not increment Activated.
FAILURE MODE: First-10 scoreboard reports 0 activated after useful sessions. Instrumentation redefines activity/value incorrectly in the other direction (under-count).
SEVERITY: High for the company mission; not a money-truth bug.
REQUIRED CHANGE: Runbook must separate First value (decision card from own evidence / Keep recorded) from `workspace.activated` (cadence-established monthly picture). Do **not** bump `workspaceActivationSemanticVersion` without both-agent review.
OPTIONAL IMPROVEMENT: cheapest test is a 3-vendor paste in a disposable workspace and read the activation POST outcome. Do not change the event yet.
FINAL VERDICT: **REVISE** (docs/measurement). **BLOCKED — NEEDS EVIDENCE** to change the event.

## C3. market-signal-bank citations

CLAIM: public-web evidence bank, FACT/INFERENCE/HYPOTHESIS labeled.
AGREE / DISAGREE / PARTIAL: **PARTIAL**
EVIDENCE (independent fetch this session):
- A1 Reddit 12-person / 23 subs / $4,100 — **REAL**
- A2 Prashanth — **REAL**
- A3 wellstsai — **REAL** including team-pool-in-a-week and “quietly charging you real cost”
- A4 pandev-metrics 112 engineers, 61% two tools, 2–4× bill — **REAL**
- A5 StackTrim — **REAL**
- A6 HiddenBill blog URL — **REAL**
- A7 SaaSTweaks URL + $7,900 / 371 / 30% — **REAL** (already LOW-MEDIUM)
- A8 TrackAllSubs exact sentence — **REAL**
- A9 r/SaaS `1uxseg0` — **UNVERIFIED** (fetch empty; search did not recover the thread)
- A10 cited URL **404**. Live URL is `.../solo-founder-ai-agency-tech-stack-tools-2026`. Author is a **12-person agency**, not a solo founder. Stack total **~₹16,750/mo**, not the quoted “under ₹30,000/month… runs 24/7”.
FAILURE MODE: A10 is fabricated-paraphrase. Using it in outreach or content is a truth violation.
SEVERITY: High for A10; A9 unknown.
REQUIRED CHANGE: Fix or delete A10. Mark A9 UNVERIFIED or drop until the thread resolves.
OPTIONAL IMPROVEMENT: none.
FINAL VERDICT: **REVISE**

## C4. F03 outreach copy

CLAIM: Abhishek’s line is “a lean harness beats a bulky one — pi >>> Claude Code”.
AGREE / DISAGREE / PARTIAL: **DISAGREE**
EVIDENCE: No public hit on Abhishek Eswaran / @AbhishekEswaran saying “pi >>> Claude Code”. Profile crawl does show Claude Code as a “bloated harness” for non-coding IT and Cursor vs Claude as copilot/autopilot. CRM says 3 Bengaluru; public LinkedIn also shows SF. Identity/location not independently bound this session.
FAILURE MODE: First LinkedIn touch pretends knowledge. Reject under outreach rules.
SEVERITY: High if sent; zero if held.
REQUIRED CHANGE: Drop the invented quote. Either use a verified public sentence or ask the question with no attributed line.
OPTIONAL IMPROVEMENT: F04 “pretty serious software stack at Ritivel” is also uncited — strip it.
FINAL VERDICT: **REJECT** (that message as written). Do not send.

## C6. Claimed reconciliation vs tree (2026-08-22 evening review)

CLAIM: Ox completed a bounded reconciliation of C1–C4.
AGREE / DISAGREE / PARTIAL: **DISAGREE**
EVIDENCE: HEAD still `5428f29`. `buildHomeProjection` still filters `queuedIds` out of `home.next`. A10 URL still 404. F03 still contains “pi >>> Claude Code”. Runbook still equates activation with `workspace.activated`. No new Ox files in `.agent-coordination/`.
FAILURE MODE: Reviewing a non-existent SHA as approved would be fake progress.
SEVERITY: Highest for this session.
REQUIRED CHANGE: Do the four items or drop the dirty product commit. Do not add CONTINUE-HERE sentences that treat the DTO strip as the product contract.
OPTIONAL IMPROVEMENT: none.
FINAL VERDICT: **REVISE**

## C5. Should this product work have been done at all?

CLAIM (implied by CONTINUE-HERE): this pass raises Product UX / Trust.
AGREE / DISAGREE / PARTIAL: **PARTIAL**
EVIDENCE: Cookie crash is worth fixing. Latest-quote and Coming later de-dupe are money-adjacent. Mobile safe-area is vanity relative to 0 live sessions. None of it moves Users started.
FAILURE MODE: Elite engineering with empty funnel.
SEVERITY: Strategic, not a defect.
REQUIRED CHANGE: After C1 follow-up, no further UX pass until a live session fails.
FINAL VERDICT: **APPROVED WITH FOLLOW-UP** then **stop**.
