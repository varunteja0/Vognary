# THE LAW — Vognary company, product, and agent directive

> **Status:** CANONICAL. Effective 2026-07-21.  
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

---

## 1. One-line identity (every feature must serve this)

> **The recurring-money audit that measures, never promises — the finance AI that cites or shuts up, built India-first.**

If a feature cannot be stated as a **proven** claim, it is not shippable copy and not shippable UI.

**We are not:** a budget app, YNAB, CRED, Zylo, Rocket Money clone, generic AI money chat, or fake bank-sync dashboard.

**We are:** evidence-first recurring commitments (subscriptions, UPI AutoPay, card e-mandates, SIPs, EMIs, insurance, SaaS, cloud, domains, app stores, utilities) with proof beside every rupee.

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

> Make one Indian founder say *“I didn’t know that was still renewing,”* collect payment for that truth, prove it again next month with evidence — **then** expand rails and AI.

Scaffolding is necessary. **Scaffolding is not the building.**

---

## 3. The only product loop that matters

```
evidence in (paste / CSV-PDF / Gmail)
        → audit finds every recurring charge
        → assistant brief (renews / anomalous / kill)
        → user decides (keep / watch / cancel / investigate)
        → decision + outcome logged with proof
        → (later) Verified Saving when debit stays gone
```

**Any PR that does not raise this loop or unblock market proof is out of scope until Stage 0 exit.**

---

## 4. Five invariants (non-negotiable code law)

1. **Isolated worktree per work package** from freshest `main`. Never dirty-edit over another agent.
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
| **Business validation** | **1.5** | Paid audits + retention + ARR path |
| **Distribution** | **1.5** | Artifact loop + CA loop without founder push |

**Composite ≈ 1.5–2.** Agents optimize the **minimum**, not the average.

### Next 90 days — only metrics that count

| Metric | Day 30 | Day 90 | Kill / pivot if |
| --- | ---: | ---: | --- |
| Completed real audits | **10** | **40** | <5 by day 30 |
| % with ≥1 “I didn’t know” finding | ≥50% | ≥60% | <30% |
| Paid ₹999 (or cash-equivalent) | **3** | **15** | 0 after 20 valuable free audits |
| Median time-to-first-insight | <3 min | <2 min | >8 min |
| Corpus consented fixtures | **25** | **100** | <10 at day 60 |
| D30 return / re-check | ≥40% paid | ≥55% | <20% |

---

## 6. Phases (company sequence — not optional)

| Phase | Name | Goal | Gate to exit |
| --- | --- | --- | --- |
| **0** | Hygiene | One repo, one doc chain | **DONE** 2026-07-21 |
| **A** | Market proof | 10 real audits, quotes, pay signal | Day-21 stop/go |
| **B** | Loop undeniable | Product makes loop inevitable | e2e + real user <3 min |
| **C** | Production min | Identity, monitor, backup, pay, email | activation rows READY |
| **D** | Intelligence moat | Corpus 100, formats, first verified saving | corpus:strict green |
| **E** | Distribution | Artifact + CA loops | organic inbound |
| **F** | Platform | AA, observatory, API, monitoring SKU | **only after A–E signal** |

Detail:

- **Phase A playbook:** [`docs/execution/phase-a-market-contact.md`](execution/phase-a-market-contact.md)
- **Phase B architecture + agent tasks:** [`docs/execution/phase-b-loop-shipping.md`](execution/phase-b-loop-shipping.md)
- **Product phases 1–4** (code loop) still tracked in CONTINUE-HERE; they are the **engineering slice of B**.

### Attention allocation (founders + agents)

| Bucket | Next 60 days | After PMF signal |
| --- | ---: | ---: |
| Users / audits / sales | **45%** | 25% |
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
5. Confirm worktree from fresh `main`, PR against `main`, **no stacked PRs**.

### 8.2 Architecture rules when designing

| Layer | Rule |
| --- | --- |
| Deterministic engines | Sole fact source: `recurring-audit`, `renewal-timeline`, `receipt-parser`, Proof Graph |
| AI | `src/lib/server/ai/*` only; cite-or-shut-up; budget-capped; degrade without key |
| Twin | Pure lib `src/lib/twin/*`; never invent amounts |
| UI | Brief-first home; progressive disclosure; tokens from `globals.css` |
| Connectors | Honesty states only; registry ≠ live coverage |
| Money | Server-owned prices; signed webhooks only; fail closed |
| Data | Prefer living ledger / graph over growing the 5.4k-line monolith |

### 8.3 Monolith policy

- `src/app/vognary-mvp-client.tsx` (~5.4k lines) is **quarantined** for token gate (`WP4_DEFERRED`).  
- Extract into `src/app/workspace/*` only under Phase B decomposition plan.  
- Prefer **new panels** under `workspace/` over growing the monolith.

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
5. When unsure, choose the option that produces **a completed human audit this week**.

---

## 9. Competitive doctrine (how we beat the market)

| Do | Don’t |
| --- | --- |
| Sell *proof of recurring commitments* | Sell “another budget app” |
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
| 1 | Founder | Message 20 pipeline leads (Phase A scripts) |
| 1–2 | Agent | Phase B: landing honesty + brief-as-home wiring gaps |
| 2–3 | Founder | Book 5 audits; agent: Gmail success moment path |
| 3–5 | Both | Deliver audits; log CRM; extract corpus candidates |
| 4–6 | Agent | UPI kill-list polish from statement path; e2e loop |
| 5–7 | Founder | Identity + monitoring + AI key; agent: degrade-safe checks |
| 7 | Founder | Scoreboard update; kill one non-loop idea |

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

**Last strategic review:** 2026-07-21 founder assessment.  
**Next allowed strategic rewrite:** after Day-21 stop/go with measured numbers only.

---

## 13. Bottom line

The repository is a **high-trust foundation** for a category-defining India-first recurring-money company.  
The company is still **pre-PMF**.

Act like builders of **truth about money** — not curators of an unused proof graph.

**Read next:** [`docs/execution/phase-a-market-contact.md`](execution/phase-a-market-contact.md) and [`docs/execution/phase-b-loop-shipping.md`](execution/phase-b-loop-shipping.md).
