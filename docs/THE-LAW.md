# THE LAW — Vognary company, product, and agent directive

> **Status:** CANONICAL. Effective 2026-07-21. Live checkout process: CONTINUE-HERE.
> **Audience:** every human, every agent, every model (including Fable / top-tier coding models).  
> **Priority:** This file outranks all other plans when they conflict.  
> **If you are a new agent session:** read this file **first**, then the chain in §0.2. Do not invent a parallel strategy.

---

## 0. Mandatory read order (no exceptions)

| Order | File | Role |
| ---: | --- | --- |
| **1** | **`docs/THE-LAW.md`** (this file) | Company scoreboard, what wins, what is forbidden, phases A–F |
| **2** | `docs/CONTINUE-HERE.md` | Live handoff: branch state, env, what is next *this week* |
| **3** | `docs/execution/phase-a-market-contact.md` | 21-day market proof kit (CRM, scripts, report) |
| **4** | `docs/execution/phase-b-loop-shipping.md` | Loop product architecture + agent work packages |
| **5** | `docs/execution-plan-ui-ai-quality.md` | WP-0…WP-6 UI/AI execution detail |
| **6** | `docs/master-build-plan.md` | AI layer + Twin + UI quality **law** (Parts 3 & 5) |
| **7** | `docs/production-activation-runbook.md` | External gates only when unblocking claims |

**Forbidden:** creating new “master plans,” leap plans, or perfection plans.  
**Allowed:** updating this file’s scoreboard metrics and CONTINUE-HERE status after real evidence.

Prior-generation material lives only in `docs/archive/`. Treat it as history, not instructions.

### 0.1 Founder scope freeze — 2026-08-18 (Commitment Intelligence)

Until measured first-user evidence invalidates it, the canonical product is:

> **Vognary is Commitment Intelligence: the continuously maintained, evidence-backed model of what a 2–20 person software/AI company is financially committed to, what changed, what comes next, how certain Vognary is, and why it believes every important claim.**

- First ICP: 2–20 person software/AI companies without dedicated finance/procurement ops.
- First domain: software, AI, cloud, and recurring vendor commitments.
- Source law: many replaceable sources → one normalized evidence layer → one commitment graph → one financial truth model. No connector owns the truth.
- Source 0 (live rail): private billing inbox. Decision B (2026-08-18): one-time billing-only auto-forwarding is the primary **ongoing** loop after first value. Manual paste/upload/forward is the first-session path. Manual forwarding remains historical backfill assistance and recovery. Do not require Gmail setup before the user sees commitment intelligence.
- **V1 production rail freeze (2026-08-18):** private billing inbox + one-time billing-only auto-forward + one-time historical backfill + existing evidence → commitment graph → changes / expectations / why. Do not implement Gmail OAuth, Outlook, Zoho, bank/AA, card feeds, vendor APIs, SSO/SCIM, procurement, seats, autonomous cancellation, or a mailbox-wide AI scanner in this release.
- Product path: sign in → add 2–5 billing records (paste / upload / optional one-off forward) → cited commitments → what changed → upcoming money → why/evidence → correction → **then** keep current (private alias + one-time billing-only auto-forwarding) → honest source health.
- External V1 promise: **Know what your company is committed to pay next — and what deserves attention before the card fires.** Customer category: Software Decision Intelligence. Primary CTA: Review my software stack. First session is value-first; mailbox access is not required.
- Thin V1 decision layer (the only new product layer in this freeze): KEEP / REVIEW_LATER / PLAN_TO_CANCEL, remembered per expected charge date, with next-cycle expected-vs-observed verification. Optional purpose is asked only on overlap cards. Do not invent KEEP/REVIEW/CANCEL NOW from category overlap alone. Do not ask an LLM whether the company should cancel. Absence is never cancellation.
- Direct Gmail/Google Workspace OAuth stays fail-closed until restricted-scope verification and the required third-party security assessment are genuinely complete. Do not mark Gmail “Connect” or advertise mailbox sync.
- **Future Gmail (prepare, do not build):** preferred later connector is selective direct mailbox intelligence — OAuth → candidate discovery → fetch likely billing evidence only → classify → normalize → retain minimum auditable evidence → discard unnecessary content → commitment graph. Historical selective backfill on first connection; incremental processing afterward. Not full mailbox warehousing. Status: **DEFERRED / BLOCKED BY EXTERNAL APPROVAL**.
- Long-term vision: the control layer for recurring money.
- Engineering stops after the production forwarding path, one real automatic receipt, returning-user Changes/Why/memory from real state, first-10 instrumentation, and clean pushed `main` are proven.
- Surfacing already-built commitment-graph, absence, and change-intelligence **facts** in customer language is in scope. Do not rebuild those engines. Do not enable notification sending, cancellation/autonomous action, AA/bank rails, Gmail OAuth, Outlook/Zoho connectors, generic SaaS management, budgeting, procurement, SSO/SCIM, seats, new architecture, or a redesign without real-user evidence and a new founder decision.

