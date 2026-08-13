# Pre-public retention work package (agent execution)

> **Not a new strategy.** Parent law: [`docs/THE-LAW.md`](../THE-LAW.md).  
> Live state: [`docs/CONTINUE-HERE.md`](../CONTINUE-HERE.md).  
> Market: [`phase-a-market-contact.md`](phase-a-market-contact.md).  
> Loop product: [`phase-b-loop-shipping.md`](phase-b-loop-shipping.md).  
> Field memory: [`people-conversation-learning.md`](people-conversation-learning.md).  
> Scoreboard: [`scoreboard.md`](scoreboard.md).
>
> **Purpose:** Convert the critic “before public launch” list into ordered work packages  
> that raise the **minimum scoreboard rows** (business validation, distribution, product UX,  
> production activation, connector depth) without inventing a parallel roadmap.

**Win condition (company):** one Indian founder says *“I didn’t know that was still renewing,”*  
pays (or hard pay-intent) for that truth, and can re-check next month with evidence.

**Win condition (product before public growth):**  
Customer #0–#5 real audits · real-human &lt;3 min to first useful insight · one passive evidence path  
proven · one product story · no overclaims · retention loop not “re-upload forever or die.”

---

## 0. Hard rules for every agent (especially SOL)

1. Read **THE-LAW → CONTINUE-HERE → this file** before coding.  
2. **Recovery v1 same-checkout exception is active** on branch `recovery/v1`:  
   - No clone, worktree, branch, stash, merge, rebase, or checkout.  
   - SOL is **Git owner** only if founder designates SOL as Git owner in that session;  
     otherwise **do not commit/push** unless the human explicitly orders it.  
   - OPUS (if concurrent) does **no** Git-state mutations.  
   - No simultaneous writers on the same file.  
3. Path with spaces: always quote `"/Users/varunteja/Desktop/CVT Group/Vognary"`.  
4. Scoreboard rule: every PR/task states **which min-row it raises** and **which loop step**.  
5. Engine money changes: **failing test first**.  
6. Gate chain before claiming done:
   ```bash
   npm run lint && npm run typecheck && npm run claims:check && npm run tokens:check && npm test
   npm run build && npm run perf:budget
   ```
7. **Cite-or-shut-up:** never invent amounts, merchants, connector liveness, or READY states.  
8. **Founder-only ops** (agents prepare checklists, never fake): API keys, Google verification,  
   Razorpay, legal, Setu, production secrets, real Customer #0 with a human.  
9. **Forbidden until A–B signal:** new connectors (except Gmail/statement India path),  
   design-system rewrite, platform sales theater, new master/leap/perfection plans,  
   `/app` restructure theater, fake social proof.  
10. Prefer `src/app/workspace/recovery/**` and `src/app/workspace/*` over growing  
    `vognary-mvp-client.tsx` (quarantined monolith).

---

## 1. Product truth (do not re-litigate)

| Layer | Truth |
| --- | --- |
| Identity | Evidence-first **recurring-money audit** / software renewal review — not budget app, not CRED, not Rocket Money clone |
| Loop | evidence in → find recurring → brief/attention → user decides → outcome with proof |
| India-first | ₹ default, Indian number format, UPI/NACH/SIP/EMI literacy in engines; world opt-in |
| Honesty | Merchants *watched*, sources *connected*; blank env → “Not yet proven” |
| Launch surface | Recovery path: Google OIDC, receipt inbox when attested, manual evidence fallback |
| Guest audit | Exists for Phase A founder delivery; must not fight Recovery identity |
| Business floor | CRM shows **0** completed real audits as of last scoreboard; that is the crisis |

**Ultimate product (horizon, not sprint):** commitment truth as system of record —  
passive evidence, renewals, decisions, verified savings, India rails, corpus moat.  
**This packet only ships the pre-public floor that makes that path possible.**

---

## 2. Split of labor

