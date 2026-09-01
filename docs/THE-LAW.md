# THE LAW — Vognary company, product, and agent directive

## Founder motto — supreme operating principle

> **Take smart risks. Do not play safe.**

Vognary exists to pursue category-defining outcomes, not to preserve a familiar
product through incremental polish. Prefer an asymmetric bet with a spectacular
measurable upside over a comfortable feature when the bet has all of these:

1. A named customer and company outcome, not novelty for its own sake.
2. The cheapest real-world test that can disprove it.
3. An owner, deadline, success threshold, and kill threshold.
4. A bounded and preferably reversible downside.
5. Evidence captured quickly enough to change course.

When an existing product rule would preserve inertia instead of testing a
founder-authorized, falsifiable bet, this doctrine wins **on strategy**. Update
the live scope explicitly before implementation; never silently ignore a rule.
Green code, more features, and polished screens are not spectacular outcomes.
Paid behavior, retained use, a materially better customer decision, or a proven
new capability are.

**Smart risk is not reckless risk.** This doctrine never authorizes invented
claims, uncited money, fake readiness, PII exposure, insecure financial paths,
legal or consent bypasses, irreversible customer harm, or hidden production
experiments. Honesty, security, privacy, consent, and cite-or-shut-up remain hard
constraints because violating them destroys the upside.

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

### 0.1 Founder scope freeze — amended 2026-09-01 (Commitment Control)

**Commitment Control replaces Commitment Intelligence as the company direction.** Recovery remains the evidence and reconciliation foundation; the product moves one step earlier, before a new obligation is created.

> **Vognary records a proposed obligation, shows cited existing exposure, records who approved what limit, and later checks observed evidence against that decision.**

- First strict ICP: India-first, 20–100-person AI-native companies with a named finance owner and buyer-confirmed controllable exposure. Exploratory outreach may test plausible adjacent buyers but never counts as qualification.
- V0 offer: a **one-time ₹14,999 payment for one pilot month**: one policy setup, up to ten proposals, up to four weekly 30-minute reconciliation reviews, and up to two additional founder-support hours.
- V0 loop: proposal → deterministic exposure → stated policy → authorized human decision → frozen cap → later Recovery evidence → reconciliation.
- Recovery remains the sole evidence authority. Existing commitment graph facts may inform exposure, but a proposal is not evidence that money was spent.
- Every amount is an exact minor-unit value with an explicit currency. Existing evidence is cited; user-entered proposal values are labeled assumptions.
- Only workspace owners/admins may approve, approve with a cap, or decline. V0 **never auto-approves, auto-denies, purchases, provisions, cancels, or moves money**.
- Direct Gmail OAuth, banks, cards, wallets, Slack, agent execution, procurement workflows, and autonomous action remain deferred. The existing private billing inbox may supply later reconciliation evidence; it is not a prerequisite for proposing or deciding.
- The first irreversible bet is paid behavior, not payment infrastructure: five qualified plus fifteen exploratory contacts, at least 10 substantive conversations, ten identical offers, and two upfront payments by Day 7.
- Two cleared payments are `GO`; one is `REWORK`; zero of ten offers pay means the offer or economic value failed. Also kill or rework if fewer than half of requests arrive before spending or 30 proposals change zero decisions.
- An independent security assessment and retest must close before any real customer financial data enters Vognary, with no unresolved Critical/High finding and no unresolved data-impacting Medium finding. Payment does not grant data access. Production enrollment requires both cleared payment and that assurance exit.

---

## 1. One-line identity (every feature must serve this)

> **Decide what the company may commit to before the obligation exists, then prove the outcome against the frozen authorization.**

If a feature cannot be stated as a **proven** claim, it is not shippable copy and not shippable UI.

**We are not:** a budget app, generic SaaS inventory, autonomous purchasing agent, payment rail, card, bank connector, cancellation service, or procurement suite.

**We are:** Commitment Control backed by a Commitment Graph. Every financial fact cites evidence or is explicitly labeled as a user-entered assumption. Every decision names its human actor and preserves its original cap.

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

> Sell the human-approved control workflow to ten qualified AI-native companies while shipping only the proposal → policy → decision → reconciliation spine needed to make it repeatable.

Scaffolding is necessary. **Scaffolding is not the building.**

---

## 3. The only product loop that matters

```
proposed obligation (user-entered assumption)
        → cited existing exposure
        → deterministic policy evaluation
        → authorized human decision and frozen cap
        → later Recovery evidence
        → exact reconciliation against that authorization
```