---

## 1. One-line identity (every feature must serve this)

> **Know what your company is committed to pay next — evidence-backed commitments, changes, upcoming money, and conservative review decisions for founder-led 2–20 person software/AI companies, India-first.**

If a feature cannot be stated as a **proven** claim, it is not shippable copy and not shippable UI.

**We are not:** a budget app, YNAB, CRED, Zylo, Rocket Money clone, generic AI money chat, fake bank-sync dashboard, Gmail product, consumer subscription tracker, or autonomous cancellation agent.

**We are:** Software Decision Intelligence on a Commitment Graph. Every important claim cites evidence or stays Unknown. Autopilot cancellation remains built but switched off until a later founder decision.

---

## 2. The diagnosis every agent must internalize

| Fact | Implication for work |
| --- | --- |
| Engineering/trust craft is **elite** for pre-PMF | Preserve honesty gates, fail-closed money paths, tests |
| Business validation is ~**1.5/10** | **Raise the minimum row** — users, paid proof, corpus |
| Composite score = **min(rows)**, not average | A 9-trust product with 1.5 business is a **2** company |
| Pipeline leads were research-only (“Not asked”) | Market contact is not optional theater |
| Corpus is empty | Intelligence claims are unproven until fixtures exist |
| Production activation is mostly external | Founder-ops unlock claims; more TypeScript does not |
| $100B is multi-decade platform destiny | **Not** a sprint justification for new engines |

**One-line strategy:**

> Ship Commitment Intelligence to the first 10 founder-led 2–20 person software/AI companies, prove they get value from bills they already have, then keep Vognary current with a private billing address.

Scaffolding is necessary. **Scaffolding is not the building.**

---

## 3. The only product loop that matters

```
passive evidence (paste / CSV / inbound mail; Gmail OAuth when proven)
        → cited classification
        → deterministic eligibility rules
        → 48-hour veto
        → supported execution (discretionary only)
        → proof
        → covered clean windows
        → outcome billing
```

**Any PR that does not raise this loop or unblock a private autopilot pilot is out of scope until Stage 0 exit.**

---

## 4. Five invariants (non-negotiable code law)

1. **One live checkout.** Default is an isolated worktree from freshest `main`. If CONTINUE-HERE names a same-repo branch, stay in this folder and do **not** spawn `../vognary-*` copies. Never dirty-edit the same file as another agent.
2. **Brand is fixed:** Nakul the mongoose, Fraunces display, graphite/gold. Deepen, never swap.
3. **Honesty is machine-enforced.** Merchants are *watched*, never *linked*; rails/sources use *connect* voice. `scripts/check-public-claims.mjs` fails the build. Blank env → “Not yet proven.”
4. **Scoring is minimum-row.** Before building: *does this raise the lowest scoreboard row?*
5. **No engine change without a failing test first.** Gate before merge:

```bash
npm run lint && npm run typecheck && npm run claims:check && npm run tokens:check && npm test
npm run build && npm run perf:budget
```

**AI rule:** the deterministic engine + Proof Graph are the sole source of financial facts. LLM output without resolving citations is **discarded before render**. Never disable `validateCited`.

**India-first:** default ₹ INR, Indian number format (`@/lib/format`), UPI AutoPay / e-mandates / SIPs / EMIs / Indian bank formats first-class. World is opt-in second.

---

## 5. Scoreboard (update only with measured evidence)

| Dimension | Floor (2026-07-21) | 10/10 direction |
| --- | ---: | --- |
| Wedge sharpness | 8 | Category language outside our site |
| Intelligence engine | 6 | ≥97% precision / ≥92% recall on 500-file corpus |
| Trust & honesty | 9 | Live trust page + zero overclaims |
| Product UX | 5.5 | <3 min to first insight; brief is default home |
| Backend readiness | 8 | SLOs met in production |
| Production activation | 3.5 | `production:check --strict` green on prod |
| Live connector depth | 4 | Gmail public-verified + ≥1 regulated rail |
| Data / network moat | 3 | Opt-in merchant intelligence with n≥25 |
| **Business validation** | **1.5** | Paid autopilot pilots + retention + ARR path |
| **Distribution** | **1.5** | Artifact loop + CA loop without founder push |