| Owner | Owns |
| --- | --- |
| **SOL (agent)** | Product loop UX, first-value path, Recovery polish, e2e, audit report wiring, empty states, claims-safe copy, tests, CONTINUE-HERE/scoreboard **evidence updates only when measured**, CRM hygiene helpers |
| **Founder (human)** | Outreach, live audits, pay asks, Google/Resend/Razorpay/AI key, Customer #0, corpus consent, production secrets, public launch go/no-go |
| **Neither alone** | “Public launch” — requires founder Day-21 stop/go with numbers |

---

## 3. Work packages (execute in order)

Do **not** start WP-R5+ until WP-R1 acceptance has a real path ready for a human.

### WP-R0 — Session baseline (SOL, 30–60 min)

**Raise:** Backend readiness / hygiene (no regression).

- [ ] Read THE-LAW, CONTINUE-HERE §1, this file, scoreboard, people-conversation-learning §5–7  
- [ ] Confirm branch `recovery/v1`, dirty tree awareness, no Git mutations unless ordered  
- [ ] Run gate chain; note any red  
- [ ] Inventory surfaces: `launch-landing.tsx`, `workspace/recovery/**`, `guest-audit-client.tsx`,  
  `private-audit/*`, `lib/audit-report.ts`, `lib/recovery/**`, receipt-inbox server paths  
- [ ] Output a 10-line “current gaps vs this packet” note in the PR/session summary (not a new plan doc)

**Done when:** green gates or listed blockers; file map confirmed.

---

### WP-R1 — One product story (SOL)

**Raise:** Product UX, Wedge sharpness (felt).  
**Loop:** Enter.

**Problem:** Landing, Recovery, guest audit, private-audit, and THE-LAW can sound like different products.

**Do:**

1. **Canonical public story (Recovery launch):**  
   *Know what’s renewing before you pay — from billing receipts you already have.  
   Amount, expected date, receipt behind each claim. No bank passwords.*  
2. Align `src/app/launch-landing.tsx` + login next + empty Recovery home to **one** primary job:  
   software / recurring commitments from evidence → attention → decision.  
3. Secondary only: “Want it done for you? Private audit” → `/private-audit`.  
4. Do **not** promise UPI AutoPay auto-dashboard, bank link, Gmail public, or AI advice  
   unless `*_STATUS` / readiness helpers allow.  
5. Ensure claims:check still green; no unlabeled sample totals as personal results.  
6. If guest audit remains for Phase A: keep it **reachable for founder ops**  
   (e.g. documented route or private-audit flow) without making the public hero a second product.

**Files (likely):**  
`src/app/launch-landing.tsx`, `src/app/login/*`, `src/app/workspace/recovery/recovery-home.tsx`,  
`src/app/workspace/recovery/recovery-add-evidence.tsx`, claims corpus if copy is checked.

**Tests:** claims:check; landing/e2e smoke if present.

**Done when:** cold visitor can state the job in one sentence; no competing CTAs.

---

### WP-R2 — First-value &lt;3 min (SOL)

**Raise:** Product UX (toward &lt;3 min median TTI).  
**Loop:** Evidence in → insight.

**Problem:** Login wall + empty honesty + one-receipt-no-recurrence → “nothing useful.”

**Do:**

1. **Signed-in empty → guided first value**  
   - Lead with receipt address **only if** publicly available / attested path.  
   - Else: paste/upload path with **3-step microcopy**:  
     (1) paste 2–3 billing emails or invoices  
     (2) same merchant twice unlocks cadence  
     (3) home shows burn / next / one action  
2. **First session chrome:** Home shows at most:  
   - monthly totals (honest)  
   - needs attention (or empty that teaches next evidence)  
   - coming up  
   - one primary CTA  
   Hide advanced / twin / connector theater from first session.  
3. **First insight contract:** after valid multi-charge evidence, user sees:  
   - at least one commitment with amount + proof path  
   - next expected date when engine supports it  
   - one recommended decision (keep/watch/cancel/investigate) from existing engines — no invented money  
4. **No fake recurrence** from a single observation (keep Recovery rule).  
   Instead: coach the user to add a second matching receipt or labeled “seen once — not yet recurring.”  
5. E2E: extend Recovery / Customer #0 / first-value specs desktop+mobile for the guided empty state.