**Any PR that does not raise this loop or unblock a paid Commitment Control pilot is out of scope until the Day 30 gate.**

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
| **Business validation** | **1.5** | Paid Commitment Control pilots + renewals + ARR path |
| **Distribution** | **1.5** | Artifact loop + CA loop without founder push |

**Composite ≈ 1.5–2.** Agents optimize the **minimum**, not the average.

### Next 90 days — only metrics that count

| Metric | Day 30 | Day 90 | Kill / pivot if |
| --- | ---: | ---: | --- |
| Qualified conversations | **10** | **30** | <10 in the seven-day test |
| Explicit one-time ₹14,999 offers | **10** | **30** | <10 in the seven-day test |
| Upfront paid pilots | **3** | **10** | 0 of 10 offers pay; one payment requires rework |
| Pre-spend proposals evaluated | **30** | **150** | <50% arrive before spend |
| Decisions materially changed / capped / declined | **3** | **15** | 0 after 30 proposals |
| Paid pilot renewals | **2** | **7** | <2 by day 30 |

---

## 6. Phases (company sequence — not optional)

| Phase | Name | Goal | Gate to exit |
| --- | --- | --- | --- |
| **0** | Hygiene | One repo, one doc chain | **DONE** 2026-07-21 |
| **A** | Paid proof | Sell ten identical one-time ₹14,999 pilot offers | Two upfront payments by Day 7 |
| **B** | Control V0 | Proposal, policy, human decision, reconciliation | Private V0 in 10 days |
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
| Users / paid pilots / sales | **55%** | 25% |
| Founder-ops (contracts, invoicing, access) | **15%** | 15% |
| Product on the control loop only | **25%** | 35% |
| Long-horizon (AA, platform) | **5%** | 25% |
| New strategy docs | **0%** | 0% (quarterly only) |

---

## 7. Hard stop list (do not do)

Agents **must refuse** or redirect:

1. New plan / leap / perfection / surface-N docs  
2. New connectors, cards, wallets, payment rails, or agent execution in V0
3. Platform API partner sales before 25 active workspaces  
4. Design-system rewrite (enforce `globals.css`; no restyle)  
5. Uncited AI financial claims  
6. Razorpay/Setu product code or money movement for the pilot
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
5. When unsure, choose the option that gets **a real proposal in before spend and a named human decision recorded this week**.

---

## 9. Competitive doctrine (how we beat the market)

| Do | Don’t |
| --- | --- |
| Sell a human decision before a real obligation | Sell “another SaaS dashboard” or a spreadsheet replica |
| Win the pre-commitment moment | Pretend Vognary can purchase, provision, or move money |
| Name missing sources as a feature | Hide incompleteness like competitors |
| Stay neutral (no credit/lending cross-sell) | Become CRED-shaped |
| Compound proposal → decision → outcome data | Race feature checklists |
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
| 6 | Pilot agreement, invoice, and founder-controlled one-time payment collection | ₹14,999 pilot reservation; active purchase required for month two |
| 7 | 10–20 redacted real statements → corpus | Intelligence truth |
| 8 | Setu AA onboarding | Deferred until paid control usage earns a rail |

Agents may draft configs, checklists, and verification commands. Agents must **not** invent READY statuses.

---

## 11. Immediate next 7 days (default sprint)

| Day | Who | Work |
| --- | --- | --- |
| 1 | Founder | Send the five founder-qualified first touches; record actual sends only |
| 2 | Founder | Send fifteen plausible buyers labeled exploratory; never infer qualification or spend |
| 2–4 | Founder | Run behavioral conversations without collecting real customer financial data in Vognary |
| 1–5 | Agent + founder ops | Prepare exact-head CI, encrypted restore proof, incident readiness, and synthetic assessment environment |
| 3–6 | Founder | Make the identical one-time ₹14,999 offer until ten explicit offers are recorded |
| 1–7 | Independent assessor + agent | Assess and remediate the synthetic staging target; real customer data stays blocked |
| 7 | Founder | Apply the two-payment gate; payment still does not bypass the assurance gate |

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

**Last strategic review:** 2026-08-25 founder-authorized Commitment Control pivot.
**Next allowed strategic rewrite:** after the Day 30 paid-pilot gate with measured numbers only.

---

## 13. Bottom line

The repository is a **high-trust foundation** for a category-defining India-first recurring-money company.  
The company is still **pre-PMF**.

Act like builders of **human authority over future obligations** — with exact money and evidence that survives reconciliation.

**Read next:** [`docs/execution/phase-a-market-contact.md`](execution/phase-a-market-contact.md) and [`docs/execution/phase-b-loop-shipping.md`](execution/phase-b-loop-shipping.md).