**Composite ≈ 1.5–2.** Agents optimize the **minimum**, not the average.

### Next 90 days — only metrics that count

| Metric | Day 30 | Day 90 | Kill / pivot if |
| --- | ---: | ---: | --- |
| Connected accounts with active mandates | **10** | **40** | <5 by day 30 |
| Accounts with an eligible candidate | **5** | **15** | <2 by day 30 |
| Supported actions with no post-mandate customer work | **3** | **10** | 0 after 10 connected |
| Covered clean financial windows | **2** | **8** | 0 after 10 connected |
| Actual payments of 20 real offers | **5** | **15** | 0 actual payments after 20 real offers |
| Written pay intent (separate; does not satisfy the paid gate) | track | track | — |
| D30 active-source-and-mandate retention | ≥40% | ≥60% | <20% |

---

## 6. Phases (company sequence — not optional)

| Phase | Name | Goal | Gate to exit |
| --- | --- | --- | --- |
| **0** | Hygiene | One repo, one doc chain | **DONE** 2026-07-21 |
| **A** | Market proof | 10 operational autopilot pilots; paid gate is actual payment | Day-21 stop/go |
| **B** | Loop undeniable | WP-A through WP-E lock the autopilot loop | e2e + real user <3 min |
| **C** | Production min | Identity, monitor, backup, pay, email | activation rows READY |
| **D** | Intelligence moat | Corpus 100, formats, first verified saving | corpus:strict green |
| **E** | Distribution | Artifact + CA loops | organic inbound |
| **F** | Platform | AA, observatory, API, monitoring SKU | **only after A–E signal** |

Detail:

- **Phase A playbook:** [`docs/execution/phase-a-market-contact.md`](execution/phase-a-market-contact.md)
- **Phase B architecture + agent tasks:** [`docs/execution/phase-b-loop-shipping.md`](execution/phase-b-loop-shipping.md)
- **Engineering slice of B:** WP-A through WP-E in [`docs/execution/phase-b-loop-shipping.md`](execution/phase-b-loop-shipping.md). Historical WP-B0…B8 are not the live roadmap.

### Attention allocation (founders + agents)

| Bucket | Next 60 days | After PMF signal |
| --- | ---: | ---: |
| Users / autopilot pilots / sales | **45%** | 25% |
| Founder-ops (keys, legal, Google, pay) | **25%** | 15% |
| Product on the loop only | **25%** | 35% |
| Long-horizon (AA, platform) | **5%** | 25% |
| New strategy docs | **0%** | 0% (quarterly only) |

---

## 7. Hard stop list (do not do)

Agents **must refuse** or redirect:

1. New plan / leap / perfection / surface-N docs  
2. New connectors except Gmail path + statement/India evidence for 60 days  
3. Platform API partner sales before 25 active workspaces  
4. Design-system rewrite (enforce `globals.css`; no restyle)  
5. Uncited AI financial claims  
6. Setu/Razorpay *product code* ahead of provisioning (use runbooks only)  
7. `/app` route restructure during monolith decomposition  
8. “$100B architecture” features that skip Stage 0 metrics  
9. Fake social proof, fake live bank sync, demo data as production claim  
10. Working outside this repository  

---

## 8. How agents must plan and implement

### 8.1 Before any code

1. State which **scoreboard row** this raises.  
2. State which **loop step** it improves.  
3. List **files** you will touch (prefer existing modules).  
4. Write or cite the **failing test** for engine changes.  
5. Confirm the CONTINUE-HERE checkout (this folder / named branch). Do not create sibling worktrees while that override is live. PR against `main`.

### 8.2 Architecture rules when designing

| Layer | Rule |
| --- | --- |
| Deterministic engines | Sole fact source: `recurring-audit`, `renewal-timeline`, `receipt-parser`, Proof Graph |
| AI | `src/lib/server/ai/*` only; cite-or-shut-up; budget-capped; degrade without key |
| Twin | Pure lib `src/lib/twin/*`; never invent amounts |
| UI | Brief-first home; progressive disclosure; tokens from `globals.css` |
| Connectors | Honesty states only; registry ≠ live coverage |
| Money | Server-owned prices; signed webhooks only; fail closed |
| Data | Prefer Recovery (`src/lib/recovery`) as the sole financial authority. Living ledger is frozen read-only. |

### 8.3 Workspace policy

- The legacy workspace monolith is retired. `src/app/workspace/*` is the only customer workspace implementation.
- Do not recreate a parallel workspace shell or bypass Recovery contracts.