**Files (likely):**  
`recovery-home.tsx`, `recovery-add-evidence.tsx`, `recovery-workspace-client.tsx`,  
`src/lib/recovery/**`, e2e under `tests/e2e/`.

**Done when:** automated path proves cold → insight without dead ends; founder can time a human run.

---

### WP-R3 — Beat the spreadsheet (SOL, product only)

**Raise:** Product UX / retention design (habit hook).  
**Loop:** Brief / changed since last visit.

**Problem:** Field objection: “spreadsheet does a pretty good job.”

**Do:**

1. Make **“Since your last visit”** (Changed projection) unmistakable when `COMPARED`.  
2. Empty / first-return copy: *Sheets go stale. Vognary shows what amount, date, or status changed when new receipts arrive.*  
3. Surface coverage floor honestly: *This is a floor from receipts checked, not every debit in India.*  
4. One-tap **Copy for WhatsApp** / audit share on Recovery home if not already wired  
   (reuse `audit-report` share projection; Recovery facts only — no invented math).  
5. Do **not** attack sheets in marketing language; out-execute on staleness + proof.

**Done when:** returning user sees change/attention without hunting; share path works.

---

### WP-R4 — Passive evidence path readiness (SOL + founder)

**Raise:** Live connector depth, Production activation, Retention.  
**Loop:** Evidence in (ongoing).

**SOL:**

1. Trace receipt-inbox: provision → inbound webhook → process → Home update → failure states.  
2. Ensure UI never claims “email us receipts” unless `isReceiptInboxPubliclyAvailable()` (or equivalent) is true.  
3. Operator checklist for founder: exact env flags, what “attestation” means, how to prove one signed event.  
4. Gmail path: honesty states only; no public “connected” without verification proof.  
5. Tests for degrade paths (inbox off → manual only).

**Founder:**

- Send one real billing email through the inbox **or** complete Gmail test user proof.  
- Fill launch attestations only after real event (replay, retention, processing).

**Done when:** one **real** passive item lands in a workspace Home without re-paste (founder-attested).  
Agents do not mark READY without that proof.

---

### WP-R5 — Phase A market instrument (SOL supports; founder drives)

**Raise:** **Business validation** (the composite floor).  
**Loop:** Full loop with humans.

**SOL (allowed):**

1. Ensure private-audit + guest report path produces CRM-ready fields:  
   monthly burn INR, avoidable/watch, next debit, surprise-ready bullets, WhatsApp text.  
2. Redaction helpers / intake copy polish per phase-a scripts.  
3. CRM template hygiene: `docs/execution/private-audit-crm.csv` columns match phase-a;  
   never invent `audit-done` / `paid`.  
4. After founder completes audits, update scoreboard **only with measured numbers**.

**Founder:**

1. Close **≥5** live tests with real redacted evidence (target 10 for go).  
2. Record verbatim `surprise_quote`.  
3. Ask for ₹999 or pay-intent after value.  
4. Consent for redacted corpus fixtures (private store, **no PII in git**).

**Stop/go (THE-LAW):** if &lt;30% surprise after 10 audits or 0 pay after 20 valuable free → rework wedge, do not scale ads.

**Done when:** CRM rows show real `audit-done` + money fields; scoreboard Current column filled.

---

### WP-R6 — Reminder / re-check habit (SOL + founder)

**Raise:** Retention metric path (D30 return).  
**Loop:** Decide → later re-check.

**SOL:**

1. Prove renewal-alert path: preferences → due job → template with **no full PII leakage**.  
2. UI: opt-in is clear; disable works.  
3. “Re-check” empty state: what evidence to add for next month.  
4. E2E or integration tests for preference + dry-run where possible.

**Founder:** deliver one real reminder email to self/test user.

**Done when:** founder-attested reminder received; product does not claim alerts live until then.

---

### WP-R7 — Cognitive load / first-session IA (SOL)

**Raise:** Product UX.

**Do:**

1. Progressive disclosure: advanced sources, export/delete, security detail after first insight.  
2. India defaults preserved (`formatMoney`, ₹).  
3. Multi-currency: never invent FX; keep separate (already Recovery rule).  
4. Accessibility: no serious/critical axe regressions on Recovery paths.  
5. Mobile: primary path usable one-handed; large paste target.

**Done when:** first session ≤ one scroll to value; advanced behind clear nav.

---

### WP-R8 — Pre-public release gate (SOL prepares; founder decides)

**Raise:** Production activation honesty.

**SOL produces a release checklist file update only if existing runbook needs a row**  
(prefer `docs/production-activation-runbook.md` / CONTINUE-HERE — **do not** create leap plans):

| Gate | Evidence |
| --- | --- |
| Gates green | lint, typecheck, claims, tokens, test, build, perf |
| Customer #0 real human | founder note + CRM |
| TTI measured | founder stopwatch median |
| Receipt inbox or manual-only honest | attestations |
| Reminder | one real delivery or “not claimed” |
| Claims | zero overclaim |
| Pay path | Razorpay READY only if founder activated; else private-audit manual pay |
| Public growth | **blocked** until Day-21 style metrics move |

**Founder go/no-go only.**

---

## 4. Explicit non-goals (this packet)

- New design system / brand swap  
- New connectors beyond Gmail + statement/India evidence  
- Platform API partner sales  
- AA/Setu product code ahead of provisioning  
- Cancellation automation “we cancel for you”  
- Fake bank sync  
- $100B feature theater  
- Rewriting THE-LAW strategy  

---

## 5. Acceptance matrix (ultimate pre-public floor)

| # | Criterion | Evidence |
| ---: | --- | --- |
| 1 | One public product sentence | Landing + empty home match |
| 2 | Cold path teaches multi-receipt recurrence | E2E + copy |
| 3 | First insight: burn or commitment + proof + action | E2E Recovery |
| 4 | Changed-since-last-visit is primary retention hook | UI + tests |
| 5 | Share/WhatsApp report from real evidence | Unit + UI |
| 6 | Inbox claims only when available | Code + founder |
| 7 | ≥5 real audits in CRM (founder) | CSV |
| 8 | ≥50% surprise among completed (founder) | CRM quotes |
| 9 | ≥1 pay or hard intent (founder) | CRM |
| 10 | No public overclaims | claims:check + review |
| 11 | Gate chain green | CI/local |
| 12 | Scoreboard Current updated only with measures | scoreboard.md |

**Public launch / ads / “huge company” growth:** only after 7–12, not after green unit tests alone.

---

## 6. File ownership map (avoid dual-write)

| Area | Primary paths |
| --- | --- |
| Landing | `src/app/launch-landing.tsx`, `src/app/page.tsx` |
| Recovery UX | `src/app/workspace/recovery/**` |
| Recovery domain | `src/lib/recovery/**`, `src/lib/server/recovery*.ts` |
| Audit report | `src/lib/audit-report.ts` |
| Guest Phase A | `src/app/guest-audit-client.tsx` |
| Private audit | `src/app/private-audit/**` |
| Engines | `src/lib/recurring-audit.ts`, `receipt-parser.ts`, `assistant-brief.ts`, `mandate-killlist.ts` |
| Claims | `scripts/check-public-claims.mjs` + checked copy surfaces |
| CRM / field | `docs/execution/private-audit-crm.csv`, `people-conversation-learning.md` |
| Handoff | `docs/CONTINUE-HERE.md`, `docs/execution/scoreboard.md` |

If two agents run: freeze this map; one writer per path.

---

## 7. Definition of done (SOL session)

A SOL session is done when:

1. Assigned WPs from this file completed or blocked with **founder-only** reason.  
2. Gate chain run; results reported.  
3. CONTINUE-HERE §1 updated **only** for verified state changes.  
4. Scoreboard updated **only** with measured evidence (or left blank).  
5. No new strategy docs.  
6. Summary for founder:  
   - what users can do now that they could not yesterday  
   - what founder must do in the next 48h for Customer #0  
   - what is still not allowed to claim publicly  

---

## 8. Paste prompt for SOL (full)

Copy everything in the fenced block below into a new SOL session.