### 8.4 Definition of done (every PR)

- [ ] Raises min scoreboard row or unblocks Phase A/B gate  
- [ ] Lint, typecheck, claims, tokens, tests green  
- [ ] No new public claim without production proof  
- [ ] India-first defaults preserved  
- [ ] No uncited AI path  
- [ ] CONTINUE-HERE status updated if phase state changes  

### 8.5 Model guidance (Fable / top models)

You are not hired to impress with architecture. You are hired to:

1. **Ship the loop** users feel in <3 minutes.  
2. **Never lie** about money or connectors.  
3. **Prefer boring, tested paths** over clever new systems.  
4. **Ask the founder** only for external ops (keys, legal, Google, Razorpay, Setu).  
5. When unsure, choose the option that produces **a protected, zero-chore discretionary cancellation this week**.

---

## 9. Competitive doctrine (how we beat the market)

| Do | Don’t |
| --- | --- |
| Sell *verified discretionary cancellation with a 48-hour veto* | Sell “another budget app” or a spreadsheet replica |
| Win the 10-minute pre-bank moment | Pretend full UPI/bank magic exists |
| Name missing sources as a feature | Hide incompleteness like competitors |
| Stay neutral (no credit/lending cross-sell) | Become CRED-shaped |
| Compound corpus + verified savings | Race feature checklists |
| India rails literacy | US-only copy pasted into INR |

**Game-changer status:** category *potential* yes; *today* no. Potential becomes real only with users, habit, quoted numbers, distribution.

**$100B path (vision only — not sprint scope):**

0. Prove business → 1. Habit product → 2. Rails + network → 3. Platform API/index → 4. Commitment-truth OS.  
Consumer audit alone is not $100B. **Commitment truth as infrastructure** might be, over a decade+.

---

## 10. Founder-ops board (human-only; agents prepare, do not fake)

| # | Item | Unblocks |
| --- | --- | --- |
| 1 | `ANTHROPIC_API_KEY` + `AI_MONTHLY_BUDGET_INR` | Live AI layer |
| 2 | Google OAuth + restricted-scope verification start | Gmail public path |
| 3 | Resend domain + key | Magic link + renewal email |
| 4 | Monitoring (Sentry or Better Stack) | Safe production |
| 5 | Backup storage + restore drill | Financial data trust |
| 6 | Razorpay + legal terms approval | ₹999 checkout |
| 7 | 10–20 redacted real statements → corpus | Intelligence truth |
| 8 | Setu AA onboarding start | Long-lead rail |

Agents may draft configs, checklists, and verification commands. Agents must **not** invent READY statuses.

---

## 11. Immediate next 7 days (default sprint)

| Day | Who | Work |
| --- | --- | --- |
| 1 | Founder | Start Google restricted-scope verification / CASA; counsel review of standing-mandate agency |
| 1–2 | Agent | WP-A Recovery evidence spine (this package) |
| 2–3 | Founder | One real inbound receipt attestation; Razorpay/legal readiness |
| 3–5 | Both | First operational autopilot pilots (connect + mandate), not paste-PDF audits |
| 4–6 | Agent | WP-B class lock + shadow evaluator |
| 5–7 | Founder | 10 connected accounts with active mandates |
| 7 | Founder | Scoreboard update only with measured pilot evidence |

Full 21-day grid: Phase A doc. Full engineering WPs: Phase B doc.

---

## 12. Document control

| Action | Rule |
| --- | --- |
| Conflict with CONTINUE-HERE on *live state* | CONTINUE-HERE wins for “what is true today” |
| Conflict with CONTINUE-HERE on *strategy* | **THE-LAW wins** |
| Conflict with archive docs | **THE-LAW wins** |
| Conflict with master-build-plan on AI/Twin APIs | master-build-plan Parts 3–5 win for *implementation law* |
| Adding features outside A–B | **Forbidden** until Stage 0 metrics move |

**Last strategic review:** 2026-08-13 founder-authorized discretionary-autopilot pivot.
**Next allowed strategic rewrite:** after the paid-20 gate with measured numbers only.

---

## 13. Bottom line

The repository is a **high-trust foundation** for a category-defining India-first recurring-money company.  
The company is still **pre-PMF**.

Act like builders of **truth about money** — not curators of an unused proof graph.

**Read next:** [`docs/execution/phase-a-market-contact.md`](execution/phase-a-market-contact.md) and [`docs/execution/phase-b-loop-shipping.md`](execution/phase-b-loop-shipping.md).