```text
You are SOL on Vognary Recovery v1.

MANDATORY READ ORDER (do not skip):
1. docs/THE-LAW.md
2. docs/CONTINUE-HERE.md
3. docs/execution/pre-public-retention-wp.md  ← execute THIS packet
4. docs/execution/phase-a-market-contact.md
5. docs/execution/phase-b-loop-shipping.md
6. docs/execution/people-conversation-learning.md (§5–7 field objections)
7. docs/execution/scoreboard.md

REPO: "/Users/varunteja/Desktop/CVT Group/Vognary" (always quote paths)
BRANCH: recovery/v1 only. Founder-authorized same-checkout exception:
- NO clone, worktree, branch, stash, merge, rebase, checkout
- No simultaneous writers on one file
- Do not invent READY/production claims
- Prefer src/app/workspace/recovery/** over growing vognary-mvp-client.tsx

MISSION:
Implement the pre-public retention floor so Vognary can become the ultimate
evidence-first recurring-money product WITHOUT launching a commodity tracker.

Company win: real founders get “I didn’t know that was still renewing,” pay for
truth, and re-check with evidence. Composite scoreboard is min-row; business
validation is ~1.5 — raise that floor. Scaffolding is not the building.

EXECUTE IN ORDER: WP-R0 → R1 → R2 → R3 → R4 (code) → R7 → R8 checklist.
WP-R5/R6: prepare product + docs; founder does live humans/pay/keys.
Skip nothing in acceptance matrix §5 that is code-owned.

PRODUCT RULES:
- Loop only: evidence → recurring → brief/attention → decide → proof
- Cite-or-shut-up: deterministic engines are sole money facts; no uncited AI
- India-first ₹; no invented FX
- One product story (software/recurring from receipts → attention → decision)
- Beat spreadsheet via “what changed” + proof, don’t shame sheets
- First session: one number, next debit/attention, one action; progressive disclosure
- One receipt ≠ fabricate recurrence; coach second matching receipt
- Receipt inbox claims only when availability helpers true
- Guest/private-audit remain for Phase A founder delivery; don’t fork identity

FORBIDDEN:
- New master/leap/perfection plans
- New connectors except Gmail/statement India path
- Design-system rewrite
- Fake bank/UPI live claims
- Platform sales theater
- Marking CRM audit-done/paid without founder
- Git mutations if you are not designated Git owner this session

GATES before claiming done:
npm run lint && npm run typecheck && npm run claims:check && npm run tokens:check && npm test
npm run build && npm run perf:budget
Plus relevant Playwright Recovery/first-value/Customer #0 scenarios.

OUTPUT AT END:
1) WPs completed / blocked
2) Files changed
3) Gate results
4) What founder must do in 48h (Customer #0, inbox attestation, outreach, pay)
5) Public claims still FORBIDDEN
6) Update CONTINUE-HERE / scoreboard only with measured evidence

Start with WP-R0 baseline, then implement WP-R1 and WP-R2 fully before anything else.
```

---

## 9. What the founder must give SOL (inputs)

| Input | Why |
| --- | --- |
| This file + THE-LAW + CONTINUE-HERE | Scope law |
| Explicit Git authority sentence | “You may commit on recovery/v1” or “diff only” |
| Whether receipt inbox is live in prod | Honest UI |
| Dev/staging env for Postgres + Google test | Real path verification |
| Redacted sample Indian receipts (optional) | Engine/UX realism without PII in git |
| Decision: public story = software renewals only for Recovery launch? | Prevents identity thrash (**recommended yes** until audits prove broader) |

**Founder still owns after SOL ships code:** outreach, Customer #0–#10, pay ask, keys, go/no-go.

---

## 10. After this packet (only if metrics move)

If Day-21 style metrics hit THE-LAW go criteria, **then** (still not a new plan — resume Phase C–D in THE-LAW):

- Production min activation rows  
- Corpus 25–100  
- Gmail public verification  
- Verified savings lived with a user  
- Distribution artifact loop  

If metrics miss: rework offer / ICP / effort model before “ultimate platform.”

---

*Last written for agent execution. Do not treat as a replacement for THE-LAW.*
